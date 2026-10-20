/**
 * PIN rules (FRD 16.1). A PIN is exactly six digits: four digits give only
 * 10,000 combinations, six give a million, and the account locks after
 * MAX_FAILED_PIN_ATTEMPTS wrong guesses in a row (USR-005).
 */

export const PIN_LENGTH = 6;

export const MAX_FAILED_PIN_ATTEMPTS = 5;

/** How long a new or reset temporary PIN stays usable (USR-003). */
export const TEMPORARY_PIN_VALID_DAYS = 7;

export const PIN_PATTERN = /^\d{6}$/;

const isRun = (pin: string, step: 1 | -1): boolean => {
  for (let i = 1; i < pin.length; i += 1) {
    if (Number(pin[i]) - Number(pin[i - 1]) !== step) return false;
  }
  return true;
};

const isRepeatOf = (pin: string, unit: number): boolean =>
  pin.length % unit === 0 &&
  pin === pin.slice(0, unit).repeat(pin.length / unit);

/**
 * True for PINs an attacker would try first: one repeated digit (111111),
 * a straight run (123456, 987654) or a repeated pair or triple (121212,
 * 123123).
 */
export const isWeakPin = (pin: string): boolean =>
  isRepeatOf(pin, 1) ||
  isRepeatOf(pin, 2) ||
  isRepeatOf(pin, 3) ||
  isRun(pin, 1) ||
  isRun(pin, -1);

/** Why a proposed new PIN is unacceptable, or null when it is fine. */
export const newPinProblem = (pin: string): string | null => {
  if (!PIN_PATTERN.test(pin))
    return `Your PIN must be exactly ${PIN_LENGTH} digits.`;
  if (isWeakPin(pin)) {
    return 'That PIN is too easy to guess. Avoid repeated digits and sequences such as 123456.';
  }
  return null;
};
