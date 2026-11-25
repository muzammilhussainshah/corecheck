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
  /** Single selection only: the choices, in order. */
  options: string[];
  /** Single selection only: the choices that count as a fail. */
  failOptions: string[];
  /** A failed answer takes plant Restricted/Offline (REC-003, TMP-009). */
  offlineOnFail: boolean;
  /**
   * The defect trigger: a failed answer raises a Defect of this severity
   * (TMP-009, DEF-002). Null raises none (DEF-AC-01).
   */
  defectSeverity: DefectSeverity | null;
  /**
   * Conditional follow-up (TMP-009): asked only when an earlier question
   * was answered this way. A question not asked is never mandatory.
   */
  showIf: QuestionCondition | null;
}

export interface QuestionCondition {
  /** An earlier question of the same version. */
  questionId: string;
  /** fail / pass: that question failed or passed; values: one of `values`. */
  when: 'fail' | 'pass' | 'values';
  values: string[];
}

export type AnswerValue = string | number | boolean | null;

/**
 * A question as saved by any version, with settings added since filled in,
 * so a version published before them reads the same as it always did.
 */
export const normaliseQuestion = (
  question: Partial<TemplateQuestion> & Pick<TemplateQuestion, 'id' | 'text'>,
): TemplateQuestion => ({
  type: 'text',
  mandatory: true,
  failAnswer: null,
  min: null,
  max: null,
  meterTypeId: null,
  requireComment: 'never',
  requirePhoto: 'never',
  offlineOnFail: false,
  defectSeverity: null,
  ...question,
  options: question.options ?? [],
  failOptions: question.failOptions ?? [],
  showIf: question.showIf ?? null,
});

/** Whether any answer to the question can be a fail. */
export const questionCanFail = (question: TemplateQuestion): boolean =>
  question.type === 'pass_fail' ||
  (question.type === 'yes_no' && question.failAnswer !== null) ||
  (question.type === 'single_select' &&
    (question.failOptions ?? []).length > 0) ||
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
    case 'single_select':
      return (
        typeof value === 'string' && (question.failOptions ?? []).includes(value)
      );
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

/** Whether a question holds an answer (a photo question counts its files). */
export const isAnswered = (
  question: TemplateQuestion,
  value: AnswerValue | undefined,
  evidenceCount: number,
): boolean =>
  question.type === 'photo'
    ? evidenceCount > 0
    : value !== null && value !== undefined && value !== '';

/**
 * Whether a question is asked, given the answers so far (TMP-009). A
 * follow-up is asked only when the question it follows is itself asked and
 * was answered the way its condition names.
 */
export const questionVisible = (
  question: TemplateQuestion,
  questions: readonly TemplateQuestion[],
  valueOf: (questionId: string) => AnswerValue | undefined,
  seen: ReadonlySet<string> = new Set(),
): boolean => {
  const condition = question.showIf;
  if (!condition) return true;
  if (seen.has(question.id)) return false;
  const parent = questions.find((item) => item.id === condition.questionId);
  if (!parent) return false;
  if (!questionVisible(parent, questions, valueOf, new Set([...seen, question.id])))
    return false;
  const value = valueOf(parent.id) ?? null;
  if (value === null || value === '') return false;
  switch (condition.when) {
    case 'fail':
      return answerFails(parent, value);
    case 'pass':
      return !answerFails(parent, value);
    case 'values':
      return condition.values.includes(String(value));
  }
};

/** Human wording of a follow-up condition, for builders and records. */
export const describeCondition = (
  condition: QuestionCondition,
  questions: readonly TemplateQuestion[],
): string => {
  const parent = questions.find((item) => item.id === condition.questionId);
  const name = parent ? `"${parent.text}"` : 'an earlier question';
  switch (condition.when) {
    case 'fail':
      return `Asked when ${name} fails`;
    case 'pass':
      return `Asked when ${name} passes`;
    case 'values':
      return `Asked when ${name} is ${condition.values.join(' or ')}`;
  }
};
