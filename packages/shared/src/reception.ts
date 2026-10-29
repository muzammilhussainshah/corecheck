import type { DefectSeverity, EvidenceRule, QuestionType } from './statuses.js';

/**
 * A question in a check template (TMP-010, TMP-011). The id stays the same
 * across versions, so answers and evidence keep matching their question.
 */
export interface TemplateQuestion {
  id: string;
  text: string;
  type: QuestionType;
  mandatory: boolean;
  /** Yes/no only: the answer that counts as a fail. */
  failAnswer: 'yes' | 'no' | null;
  /** Number only: values outside min..max fail. */
  min: number | null;
  max: number | null;
  /** Meter reading only: which meter is read (MTR-003). */
  meterTypeId: string | null;
  requireComment: EvidenceRule;
  requirePhoto: EvidenceRule;
  /** A failed answer keeps plant Restricted/Offline (REC-003). */
  offlineOnFail: boolean;
  /** Saved now; Defects are raised from it in Milestone 4 (DEF-001). */
  defectSeverity: DefectSeverity | null;
}

export type AnswerValue = string | number | boolean | null;

/** Whether any answer to the question can be a fail. */
export const questionCanFail = (question: TemplateQuestion): boolean =>
  question.type === 'pass_fail' ||
  (question.type === 'yes_no' && question.failAnswer !== null) ||
  (question.type === 'number' &&
    (question.min !== null || question.max !== null));

/** Whether this answer fails the question (unanswered never fails). */
export const answerFails = (
  question: TemplateQuestion,
  value: AnswerValue,
): boolean => {
  if (value === null || value === '') return false;
  switch (question.type) {
    case 'pass_fail':
      return value === 'fail';
    case 'yes_no':
      return question.failAnswer !== null && value === question.failAnswer;
    case 'number': {
      if (typeof value !== 'number') return false;
      return (
        (question.min !== null && value < question.min) ||
        (question.max !== null && value > question.max)
      );
    }
    default:
      return false;
  }
};

/** Whether a comment or photo rule applies to this answer. */
export const evidenceRequired = (
  rule: EvidenceRule,
  failed: boolean,
): boolean => rule === 'always' || (rule === 'on_fail' && failed);
