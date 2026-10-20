import { randomUUID } from 'node:crypto';
import type supertest from 'supertest';
import type {
  PocCheck,
  PocEvidence,
  PocMutation,
  PocPullResponse,
  PocPushResponse,
} from '@corecheck/shared';
import {
  type ApiClient,
  createActiveUser,
  createSite,
  createStaffAccount,
  type OrganisationFixture,
  setUpOrganisation,
  staffSession,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

type Agent = ReturnType<typeof supertest.agent>;

const segment = (marker: number, payload: Buffer) => {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
};

/** A tiny JPEG whose EXIF block carries a GPS position. */
const JPEG_WITH_GPS = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
  segment(
    0xe1,
    Buffer.from('Exif\0\0GPSLatitude=53.79;GPSLongitude=-1.54', 'latin1'),
  ),
  segment(0xdb, Buffer.alloc(65, 1)),
  Buffer.from([
    0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0x11, 0x22, 0x33, 0xff, 0xd9,
  ]),
]);

const now = () => new Date().toISOString();

const answer = (
  checkId: string,
  questionKey: 'condition' | 'notes',
  value: string,
  answeredAt = now(),
): PocMutation => ({
  id: randomUUID(),
  type: 'answer',
  checkId,
  questionKey,
  value,
  answeredAt,
});

const submit = (checkId: string): PocMutation => ({
  id: randomUUID(),
  type: 'submit',
  checkId,
  submittedAt: now(),
});

describe('Offline synchronisation proof of concept (FRD 21)', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;
  let leeds: string;
  let york: string;
  let alice: Awaited<ReturnType<typeof createActiveUser>>;
  let bob: Awaited<ReturnType<typeof createActiveUser>>;

  const newCheck = async (siteId = leeds): Promise<PocCheck> =>
    (
      await org.admin
        .post('/poc/checks', {
          siteId,
          title: 'Daily check',
          plantLabel: `EX-${randomUUID().slice(0, 4)}`,
        })
        .expect(201)
    ).body as PocCheck;

  const push = async (client: ApiClient, ...mutations: PocMutation[]) =>
    (
      (await client.post('/poc/sync', { mutations }).expect(200))
        .body as PocPushResponse
    ).results;

  const uploadPhoto = (
    client: ApiClient,
    checkId: string,
    data = JPEG_WITH_GPS,
  ) =>
    client
      .post(`/poc/checks/${checkId}/evidence`)
      .field('id', randomUUID())
      .field('questionKey', 'photo')
      .field('capturedAt', now())
      .attach('file', data, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

  const pull = async (client: ApiClient) =>
    (await client.get('/poc/sync').expect(200)).body as PocPullResponse;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
    leeds = await createSite(org.admin, 'Leeds');
    york = await createSite(org.admin, 'York');
    alice = await createActiveUser(t, org.admin, {
      firstName: 'Alice',
      lastName: 'Field',
      roleId: org.roleIds.operative,
      siteIds: [leeds],
    });
    bob = await createActiveUser(t, org.admin, {
      firstName: 'Bob',
      lastName: 'Field',
      roleId: org.roleIds.operative,
      siteIds: [leeds],
    });
  });
  afterAll(() => t.close());

  it('downloads only the checks within the user’s scope (MOB-003)', async () => {
    const mine = await newCheck(leeds);
    const elsewhere = await newCheck(york);
    const ids = (await pull(alice.client)).checks.map((check) => check.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(elsewhere.id);
  });

  it('applies queued answers once, however often they are resent (MOB-005)', async () => {
    const check = await newCheck();
    const mutation = answer(check.id, 'condition', 'pass');
    expect(await push(alice.client, mutation)).toEqual([
      { id: mutation.id, status: 'applied' },
    ]);
    expect(await push(alice.client, mutation)).toEqual([
      { id: mutation.id, status: 'duplicate' },
    ]);

    const synced = (await pull(alice.client)).checks.find(
      (c) => c.id === check.id,
    )!;
    expect(synced.answers).toEqual([
      expect.objectContaining({
        questionKey: 'condition',
        value: 'pass',
        answeredBy: { id: alice.id, name: 'Alice Field' },
      }),
    ]);
  });

  it('keeps the newest answer when an older offline edit arrives late', async () => {
    const check = await newCheck();
    const newer = answer(
      check.id,
      'notes',
      'newer note',
      '2030-01-02T10:00:00.000Z',
    );
    const older = answer(
      check.id,
      'notes',
      'older note',
      '2030-01-02T09:00:00.000Z',
    );
    await push(bob.client, newer);
    await push(alice.client, older);
    const synced = (await pull(alice.client)).checks.find(
      (c) => c.id === check.id,
    )!;
    expect(synced.answers.find((a) => a.questionKey === 'notes')).toMatchObject(
      {
        value: 'newer note',
        answeredBy: { name: 'Bob Field' },
      },
    );
  });

  it('refuses submission until every mandatory question and photo is complete (CHK-006)', async () => {
    const check = await newCheck();
    const [incomplete] = await push(alice.client, submit(check.id));
    expect(incomplete).toMatchObject({
      status: 'rejected',
      code: 'INCOMPLETE_SUBMISSION',
    });
    expect(incomplete).toHaveProperty(
      'details.missing',
      expect.arrayContaining(['Photo of the plant']),
    );
  });

  it('stores evidence without location data and against the right question (EVD-004, MOB-AC-02)', async () => {
    const check = await newCheck();
    const uploaded = (await uploadPhoto(alice.client, check.id).expect(201))
      .body as PocEvidence;
    expect(uploaded).toMatchObject({
      questionKey: 'photo',
      contentType: 'image/jpeg',
      uploadedBy: { id: alice.id },
    });

    const stored = await alice.client
      .get(`/poc/evidence/${uploaded.id}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const bytes = stored.body as Buffer;
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.toString('latin1')).not.toContain('GPSLatitude');
    expect(bytes.length).toBeLessThan(JPEG_WITH_GPS.length);

    await uploadPhoto(
      alice.client,
      check.id,
      Buffer.from('not an image at all'),
    ).expect(400);
  });

  it('lets the first valid submission win and tells the later one why (CHK-007, MOB-006, MOB-007)', async () => {
    const check = await newCheck();
    await push(alice.client, answer(check.id, 'condition', 'pass'));
    await uploadPhoto(alice.client, check.id).expect(201);

    // Both devices queued a submission while offline; Alice's reaches the server first.
    const [first] = await push(alice.client, submit(check.id));
    expect(first).toMatchObject({ status: 'applied' });
    const [second] = await push(
      bob.client,
      answer(check.id, 'notes', 'late note'),
      submit(check.id),
    ).then((r) => [r[1]]);
    expect(second).toMatchObject({
      status: 'rejected',
      code: 'ALREADY_SUBMITTED',
      details: { submittedBy: 'Alice Field' },
    });

    const synced = (await pull(bob.client)).checks.find(
      (c) => c.id === check.id,
    )!;
    expect(synced).toMatchObject({
      status: 'submitted',
      submittedBy: { id: alice.id },
    });
    expect(synced.answers.some((a) => a.value === 'late note')).toBe(false);
    await uploadPhoto(bob.client, check.id).expect(409);
  });

  it('enforces revoked access on the next sync (MOB-AC-03)', async () => {
    const check = await newCheck();
    const carol = await createActiveUser(t, org.admin, {
      firstName: 'Carol',
      lastName: 'Field',
      roleId: org.roleIds.operative,
      siteIds: [leeds],
    });
    expect((await pull(carol.client)).checks.map((c) => c.id)).toContain(
      check.id,
    );

    await org.admin
      .patch(`/users/${carol.id}`, { siteIds: [york] })
      .expect(200);
    expect((await pull(carol.client)).checks.map((c) => c.id)).not.toContain(
      check.id,
    );
    const [result] = await push(
      carol.client,
      answer(check.id, 'condition', 'fail'),
    );
    expect(result).toMatchObject({ status: 'rejected', code: 'OUT_OF_SCOPE' });
    await uploadPhoto(carol.client, check.id).expect(403);
  });
});
