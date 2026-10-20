import { randomInt } from 'node:crypto';
import type { EntityManager } from 'typeorm';

const MAX_BASE_LENGTH = 20;
const TWO_DIGIT_ATTEMPTS = 20;
const THREE_DIGIT_ATTEMPTS = 60;

/**
 * The letters a username is built from: first and last name, accents removed,
 * lower case, letters only. Names with no Latin letters fall back to "user".
 */
export const usernameBase = (firstName: string, lastName: string): string => {
  const letters = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  const base = `${letters(firstName)}${letters(lastName)}`.slice(
    0,
    MAX_BASE_LENGTH,
  );
  return base.length >= 2 ? base : 'user';
};

/** Candidate usernames in the order they are tried: two digits, then three. */
export function* usernameCandidates(base: string): Generator<string> {
  for (let i = 0; i < TWO_DIGIT_ATTEMPTS; i += 1)
    yield `${base}${randomInt(10, 100)}`;
  for (let i = 0; i < THREE_DIGIT_ATTEMPTS; i += 1)
    yield `${base}${randomInt(100, 1000)}`;
}

/**
 * A username from the person's name plus two or three digits that is unused
 * anywhere on the platform (USR-001, USR-AC-01). Uniqueness is checked through
 * corecheck.username_taken because row-level security hides other
 * organisations' users; the unique index remains the final guard.
 */
export const generateUsername = async (
  manager: EntityManager,
  firstName: string,
  lastName: string,
): Promise<string> => {
  for (const candidate of usernameCandidates(
    usernameBase(firstName, lastName),
  )) {
    const [{ taken }] = (await manager.query(
      'select corecheck.username_taken($1) as taken',
      [candidate],
    )) as [{ taken: boolean }];
    if (!taken) return candidate;
  }
  throw new Error(`No free username for ${firstName} ${lastName}.`);
};
