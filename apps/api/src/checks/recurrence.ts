import {
  type CheckDisplayStatus,
  type CheckStatus,
  SCHEDULE_UNIT_LABELS,
  type ScheduleFrequency,
  type ScheduleUnit,
} from '@corecheck/shared';

/** How a schedule repeats. */
export interface Recurrence {
  frequency: ScheduleFrequency;
  customUnit: ScheduleUnit | null;
  customCount: number | null;
}

export const checkRef = (refNo: number): string =>
  `CHK-${String(refNo).padStart(6, '0')}`;

/** The interval as a unit and a count. */
const step = (
  recurrence: Recurrence,
): { unit: ScheduleUnit; count: number } => {
  switch (recurrence.frequency) {
    case 'daily':
      return { unit: 'day', count: 1 };
    case 'weekly':
      return { unit: 'week', count: 1 };
    case 'monthly':
      return { unit: 'month', count: 1 };
    case 'quarterly':
      return { unit: 'month', count: 3 };
    case 'annual':
      return { unit: 'year', count: 1 };
    case 'custom':
      return {
        unit: recurrence.customUnit ?? 'day',
        count: recurrence.customCount ?? 1,
      };
  }
};

const parse = (date: string): Date => new Date(`${date}T00:00:00Z`);
const format = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Adds days to a YYYY-MM-DD date. Calendar arithmetic is done in UTC on
 * purpose: these are dates in the organisation's time zone, not instants.
 */
export const addDaysTo = (date: string, days: number): string => {
  const value = parse(date);
  value.setUTCDate(value.getUTCDate() + days);
  return format(value);
};

/** Adds months, keeping to the last day of a shorter month (31 Jan + 1 = 28/29 Feb). */
const addMonthsTo = (date: string, months: number): string => {
  const value = parse(date);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate();
  value.setUTCDate(Math.min(day, last));
  return format(value);
};

/**
 * One interval after `date`; matches corecheck.schedule_interval() in the
 * database, which resumes schedules after a return to service.
 */
export const nextAfter = (date: string, recurrence: Recurrence): string => {
  const { unit, count } = step(recurrence);
  switch (unit) {
    case 'day':
      return addDaysTo(date, count);
    case 'week':
      return addDaysTo(date, count * 7);
    case 'month':
      return addMonthsTo(date, count);
    case 'year':
      return addMonthsTo(date, count * 12);
  }
};

/**
 * When a check due on `dueOn` becomes visible as Due: daily work on the day,
 * weekly work at the start of its week (Monday, SCH-006), and monthly or
 * longer work on the first of its month.
 */
export const availableOnFor = (
  dueOn: string,
  recurrence: Recurrence,
): string => {
  const { unit } = step(recurrence);
  if (unit === 'day') return dueOn;
  const value = parse(dueOn);
  if (unit === 'week') {
    const sinceMonday = (value.getUTCDay() + 6) % 7;
    return addDaysTo(dueOn, -sinceMonday);
  }
  return `${dueOn.slice(0, 8)}01`;
};

/** e.g. "Daily", "Every 6 weeks". */
export const describeRecurrence = (recurrence: Recurrence): string => {
  switch (recurrence.frequency) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'quarterly':
      return 'Quarterly';
    case 'annual':
      return 'Annual';
    case 'custom': {
      const { unit, count } = step(recurrence);
      return count === 1
        ? `Every ${SCHEDULE_UNIT_LABELS[unit].replace(/s$/, '')}`
        : `Every ${count} ${SCHEDULE_UNIT_LABELS[unit]}`;
    }
  }
};

const WORKABLE: readonly CheckStatus[] = ['due', 'in_progress', 'returned'];

/** Past its due date without submission (SCH-007). */
export const isOverdue = (
  status: CheckStatus,
  dueOn: string | null,
  today: string,
): boolean => WORKABLE.includes(status) && !!dueOn && dueOn < today;

export const displayStatus = (
  status: CheckStatus,
  dueOn: string | null,
  today: string,
): CheckDisplayStatus => (isOverdue(status, dueOn, today) ? 'overdue' : status);
