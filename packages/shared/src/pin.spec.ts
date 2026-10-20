import { describe, expect, it } from 'vitest';
import { isWeakPin, newPinProblem } from './pin.js';

describe('PIN rules', () => {
  it.each([
    '000000',
    '111111',
    '999999',
    '123456',
    '234567',
    '654321',
    '987654',
    '121212',
    '123123',
    '909090',
  ])('treats %s as weak', (pin) => expect(isWeakPin(pin)).toBe(true));

  it.each(['258147', '369258', '135792', '480263', '102938'])(
    'accepts %s',
    (pin) => {
      expect(isWeakPin(pin)).toBe(false);
      expect(newPinProblem(pin)).toBeNull();
    },
  );

  it('explains what is wrong with a proposed PIN', () => {
    expect(newPinProblem('12345')).toMatch(/exactly 6 digits/);
    expect(newPinProblem('12345a')).toMatch(/exactly 6 digits/);
    expect(newPinProblem('123456')).toMatch(/too easy/);
  });
});
