import type supertest from 'supertest';
import type {
  CheckTemplateDetail,
  PlantDetail,
  PlantReception,
  PlantSaved,
  ReceptionCheck,
  SaveTemplateDraftInput,
} from '@corecheck/shared';
import {
  type ApiClient,
  createActiveUser,
  createSite,
  createStaffAccount,
  type OrganisationFixture,
  setUpOrganisation,
  staffSession,
  uid,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

type Agent = ReturnType<typeof supertest.agent>;

/** A tiny PNG: signature, header chunk and end chunk. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
  Buffer.from('0000000049454e44ae426082', 'hex'),
]);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

type Question = NonNullable<SaveTemplateDraftInput['questions']>[number];

describe('Reception templates and plant reception (FRD 8, 10)', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;
  let siteId: string;
  let typeId: string;
  let hireId: string;
  let meterId: string;
  let supervisor: { client: ApiClient; id: string };
  let operative: { client: ApiClient; id: string };

  const questions = (overrides: Partial<Question>[] = []): Question[] => {
    const base: Question[] = [
      {
        id: 'q-condition',
        text: 'Overall condition acceptable',
        type: 'pass_fail',
        requireComment: 'on_fail',
        offlineOnFail: true,
      },
      {
        id: 'q-guards',
        text: 'Guards fitted',
        type: 'yes_no',
        failAnswer: 'no',
      },
      { id: 'q-photo', text: 'Photo of the plant', type: 'photo' },
      {
        id: 'q-hours',
        text: 'Hour meter',
        type: 'meter',
        meterTypeId: meterId,
      },
      {
        id: 'q-notes',
        text: 'Delivery notes',
        type: 'text',
        mandatory: false,
      },
    ];
    return base.map((question, index) => ({
      ...question,
      ...overrides[index],
    }));
  };

  const publishedTemplate = async (
    approvalMode: 'automatic' | 'manual',
    qs: Question[] = questions(),
  ) => {
    const created = (
      await org.admin
        .post('/templates', { name: `Reception ${uid()}`, approvalMode })
        .expect(201)
    ).body as CheckTemplateDetail;
    await org.admin
      .put(`/templates/${created.id}/draft`, { questions: qs })
      .expect(200);
    await org.admin.post(`/templates/${created.id}/publish`).expect(200);
    return created.id;
  };

  const newPlant = async (
    client: ApiClient = operative.client,
    type = typeId,
  ) =>
    (
      (
        await client
          .post('/plants', {
            name: `Dumper ${uid()}`,
            plantTypeId: type,
            ownership: 'hired',
            companyId: hireId,
            siteId,
          })
          .expect(201)
      ).body as PlantSaved
    ).plant;

  const assign = async (plantId: string, templateId: string) =>
    (
      (
        await supervisor.client
          .post(`/plants/${plantId}/reception`, { templateId })
          .expect(201)
      ).body as PlantReception
    ).current!;

  /** Answers every question so that the check passes. */
  const answerAll = async (
    client: ApiClient,
    checkId: string,
    condition: 'pass' | 'fail' = 'pass',
  ) => {
    await client
      .put(`/receptions/${checkId}/answers`, {
        answers: [
          {
            questionId: 'q-condition',
            value: condition,
            comment: condition === 'fail' ? 'Cracked boom' : undefined,
          },
          { questionId: 'q-guards', value: 'yes' },
          { questionId: 'q-hours', value: 1520 },
        ],
      })
      .expect(200);
    await client
      .post(`/receptions/${checkId}/questions/q-photo/evidence`)
      .attach('file', PNG, { filename: 'plant.png' })
      .expect(201);
  };

  const plantOf = async (id: string) =>
    (await org.admin.get(`/plants/${id}`).expect(200)).body as PlantDetail;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
    siteId = await createSite(org.admin);
    const id = async (url: string, body: object) =>
      ((await org.admin.post(url, body).expect(201)).body as { id: string }).id;
    typeId = await id('/config/plant-types', { name: 'Dumper' });
    hireId = await id('/config/plant-companies', {
      kind: 'hire_company',
      name: 'Dump Hire',
    });
    meterId = await id('/config/meter-types', { name: 'Hours', unit: 'hrs' });
    supervisor = await createActiveUser(t, org.admin, {
      firstName: 'Rec',
      lastName: 'Supervisor',
      roleId: org.roleIds.supervisor,
      siteIds: [siteId],
    });
    operative = await createActiveUser(t, org.admin, {
      firstName: 'Rec',
      lastName: 'Operative',
      roleId: org.roleIds.operative,
      siteIds: [siteId],
    });
  });
  afterAll(() => t.close());

  describe('templates', () => {
    it('freezes a published version and edits a new draft (TMP-002..004)', async () => {
      const templateId = await publishedTemplate('manual');
      const detail = (
        await org.admin.get(`/templates/${templateId}`).expect(200)
      ).body as CheckTemplateDetail;
      expect(detail).toMatchObject({
        publishedVersion: 1,
        hasDraft: false,
        questionCount: 5,
      });

      const edited = (
        await org.admin
          .put(`/templates/${templateId}/draft`, {
            questions: questions().slice(0, 2),
          })
          .expect(200)
      ).body as CheckTemplateDetail;
      expect(edited.draft).toMatchObject({ version: 2, state: 'draft' });
      expect(edited.draft!.questions).toHaveLength(2);
      expect(edited.published).toMatchObject({ version: 1 });
      expect(edited.published!.questions).toHaveLength(5);

      // The database itself refuses to change a published version.
      await expect(
        t.dataSource.query(
          `update corecheck.check_template_versions set questions = '[]'
            where template_id = $1 and version = 1`,
          [templateId],
        ),
      ).rejects.toThrow(/TEMPLATE_VERSION_PUBLISHED/);
    });

    it('checks question settings and refuses to publish an empty template', async () => {
      const created = (
        await org.admin
          .post('/templates', { name: `Empty ${uid()}` })
          .expect(201)
      ).body as CheckTemplateDetail;
      await org.admin.post(`/templates/${created.id}/publish`).expect(400);

      const noMeter = await org.admin
        .put(`/templates/${created.id}/draft`, {
          questions: [{ id: 'm', text: 'Hours', type: 'meter' }],
        })
        .expect(400);
      expect(noMeter.body.fieldErrors[0].field).toBe('questions.0.meterTypeId');
      const cannotFail = await org.admin
        .put(`/templates/${created.id}/draft`, {
          questions: [
            { id: 'n', text: 'Notes', type: 'text', offlineOnFail: true },
          ],
        })
        .expect(400);
      expect(cannotFail.body.fieldErrors[0].field).toBe(
        'questions.0.offlineOnFail',
      );
    });

    it('lets only those allowed manage templates (TMP-001)', async () => {
      const manager = await createActiveUser(t, org.admin, {
        firstName: 'Tmpl',
        lastName: 'Manager',
        roleId: org.roleIds.manager,
        siteIds: [siteId],
      });
      await manager.client
        .post('/templates', { name: 'Not allowed' })
        .expect(403);
      await manager.client.get('/templates').expect(200);
      await operative.client.get('/templates').expect(403);
    });
  });

  describe('reception', () => {
    it('lets an Operative register plant and submit reception that approves it automatically (REC-005, ITDR acceptance)', async () => {
      const templateId = await publishedTemplate('automatic');
      const plant = await newPlant();
      const check = await assign(plant.id, templateId);
      expect(check).toMatchObject({
        status: 'open',
        template: { version: 1, approvalMode: 'automatic' },
      });

      // Every gap is reported at once against its question.
      const incomplete = await operative.client
        .post(`/receptions/${check.id}/submit`)
        .expect(400);
      expect(
        (incomplete.body.fieldErrors as Array<{ field: string }>).map(
          (error) => error.field,
        ),
      ).toEqual([
        'answers.q-condition',
        'answers.q-guards',
        'answers.q-photo',
        'answers.q-hours',
      ]);

      await answerAll(operative.client, check.id);
      const result = (
        await operative.client
          .post(`/receptions/${check.id}/submit`)
          .expect(200)
      ).body as PlantReception;
      expect(result.current).toMatchObject({
        status: 'approved',
        outcomeReasons: [],
      });
      const approved = await plantOf(plant.id);
      expect(approved.status).toBe('approved');
      expect(approved.approvedAt).not.toBeNull();
      // Every answer records who gave it.
      expect(
        result.current!.answers.every(
          (answer) => answer.answeredBy === 'Rec Operative',
        ),
      ).toBe(true);
    });

    describe('with plant information required before approval (PLT-008, REC-007)', () => {
      const requireDetails = (requiredFields: string[]) =>
        org.admin.put('/config/plant-settings', { requiredFields }).expect(200);
      afterEach(() => requireDetails([]));

      const historyOf = async (plantId: string) =>
        (
          (await org.admin.get(`/plants/${plantId}/history`).expect(200))
            .body as { items: Array<{ action: string }> }
        ).items.map((event) => event.action);

      // Milestone 2 bug 4: the reviewer's Approve bypassed this check.
      it.each([
        ['plantNumber', 'Plant Number', 'manual'],
        ['serialNumber', 'Serial Number', 'manual'],
        ['make', 'Make', 'manual'],
        ['model', 'Model', 'manual'],
        ['plantNumber', 'Plant Number', 'automatic'],
      ] as const)(
        'holds plant without its %s Restricted/Offline and blocks approval until it is added (%s, %s approval)',
        async (field, label, mode) => {
          await requireDetails([field]);
          const templateId = await publishedTemplate(mode);
          const plant = await newPlant();
          const check = await assign(plant.id, templateId);
          await answerAll(operative.client, check.id);
          const result = (
            await operative.client
              .post(`/receptions/${check.id}/submit`)
              .expect(200)
          ).body as PlantReception;
          expect(result.current).toMatchObject({
            status: 'submitted',
            outcomeReasons: [`Missing plant information: ${label}`],
          });
          const held = await plantOf(plant.id);
          expect(held.status).toBe('restricted');
          expect(held.statusNote).toBe(`Missing plant information: ${label}`);

          const blocked = await supervisor.client
            .post(`/receptions/${check.id}/approve`)
            .expect(409);
          expect(blocked.body).toMatchObject({
            code: 'PLANT_DETAILS_MISSING',
            details: { missingDetails: [label] },
          });
          expect(blocked.body.message).toContain(label);
          expect((await plantOf(plant.id)).status).toBe('restricted');

          // Adding the information alone does not bring it Online.
          await org.admin
            .patch(`/plants/${plant.id}`, { [field]: 'QA-123' })
            .expect(200);
          expect((await plantOf(plant.id)).status).toBe('restricted');
          await supervisor.client
            .post(`/receptions/${check.id}/approve`)
            .expect(200);
          expect((await plantOf(plant.id)).status).toBe('approved');
          expect(await historyOf(plant.id)).toEqual(
            expect.arrayContaining(['plant.restricted', 'plant.approved']),
          );
        },
      );

      it('blocks approval while a custom field required since registration is empty', async () => {
        // Required custom fields are asked for at registration, so one is
        // missing only when it became required after the plant was added.
        const plant = await newPlant();
        const field = (
          await org.admin
            .post('/config/custom-fields', {
              label: `Fuel ${uid()}`,
              fieldType: 'text',
              required: true,
            })
            .expect(201)
        ).body as { id: string; label: string };
        try {
          const templateId = await publishedTemplate('manual');
          const check = await assign(plant.id, templateId);
          await answerAll(operative.client, check.id);
          await operative.client
            .post(`/receptions/${check.id}/submit`)
            .expect(200);
          expect((await plantOf(plant.id)).status).toBe('restricted');
          const blocked = await supervisor.client
            .post(`/receptions/${check.id}/approve`)
            .expect(409);
          expect(blocked.body.code).toBe('PLANT_DETAILS_MISSING');
          expect(blocked.body.message).toContain(field.label);
        } finally {
          await org.admin
            .post(`/config/custom-fields/${field.id}/archive`)
            .expect(200);
        }
      });

      it('blocks approval when the information is required after submission', async () => {
        const templateId = await publishedTemplate('manual');
        const plant = await newPlant();
        const check = await assign(plant.id, templateId);
        await answerAll(operative.client, check.id);
        await operative.client
          .post(`/receptions/${check.id}/submit`)
          .expect(200);
        expect((await plantOf(plant.id)).status).toBe('awaiting_approval');
        await requireDetails(['model']);
        const blocked = await supervisor.client
          .post(`/receptions/${check.id}/approve`)
          .expect(409);
        expect(blocked.body.code).toBe('PLANT_DETAILS_MISSING');
        expect((await plantOf(plant.id)).status).toBe('awaiting_approval');
      });

      it('blocks return to service while required information is missing, even with an override', async () => {
        const templateId = await publishedTemplate('automatic');
        const plant = await newPlant();
        const check = await assign(plant.id, templateId);
        await answerAll(operative.client, check.id);
        await operative.client
          .post(`/receptions/${check.id}/submit`)
          .expect(200);
        expect((await plantOf(plant.id)).status).toBe('approved');
        await org.admin
          .post(`/plants/${plant.id}/restrict`, { note: 'Hydraulic leak' })
          .expect(200);

        await requireDetails(['serialNumber']);
        for (const body of [
          { note: 'Leak fixed' },
          { note: 'Leak fixed', override: true, reviewOn: '2099-01-01' },
        ]) {
          const blocked = await org.admin
            .post(`/plants/${plant.id}/return-to-service`, body)
            .expect(409);
          expect(blocked.body).toMatchObject({
            code: 'PLANT_DETAILS_MISSING',
            details: { missingDetails: ['Serial Number'] },
          });
        }
        expect((await plantOf(plant.id)).status).toBe('restricted');

        await org.admin
          .patch(`/plants/${plant.id}`, { serialNumber: 'SN-1' })
          .expect(200);
        await org.admin
          .post(`/plants/${plant.id}/return-to-service`, { note: 'Leak fixed' })
          .expect(200);
        expect((await plantOf(plant.id)).status).toBe('approved');
      });

      it('lifts a restriction on never-approved plant to Pending Reception, which goes through reception again', async () => {
        await requireDetails(['make']);
        const plant = await newPlant();
        await org.admin
          .post(`/plants/${plant.id}/restrict`, { note: 'Damaged on delivery' })
          .expect(200);
        await org.admin
          .post(`/plants/${plant.id}/return-to-service`, { note: 'Repaired' })
          .expect(200);
        expect((await plantOf(plant.id)).status).toBe('pending_reception');
      });

      it('keeps the settings to those allowed to manage them', async () => {
        await operative.client.get('/config/plant-settings').expect(403);
      });
    });

    // Milestone 2 bug 2: a negative reading is refused, never saved as 0.
    it('refuses a negative meter answer and keeps what was saved before', async () => {
      const templateId = await publishedTemplate('manual');
      const plant = await newPlant();
      const check = await assign(plant.id, templateId);
      await answerAll(operative.client, check.id);
      const refused = await operative.client
        .put(`/receptions/${check.id}/answers`, {
          answers: [{ questionId: 'q-hours', value: -1 }],
        })
        .expect(400);
      expect(refused.body.fieldErrors).toEqual([
        {
          field: 'answers.q-hours',
          message: 'Enter the meter reading as a number of 0 or more.',
        },
      ]);
      const reception = (
        await operative.client.get(`/plants/${plant.id}/reception`).expect(200)
      ).body as PlantReception;
      expect(
        reception.current!.answers.find((a) => a.questionId === 'q-hours')!
          .value,
      ).toBe(1520);
    });

    it('takes plant Offline when a question set to do so fails (REC-AC-01)', async () => {
      const templateId = await publishedTemplate('automatic');
      const plant = await newPlant();
      const check = await assign(plant.id, templateId);
      await operative.client
        .put(`/receptions/${check.id}/answers`, {
          answers: [{ questionId: 'q-condition', value: 'fail' }],
        })
        .expect(200);
      await answerAll(operative.client, check.id, 'fail');
      const result = (
        await operative.client
          .post(`/receptions/${check.id}/submit`)
          .expect(200)
      ).body as PlantReception;
      expect(result.current).toMatchObject({
        status: 'restricted',
        outcomeReasons: ['Failed: Overall condition acceptable'],
      });
      expect(await plantOf(plant.id)).toMatchObject({
        status: 'restricted',
        statusNote: 'Reception failed: Overall condition acceptable',
      });
    });

    it('needs a comment when a failed answer requires one', async () => {
      const templateId = await publishedTemplate('automatic');
      const plant = await newPlant();
      const check = await assign(plant.id, templateId);
      await answerAll(operative.client, check.id);
      await operative.client
        .put(`/receptions/${check.id}/answers`, {
          answers: [{ questionId: 'q-condition', value: 'fail' }],
        })
        .expect(200);
      const refused = await operative.client
        .post(`/receptions/${check.id}/submit`)
        .expect(400);
      expect(refused.body.fieldErrors).toEqual([
        {
          field: 'answers.q-condition',
          message: 'Add a comment: Overall condition acceptable',
        },
      ]);
    });

    it('waits for manual approval, locks the Operative out of plant details, and keeps every submission when returned (REC-006, REC-007, PLC-004)', async () => {
      const templateId = await publishedTemplate('manual');
      const plant = await newPlant();
      const check = await assign(plant.id, templateId);
      await answerAll(operative.client, check.id);
      const submitted = (
        await operative.client
          .post(`/receptions/${check.id}/submit`)
          .expect(200)
      ).body as PlantReception;
      expect(submitted.current!.status).toBe('submitted');
      expect((await plantOf(plant.id)).status).toBe('awaiting_approval');

      // Submitted: the Operative can no longer change the plant or answers.
      await operative.client
        .patch(`/plants/${plant.id}`, { make: 'Thwaites' })
        .expect(403);
      await operative.client
        .put(`/receptions/${check.id}/answers`, {
          answers: [{ questionId: 'q-hours', value: 1600 }],
        })
        .expect(409);
      await operative.client
        .post(`/receptions/${check.id}/approve`)
        .expect(403);

      const returned = (
        await supervisor.client
          .post(`/receptions/${check.id}/return`, { comment: 'Wrong hours' })
          .expect(200)
      ).body as PlantReception;
      expect(returned.current).toMatchObject({
        status: 'returned',
        reviewComment: 'Wrong hours',
      });
      expect((await plantOf(plant.id)).status).toBe('pending_reception');

      // Correct and send again; the first submission stays on record.
      await operative.client
        .patch(`/plants/${plant.id}`, { make: 'Thwaites' })
        .expect(200);
      await operative.client
        .put(`/receptions/${check.id}/answers`, {
          answers: [{ questionId: 'q-hours', value: 1600 }],
        })
        .expect(200);
      await operative.client.post(`/receptions/${check.id}/submit`).expect(200);
      const approved = (
        await supervisor.client
          .post(`/receptions/${check.id}/approve`)
          .expect(200)
      ).body as PlantReception;
      expect(approved.current!.status).toBe('approved');
      expect(approved.current!.reviewedBy).toBe('Rec Supervisor');
      const hours = approved.current!.submissions.map(
        (submission) =>
          submission.answers.find((a) => a.questionId === 'q-hours')!.value,
      );
      expect(hours).toEqual([1600, 1520]);
      expect((await plantOf(plant.id)).status).toBe('approved');
    });

    describe('with a mandatory document (DOC-004, DOC-006, REC-AC-02)', () => {
      /** A plant type requiring one document; returns both ids. */
      const strictPlantType = async () => {
        const docTypeId = (
          (
            await org.admin
              .post('/config/document-types', { name: `Insurance ${uid()}` })
              .expect(201)
          ).body as { id: string }
        ).id;
        const plantTypeId = (
          (
            await org.admin
              .post('/config/plant-types', { name: `Strict ${uid()}` })
              .expect(201)
          ).body as { id: string }
        ).id;
        await org.admin
          .put(`/config/plant-types/${plantTypeId}/required-documents`, {
            documentTypeIds: [docTypeId],
          })
          .expect(200);
        return { docTypeId, plantTypeId };
      };

      const uploadVerified = async (plantId: string, docTypeId: string) => {
        const doc = (
          await operative.client
            .post(`/plants/${plantId}/documents`)
            .field('documentTypeId', docTypeId)
            .field('expiresOn', '2099-01-01')
            .attach('file', PDF, { filename: 'policy.pdf' })
            .expect(201)
        ).body as { id: string };
        await supervisor.client.post(`/documents/${doc.id}/verify`).expect(200);
        return doc.id;
      };

      const historyOf = async (plantId: string) =>
        (
          (await org.admin.get(`/plants/${plantId}/history`).expect(200))
            .body as { items: Array<{ action: string; summary: string }> }
        ).items;

      it.each(['automatic', 'manual'] as const)(
        'puts passed plant Restricted/Offline while the document is missing, and Online once it is valid and approved (%s approval)',
        async (mode) => {
          const { docTypeId, plantTypeId } = await strictPlantType();
          const templateId = await publishedTemplate(mode);
          const plant = await newPlant(operative.client, plantTypeId);
          const check = await assign(plant.id, templateId);
          await answerAll(operative.client, check.id);
          const result = (
            await operative.client
              .post(`/receptions/${check.id}/submit`)
              .expect(200)
          ).body as PlantReception;

          // Passed, still waiting for a reviewer, but out of use meanwhile.
          expect(result.current!.status).toBe('submitted');
          expect(result.current!.outcomeReasons).toEqual([
            expect.stringMatching(
              /^Document not valid: Insurance .* \(Missing\)$/,
            ),
          ]);
          const restricted = await plantOf(plant.id);
          expect(restricted.status).toBe('restricted');
          expect(restricted.statusNote).toMatch(
            /^Mandatory documents not valid: Insurance .* \(Missing\)$/,
          );
          const history = await historyOf(plant.id);
          expect(history.map((event) => event.action)).toContain(
            'plant.restricted',
          );

          // Counted with Restricted/Offline plant in the register.
          const register = (
            await org.admin
              .get(`/plants?status=restricted&search=${restricted.assetId}`)
              .expect(200)
          ).body as { items: Array<{ id: string }> };
          expect(register.items.map((item) => item.id)).toContain(plant.id);

          const blocked = await supervisor.client
            .post(`/receptions/${check.id}/approve`)
            .expect(409);
          expect(blocked.body.code).toBe('DOCUMENTS_NOT_VALID');
          expect((await plantOf(plant.id)).status).toBe('restricted');

          await uploadVerified(plant.id, docTypeId);
          // A valid document alone does not bring it Online: approval does.
          expect((await plantOf(plant.id)).status).toBe('restricted');
          await supervisor.client
            .post(`/receptions/${check.id}/approve`)
            .expect(200);
          expect((await plantOf(plant.id)).status).toBe('approved');
        },
      );

      it('goes Awaiting Approval when the document is already valid', async () => {
        const { docTypeId, plantTypeId } = await strictPlantType();
        const templateId = await publishedTemplate('manual');
        const plant = await newPlant(operative.client, plantTypeId);
        await uploadVerified(plant.id, docTypeId);
        const check = await assign(plant.id, templateId);
        await answerAll(operative.client, check.id);
        await operative.client
          .post(`/receptions/${check.id}/submit`)
          .expect(200);
        expect((await plantOf(plant.id)).status).toBe('awaiting_approval');
      });

      it('restricts plant awaiting approval when its document stops being valid', async () => {
        const { docTypeId, plantTypeId } = await strictPlantType();
        const templateId = await publishedTemplate('manual');
        const plant = await newPlant(operative.client, plantTypeId);
        const docId = await uploadVerified(plant.id, docTypeId);
        const check = await assign(plant.id, templateId);
        await answerAll(operative.client, check.id);
        await operative.client
          .post(`/receptions/${check.id}/submit`)
          .expect(200);
        expect((await plantOf(plant.id)).status).toBe('awaiting_approval');

        await supervisor.client
          .post(`/documents/${docId}/reject`, { reason: 'Wrong plant' })
          .expect(200);
        const after = await plantOf(plant.id);
        expect(after.status).toBe('restricted');
        expect(after.statusNote).toMatch(/\(Rejected\)$/);
        const blocked = await supervisor.client
          .post(`/receptions/${check.id}/approve`)
          .expect(409);
        expect(blocked.body.code).toBe('DOCUMENTS_NOT_VALID');
      });
    });

    it('keeps the template version a check started from (REC-008, TMP-AC-03)', async () => {
      const templateId = await publishedTemplate('manual');
      const plant = await newPlant();
      const check = await assign(plant.id, templateId);
      await org.admin
        .put(`/templates/${templateId}/draft`, {
          questions: questions().slice(0, 1),
        })
        .expect(200);
      await org.admin.post(`/templates/${templateId}/publish`).expect(200);
      const reception = (
        await operative.client.get(`/plants/${plant.id}/reception`).expect(200)
      ).body as PlantReception;
      expect(reception.current!.template.version).toBe(1);
      expect(reception.current!.questions).toHaveLength(5);
      // A new check would use version 2.
      await supervisor.client
        .post(`/receptions/${check.id}/cancel`)
        .expect(200);
      const fresh = await assign(plant.id, templateId);
      expect(fresh.template.version).toBe(2);
    });

    it('guards who may assign, answer and see reception', async () => {
      const templateId = await publishedTemplate('manual');
      const plant = await newPlant();
      await operative.client
        .post(`/plants/${plant.id}/reception`, { templateId })
        .expect(403);
      const check = await assign(plant.id, templateId);
      // One reception at a time.
      await supervisor.client
        .post(`/plants/${plant.id}/reception`, { templateId })
        .expect(409);
      const unknown = await operative.client
        .put(`/receptions/${check.id}/answers`, {
          answers: [{ questionId: 'nope', value: 'pass' }],
        })
        .expect(400);
      expect(unknown.body.fieldErrors[0].field).toBe('answers.nope');
      await operative.client
        .put(`/receptions/${check.id}/answers`, {
          answers: [{ questionId: 'q-condition', value: 'maybe' }],
        })
        .expect(400);
      await operative.client
        .post(`/receptions/${check.id}/questions/q-photo/evidence`)
        .attach('file', PDF, { filename: 'photo.pdf' })
        .expect(400);

      const elsewhere = await createActiveUser(t, org.admin, {
        firstName: 'Rec',
        lastName: 'Elsewhere',
        roleId: org.roleIds.operative,
        siteIds: [await createSite(org.admin)],
      });
      await elsewhere.client.get(`/plants/${plant.id}/reception`).expect(404);
      await elsewhere.client
        .put(`/receptions/${check.id}/answers`, { answers: [] })
        .expect(404);
      const other = await setUpOrganisation(t, staff);
      await other.admin.post(`/receptions/${check.id}/submit`).expect(404);
    });

    it('records reception in the plant history', async () => {
      const templateId = await publishedTemplate('automatic');
      const plant = await newPlant();
      const check = (await assign(plant.id, templateId)) as ReceptionCheck;
      await answerAll(operative.client, check.id);
      await operative.client.post(`/receptions/${check.id}/submit`).expect(200);
      const history = (
        await org.admin.get(`/plants/${plant.id}/history`).expect(200)
      ).body as { items: Array<{ action: string }> };
      expect(history.items.map((event) => event.action)).toEqual(
        expect.arrayContaining([
          'reception.assigned',
          'reception.submitted',
          'plant.approved',
        ]),
      );
    });
  });
});
