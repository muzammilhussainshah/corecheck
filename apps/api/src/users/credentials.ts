import { TEMPORARY_PIN_VALID_DAYS } from '@corecheck/shared';
import { addDays } from '../common/clock.js';
import { generateTemporaryPin, type SecretHasher } from '../common/crypto.js';

export interface TemporaryPin {
  pin: string;
  pinHash: string;
  expiresAt: Date;
}

/**
 * A new temporary PIN (USR-003). Only its hash is stored; the PIN itself is
 * returned once so the administrator can hand it over.
 */
export const issueTemporaryPin = async (
  hasher: SecretHasher,
  now: Date,
): Promise<TemporaryPin> => {
  const pin = generateTemporaryPin();
  return {
    pin,
    pinHash: await hasher.hash(pin),
    expiresAt: addDays(now, TEMPORARY_PIN_VALID_DAYS),
  };
};

/** Columns that put an account back on a fresh temporary PIN. */
export const temporaryPinColumns = (temporary: TemporaryPin) => ({
  pinHash: temporary.pinHash,
  mustChangePin: true,
  tempPinExpiresAt: temporary.expiresAt,
  failedPinAttempts: 0,
});
