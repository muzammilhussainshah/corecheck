'use client';

import { Box, Group, Input, PinInput, UnstyledButton } from '@mantine/core';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { COLORS } from './theme';

/**
 * Digit boxes in the CoreCheck Figma style: two groups of three split by a
 * dash, entered digits in blue on a blue outline, empty boxes showing a pale
 * 0. The boxes share the full width of the form, like the inputs above.
 */
const CODE_CSS = `
.cc-code { --g: 10px; --sep: 30px; position: relative; display: block;
  width: 100%; container-type: inline-size; }
.cc-code .mantine-PinInput-root { display: flex; gap: var(--g);
  flex-wrap: nowrap; width: 100%; }
.cc-code .mantine-PinInput-pinInput { flex: 1 1 0; min-width: 0; width: auto; }
.cc-code .mantine-PinInput-pinInput, .cc-code .mantine-Input-wrapper {
  height: auto !important; }
.cc-code .mantine-PinInput-pinInput:nth-of-type(3) { margin-right: var(--sep); }
.cc-code input { width: 100%; height: auto !important; aspect-ratio: 1;
  max-height: 72px; border-radius: 10px; border: 1.5px solid #E3E8EF;
  background: #fff; font-weight: 500; line-height: 1; padding: 0;
  font-size: min(32px, calc((100cqw - 5 * var(--g) - var(--sep)) / 12));
  color: var(--mantine-color-brand-6); text-align: center;
  transition: border-color 120ms ease, box-shadow 120ms ease; }
.cc-code input::placeholder { color: #D0D5DD; opacity: 1; }
.cc-code input:not(:placeholder-shown) { border-color: var(--mantine-color-brand-5); }
.cc-code input:focus { border-color: var(--mantine-color-brand-6);
  box-shadow: 0 0 0 3px var(--mantine-color-brand-1); outline: none; }
.cc-code[data-error] input { border-color: var(--mantine-color-red-6); }
.cc-code-dash { position: absolute; width: 14px; height: 2px; border-radius: 2px;
  background: #D0D5DD; top: calc(50% - 1px);
  left: calc((100% - 5 * var(--g) - var(--sep)) / 2 + 2 * var(--g)
    + (var(--g) + var(--sep)) / 2 - 7px); }
`;

export const CodeInput = ({
  label,
  description,
  error,
  length = 6,
  secret = false,
  value,
  onChange,
  focusKey,
}: {
  label: string;
  description?: string;
  error?: ReactNode;
  length?: number;
  /** Hide the digits (PINs), with a control to show them; one-time codes stay visible. */
  secret?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  /**
   * Change this number to put the cursor back in the first box, e.g. after a
   * wrong PIN.
   */
  focusKey?: number;
}) => {
  const [shown, setShown] = useState(false);
  const id = useId();
  const masked = secret && !shown;
  const boxes = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusKey) boxes.current?.querySelector('input')?.focus();
  }, [focusKey]);
  return (
    <Input.Wrapper
      label={label}
      description={description}
      error={error}
      required
      id={id}
    >
      <style>{CODE_CSS}</style>
      <Box
        ref={boxes}
        className="cc-code"
        data-error={error ? true : undefined}
      >
        <PinInput
          length={length}
          type="number"
          mask={masked}
          oneTimeCode={!secret}
          value={value}
          onChange={onChange}
          error={!!error}
          placeholder="0"
          getInputProps={(index) => ({
            'aria-label': `${label} digit ${index + 1} of ${length}`,
          })}
        />
        {length === 6 && <span className="cc-code-dash" aria-hidden />}
      </Box>
      {secret && (
        <Group justify="flex-end" mt={14}>
          <UnstyledButton
            onClick={() => setShown((value) => !value)}
            aria-pressed={shown}
            fz="sm"
            fw={500}
            c={COLORS.muted}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {shown ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            {shown ? `Hide ${label}` : `Show ${label}`}
          </UnstyledButton>
        </Group>
      )}
    </Input.Wrapper>
  );
};
