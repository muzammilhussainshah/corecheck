import {
  type AnswerValue,
  answerFails,
  evidenceRequired,
  type FieldError,
  isAnswered,
  questionVisible,
  type TemplateQuestion,
} from '@corecheck/shared';

/** The value an answer of this type may hold; null clears it. */
export const valueProblem = (
  question: TemplateQuestion,
  value: AnswerValue,
): string | null => {
  if (value === null || value === '') return null;
  switch (question.type) {
    case 'pass_fail':
      return value === 'pass' || value === 'fail'
        ? null
        : 'Answer pass or fail.';
    case 'yes_no':
      return value === 'yes' || value === 'no' ? null : 'Answer yes or no.';
    case 'single_select':
      return typeof value === 'string' && question.options.includes(value)
        ? null
        : 'Choose one of the options.';
    case 'number':
      return typeof value === 'number' ? null : 'Enter a number.';
    case 'meter':
      return typeof value === 'number' && value >= 0
        ? null
        : 'Enter the meter reading as a number of 0 or more.';
    case 'text':
      return typeof value === 'string' ? null : 'Enter text.';
    case 'photo':
      return 'Add photos or files for this question instead of an answer.';
  }
};

export interface AnswerLike {
  questionId: string;
  value: AnswerValue;
  comment: string | null;
}

export interface Evaluation {
  /** Every gap at once, against its question (VAL-002, CHK-AC-01). */
  errors: FieldError[];
  /** Questions asked whose answer failed. */
  failed: TemplateQuestion[];
  /** Questions asked, in order; follow-ups not triggered are left out. */
  asked: TemplateQuestion[];
}

/**
 * Checks a set of answers against their questions before submission. Only
 * questions that are asked count: a follow-up whose condition is not met is
 * neither mandatory nor able to fail (TMP-009).
 */
export const evaluateAnswers = (
  questions: readonly TemplateQuestion[],
  answers: ReadonlyMap<string, AnswerLike>,
  evidenceCount: (questionId: string) => number,
): Evaluation => {
  const errors: FieldError[] = [];
  const failed: TemplateQuestion[] = [];
  const asked = questions.filter((question) =>
    questionVisible(question, questions, (id) => answers.get(id)?.value),
  );
  for (const question of asked) {
    const answer = answers.get(question.id);
    const value = answer?.value ?? null;
    const files = evidenceCount(question.id);
    const field = `answers.${question.id}`;
    if (question.mandatory && !isAnswered(question, value, files)) {
      errors.push({
        field,
        message:
          question.type === 'photo'
            ? `Add a photo or file: ${question.text}`
            : `Answer: ${question.text}`,
      });
      continue;
    }
    const fails = answerFails(question, value);
    if (fails) failed.push(question);
    if (evidenceRequired(question.requireComment, fails) && !answer?.comment)
      errors.push({ field, message: `Add a comment: ${question.text}` });
    if (
      question.type !== 'photo' &&
      evidenceRequired(question.requirePhoto, fails) &&
      files === 0
    )
      errors.push({ field, message: `Add a photo: ${question.text}` });
  }
  return { errors, failed, asked };
};

/** The wording of an answer for records and messages. */
export const answerText = (value: AnswerValue): string => {
  if (value === null || value === '') return 'No answer';
  if (value === 'pass') return 'Pass';
  if (value === 'fail') return 'Fail';
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  return String(value);
};
