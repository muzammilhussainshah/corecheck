import { pull, push, RequestFailed, uploadPhoto } from './api';
import {
  clearSyncedAnswers,
  forgetChecks,
  loadChecks,
  loadOutbox,
  loadPhotos,
  markPhotoUploaded,
  recordRejection,
  removeFromOutbox,
  replaceChecks,
} from './db';
import { outcomeOf, revokedIds } from './model';

export interface SyncResult {
  /** Checks removed from the device because access was withdrawn. */
  removed: number;
}

let running: Promise<SyncResult> | null = null;

/**
 * One synchronisation pass (MOB-005):
 *
 * 1. Upload queued photos first, so a queued submission finds its evidence.
 * 2. Send queued answers and submissions in the order they were made. A
 *    rejection (another user submitted first, or access was removed) is
 *    recorded for the user to see and is not retried (MOB-007).
 * 3. Download the current authorised checks and delete anything else held on
 *    the device (MOB-AC-03).
 *
 * Without a connection it stops at the first failed request and leaves the
 * queue untouched for the next attempt. Concurrent calls share one pass.
 */
export const syncNow = (): Promise<SyncResult> => {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
};

const run = async (): Promise<SyncResult> => {
  for (const photo of (await loadPhotos()).filter((item) => !item.uploaded)) {
    try {
      await uploadPhoto(photo);
      await markPhotoUploaded(photo.id);
    } catch (error) {
      if (
        error instanceof RequestFailed &&
        !error.offline &&
        !error.sessionEnded
      ) {
        await recordRejection(photo.checkId, error.error.message);
        await markPhotoUploaded(photo.id);
      } else {
        throw error;
      }
    }
  }

  const outbox = await loadOutbox();
  for (let start = 0; start < outbox.length; start += 200) {
    const batch = outbox.slice(start, start + 200);
    const { results } = await push(batch);
    for (const result of results) {
      const outcome = outcomeOf(result);
      const mutation = batch.find((item) => item.id === result.id)!;
      if (outcome.kind === 'rejected')
        await recordRejection(mutation.checkId, outcome.message);
      await removeFromOutbox(result.id);
    }
  }

  const snapshot = await pull();
  const revoked = revokedIds(
    (await loadChecks()).map((check) => check.id),
    snapshot.checks,
  );
  await forgetChecks(revoked);
  await replaceChecks(snapshot.checks);
  await clearSyncedAnswers();
  return { removed: revoked.length };
};
