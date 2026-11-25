'use client';

import {
  NumberInput,
  SegmentedControl,
  Select,
  Textarea,
} from '@mantine/core';
import type { AnswerValue, TemplateQuestion } from '@corecheck/shared';

/** An answer as read back on a record. */
export const showValue = (value: AnswerValue | undefined): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (value === 'pass') return 'Pass';
  if (value === 'fail') return 'Fail';
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  return String(value);
};

/**
 * The input for one question while a check or reception is being filled
 * in (TMP-010): pass/fail, yes/no, single selection, number, meter or text.
 * Photo questions take files instead.
 */
export function AnswerInput({
  question,
  value,
  unit,
  disabled,
  onChange,
}: {
  question: TemplateQuestion;
  value: AnswerValue;
  unit?: string;
  disabled?: boolean;
  onChange: (value: AnswerValue) => void;
}) {
  switch (question.type) {
    case 'pass_fail':
    case 'yes_no': {
      const options =
        question.type === 'pass_fail'
          ? [
              { value: 'pass', label: 'Pass' },
              { value: 'fail', label: 'Fail' },
            ]
          : [
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ];
      return (
        <SegmentedControl
          aria-label={question.text}
          data={options}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          style={{ alignSelf: 'flex-start' }}
        />
      );
    }
    case 'single_select':
      return question.options.length <= 4 ? (
        <SegmentedControl
          aria-label={question.text}
          data={question.options}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          style={{ alignSelf: 'flex-start' }}
        />
      ) : (
        <Select
          aria-label={question.text}
          maw={360}
          placeholder="Choose one"
          clearable
          disabled={disabled}
          data={question.options}
          value={typeof value === 'string' ? value : null}
          onChange={(next) => onChange(next)}
        />
      );
    case 'number':
    case 'meter':
      return (
        <NumberInput
          aria-label={question.text}
          maw={240}
          disabled={disabled}
          suffix={unit ? ` ${unit}` : undefined}
          min={question.type === 'meter' ? 0 : undefined}
          // Never change what was typed: a bad value is refused with a
          // message, not quietly corrected.
          clampBehavior="none"
          value={typeof value === 'number' ? value : ''}
          onChange={(next) => onChange(typeof next === 'number' ? next : null)}
        />
      );
    case 'text':
      return (
        <Textarea
          aria-label={question.text}
          autosize
          minRows={2}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
    default:
      return null;
  }
}
