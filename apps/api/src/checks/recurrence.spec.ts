import {
  availableOnFor,
  describeRecurrence,
  displayStatus,
  nextAfter,
  type Recurrence,
} from './recurrence.js';

const every = (
  frequency: Recurrence['frequency'],
  customUnit: Recurrence['customUnit'] = null,
  customCount: number | null = null,
): Recurrence => ({ frequency, customUnit, customCount });

describe('schedule recurrence (SCH-002, SCH-006, SCH-009)', () => {
  it.each([
    [every('daily'), '2026-03-31', '2026-04-01'],
    [every('weekly'), '2026-12-28', '2027-01-04'],
    [every('monthly'), '2026-01-31', '2026-02-28'],
    [every('monthly'), '2028-01-31', '2028-02-29'],
    [every('quarterly'), '2026-11-30', '2027-02-28'],
    [every('annual'), '2028-02-29', '2029-02-28'],
    [every('custom', 'day', 10), '2026-11-25', '2026-12-05'],
    [every('custom', 'week', 6), '2026-11-25', '2027-01-06'],
    [every('custom', 'month', 18), '2026-08-31', '2028-02-29'],
    [every('custom', 'year', 2), '2026-11-25', '2028-11-25'],
  ])('%o after %s is %s', (recurrence, from, expected) => {
    expect(nextAfter(from, recurrence)).toBe(expected);
  });

  it('opens weekly work on the Monday of its week and monthly work on the first', () => {
    // Sunday 29 November 2026 is in the week starting Monday 23 November.
    expect(availableOnFor('2026-11-29', every('weekly'))).toBe('2026-11-23');
    expect(availableOnFor('2026-11-23', every('weekly'))).toBe('2026-11-23');
    expect(availableOnFor('2026-11-25', every('daily'))).toBe('2026-11-25');
    expect(availableOnFor('2026-11-25', every('monthly'))).toBe('2026-11-01');
    expect(availableOnFor('2026-11-25', every('custom', 'week', 2))).toBe('2026-11-23');
  });

  it('describes the rule and shows Overdue only for unsubmitted work past its date', () => {
    expect(describeRecurrence(every('custom', 'week', 1))).toBe('Every week');
    expect(describeRecurrence(every('custom', 'month', 3))).toBe('Every 3 months');
    expect(displayStatus('due', '2026-11-24', '2026-11-25')).toBe('overdue');
    expect(displayStatus('in_progress', '2026-11-24', '2026-11-25')).toBe('overdue');
    expect(displayStatus('submitted', '2026-11-24', '2026-11-25')).toBe('submitted');
    expect(displayStatus('due', '2026-11-25', '2026-11-25')).toBe('due');
    expect(displayStatus('scheduled', '2026-11-20', '2026-11-25')).toBe('scheduled');
  });
});
