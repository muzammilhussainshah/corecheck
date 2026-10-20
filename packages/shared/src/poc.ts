/**
 * The fixed check used by the offline synchronisation proof of concept
 * (Milestone 1). Milestone 3 replaces it with versioned templates.
 */
export const POC_QUESTIONS = [
  {
    key: 'condition',
    label: 'Is the plant in safe working condition?',
    type: 'pass_fail',
    mandatory: true,
  },
  {
    key: 'notes',
    label: 'Notes',
    type: 'text',
    mandatory: false,
  },
  {
    key: 'photo',
    label: 'Photo of the plant',
    type: 'photo',
    mandatory: true,
  },
] as const;

export type PocQuestionKey = (typeof POC_QUESTIONS)[number]['key'];

export const POC_QUESTION_KEYS = POC_QUESTIONS.map(
  (question) => question.key,
) as [PocQuestionKey, ...PocQuestionKey[]];

export const POC_CHECK_STATUSES = ['open', 'submitted'] as const;
export type PocCheckStatus = (typeof POC_CHECK_STATUSES)[number];

/** Largest evidence photo the proof of concept accepts, in bytes. */
export const POC_MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
