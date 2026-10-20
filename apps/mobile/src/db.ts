import { open } from '@op-engineering/op-sqlite';
import type { PocCheck, PocMutation, PocQuestionKey } from '@corecheck/shared';
import type { LocalAnswer, LocalPhoto, Rejection } from './model';

/**
 * The device's local database (MOB-003..005): the last downloaded checks, the
 * user's unsynced answers and photos, and an ordered outbox of mutations.
 * Everything survives app restarts and sign-outs, so offline work is never
 * lost; it is sent once the user is signed in and online again.
 *
 * Milestone 4 builds this with SQLCipher and a key held in the Keychain.
 */
const db = open({ name: 'corecheck.db' });

const SCHEMA = [
  `create table if not exists checks (id text primary key, data text not null)`,
  `create table if not exists answers (
     check_id text not null, question_key text not null, value text not null,
     answered_at text not null, primary key (check_id, question_key))`,
  `create table if not exists photos (
     id text primary key, check_id text not null, question_key text not null,
     uri text not null, captured_at text not null, uploaded integer not null default 0)`,
  `create table if not exists outbox (
     seq integer primary key autoincrement, id text not null unique,
     check_id text not null, payload text not null)`,
  `create table if not exists rejections (check_id text primary key, message text not null)`,
  `create table if not exists settings (key text primary key, value text not null)`,
];

let ready: Promise<void> | null = null;
export const initDatabase = (): Promise<void> => {
  ready ??= (async () => {
    for (const statement of SCHEMA) await db.execute(statement);
  })();
  return ready;
};

const rows = async <T>(
  sql: string,
  params: (string | number)[] = [],
): Promise<T[]> => (await db.execute(sql, params)).rows as unknown as T[];

// ------------------------------------------------------------- settings

export const getSetting = async (key: string): Promise<string | null> =>
  (
    await rows<{ value: string }>('select value from settings where key = ?', [
      key,
    ])
  )[0]?.value ?? null;

export const setSetting = (key: string, value: string) =>
  db.execute('insert or replace into settings (key, value) values (?, ?)', [
    key,
    value,
  ]);

// ---------------------------------------------------------------- checks

export const loadChecks = async (): Promise<PocCheck[]> =>
  (await rows<{ data: string }>('select data from checks')).map(
    (row) => JSON.parse(row.data) as PocCheck,
  );

/** Replaces the downloaded checks with the server's current, authorised set. */
export const replaceChecks = async (checks: PocCheck[]): Promise<void> => {
  await db.transaction(async (tx) => {
    await tx.execute('delete from checks');
    for (const check of checks) {
      await tx.execute('insert into checks (id, data) values (?, ?)', [
        check.id,
        JSON.stringify(check),
      ]);
    }
  });
};

/** Removes everything held for checks the user may no longer see. */
export const forgetChecks = async (ids: string[]): Promise<void> => {
  for (const id of ids) {
    for (const table of ['answers', 'photos', 'outbox', 'rejections']) {
      await db.execute(`delete from ${table} where check_id = ?`, [id]);
    }
  }
};

// ---------------------------------------------------- local work and outbox

export const loadAnswers = async (): Promise<LocalAnswer[]> =>
  rows<LocalAnswer>(
    `select check_id as checkId, question_key as questionKey, value, answered_at as answeredAt from answers`,
  );

export const loadPhotos = async (): Promise<LocalPhoto[]> =>
  (
    await rows<Omit<LocalPhoto, 'uploaded'> & { uploaded: number }>(
      `select id, check_id as checkId, question_key as questionKey, uri, captured_at as capturedAt, uploaded from photos`,
    )
  ).map((photo) => ({ ...photo, uploaded: photo.uploaded === 1 }));

export const loadRejections = async (): Promise<Rejection[]> =>
  rows<Rejection>('select check_id as checkId, message from rejections');

export const loadOutbox = async (): Promise<PocMutation[]> =>
  (
    await rows<{ payload: string }>('select payload from outbox order by seq')
  ).map((row) => JSON.parse(row.payload) as PocMutation);

export const queuedSubmits = async (): Promise<Set<string>> =>
  new Set(
    (await loadOutbox())
      .filter((mutation) => mutation.type === 'submit')
      .map((mutation) => mutation.checkId),
  );

/** Records an answer locally and queues it, with the device time (MOB-005). */
export const queueMutation = async (mutation: PocMutation): Promise<void> => {
  if (mutation.type === 'answer') {
    await db.execute(
      'insert or replace into answers (check_id, question_key, value, answered_at) values (?, ?, ?, ?)',
      [
        mutation.checkId,
        mutation.questionKey,
        mutation.value,
        mutation.answeredAt,
      ],
    );
  }
  await db.execute('delete from rejections where check_id = ?', [
    mutation.checkId,
  ]);
  await db.execute(
    'insert into outbox (id, check_id, payload) values (?, ?, ?)',
    [mutation.id, mutation.checkId, JSON.stringify(mutation)],
  );
};

export const removeFromOutbox = (id: string) =>
  db.execute('delete from outbox where id = ?', [id]);

export const addPhoto = (photo: Omit<LocalPhoto, 'uploaded'>) =>
  db.execute(
    'insert into photos (id, check_id, question_key, uri, captured_at, uploaded) values (?, ?, ?, ?, ?, 0)',
    [photo.id, photo.checkId, photo.questionKey, photo.uri, photo.capturedAt],
  );

export const markPhotoUploaded = (id: string) =>
  db.execute('update photos set uploaded = 1 where id = ?', [id]);

export const recordRejection = (checkId: string, message: string) =>
  db.execute(
    'insert or replace into rejections (check_id, message) values (?, ?)',
    [checkId, message],
  );

/** Drops local answers the server now holds, once nothing for them is queued. */
export const clearSyncedAnswers = async (): Promise<void> => {
  await db.execute(
    `delete from answers where not exists (
       select 1 from outbox o where o.check_id = answers.check_id)`,
  );
};

export type { PocQuestionKey };
