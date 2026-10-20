import {
  POC_QUESTIONS,
  type PocCheck,
  type PocMutationResult,
  type PocQuestionKey,
} from '@corecheck/shared';

/**
 * Pure rules of the offline proof of concept, kept free of React Native so
 * they can be unit-tested: what the device shows for a check, whether it can
 * be submitted, and what to do with each sync outcome.
 */

export interface LocalAnswer {
  checkId: string;
  questionKey: PocQuestionKey;
  value: string;
  answeredAt: string;
}

export interface LocalPhoto {
  id: string;
  checkId: string;
  questionKey: PocQuestionKey;
  uri: string;
  capturedAt: string;
  uploaded: boolean;
}

export interface Rejection {
  checkId: string;
  message: string;
}

export interface CheckView {
  check: PocCheck;
  /** Value per question: the local (unsynced) answer wins over the server's. */
  answers: Partial<Record<PocQuestionKey, string>>;
  photos: LocalPhoto[];
  hasServerPhoto: boolean;
  /** Submitted on this device, waiting to reach the server. */
  submitQueued: boolean;
  pendingChanges: number;
  rejection: Rejection | null;
}

export const buildView = (
  check: PocCheck,
  local: LocalAnswer[],
  photos: LocalPhoto[],
  submitQueued: boolean,
  rejection: Rejection | null,
): CheckView => {
  const answers: CheckView['answers'] = {};
  for (const answer of check.answers)
    answers[answer.questionKey] = answer.value;
  const mine = local.filter((answer) => answer.checkId === check.id);
  for (const answer of mine) answers[answer.questionKey] = answer.value;
  const myPhotos = photos.filter((photo) => photo.checkId === check.id);
  return {
    check,
    answers,
    photos: myPhotos,
    hasServerPhoto: check.evidence.some(
      (evidence) => evidence.questionKey === 'photo',
    ),
    submitQueued,
    pendingChanges:
      mine.length +
      myPhotos.filter((photo) => !photo.uploaded).length +
      (submitQueued ? 1 : 0),
    rejection,
  };
};

/** Mandatory questions still unanswered (CHK-006), checked before queuing a submit. */
export const missingMandatory = (view: CheckView): string[] =>
  POC_QUESTIONS.filter((question) => {
    if (!question.mandatory) return false;
    if (question.type === 'photo')
      return view.photos.length === 0 && !view.hasServerPhoto;
    return !view.answers[question.key];
  }).map((question) => question.label);

export type OutcomeAction =
  { kind: 'done' } | { kind: 'rejected'; message: string };

/** What the outbox does with one server result. */
export const outcomeOf = (result: PocMutationResult): OutcomeAction =>
  result.status === 'rejected'
    ? { kind: 'rejected', message: result.message }
    : { kind: 'done' };

/** Ids held locally that the server no longer returns: access was removed (MOB-AC-03). */
export const revokedIds = (
  localIds: string[],
  serverChecks: PocCheck[],
): string[] => {
  const current = new Set(serverChecks.map((check) => check.id));
  return localIds.filter((id) => !current.has(id));
};
