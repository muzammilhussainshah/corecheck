import { describe, expect, it } from 'vitest';
import {
  answerFails,
  normaliseQuestion,
  questionCanFail,
  questionVisible,
  type TemplateQuestion,
} from './reception.js';

const q = (question: Partial<TemplateQuestion> & { id: string }) =>
  normaliseQuestion({ text: question.id, ...question });

describe('template questions (TMP-009, TMP-010)', () => {
  const fuel = q({
    id: 'fuel',
    type: 'single_select',
    options: ['Full', 'Half', 'Empty'],
    failOptions: ['Empty'],
  });
  const tyres = q({ id: 'tyres', type: 'pass_fail' });
  const depth = q({
    id: 'depth',
    type: 'number',
    showIf: { questionId: 'tyres', when: 'fail', values: [] },
  });
  const refill = q({
    id: 'refill',
    type: 'yes_no',
    showIf: { questionId: 'fuel', when: 'values', values: ['Half', 'Empty'] },
  });
  const deep = q({
    id: 'deep',
    type: 'text',
    showIf: { questionId: 'depth', when: 'values', values: [] },
  });
  const questions = [tyres, depth, fuel, refill, deep];

  it('fails a single selection only on a failing choice', () => {
    expect(questionCanFail(fuel)).toBe(true);
    expect(answerFails(fuel, 'Empty')).toBe(true);
    expect(answerFails(fuel, 'Half')).toBe(false);
    expect(questionCanFail(q({ id: 'x', type: 'single_select', options: ['A', 'B'] }))).toBe(false);
  });

  it('asks a follow-up only when its condition is met', () => {
    const answers: Record<string, string> = {};
    const visible = (question: TemplateQuestion) =>
      questionVisible(question, questions, (id) => answers[id]);
    expect(visible(depth)).toBe(false);
    answers.tyres = 'fail';
    expect(visible(depth)).toBe(true);
    answers.tyres = 'pass';
    expect(visible(depth)).toBe(false);
    answers.fuel = 'Full';
    expect(visible(refill)).toBe(false);
    answers.fuel = 'Empty';
    expect(visible(refill)).toBe(true);
  });

  it('hides a follow-up of a question that is itself not asked', () => {
    const answers: Record<string, string | number> = { tyres: 'pass', depth: 3 };
    expect(questionVisible(deep, questions, (id) => answers[id])).toBe(false);
  });

  it('reads questions saved before Milestone 3 settings existed', () => {
    const old = normaliseQuestion({ id: 'old', text: 'Old', type: 'yes_no' });
    expect(old).toMatchObject({ options: [], failOptions: [], showIf: null });
  });
});
