import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { isWeakPin, PIN_LENGTH } from '@corecheck/shared';

const scryptAsync = promisify(scrypt) as (
  password: Buffer | string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** scrypt cost: 2^15 iterations with r=8 uses 32 MiB and ~100 ms per hash. */
const SCRYPT = { logN: 15, r: 8, p: 1, keyLength: 32 };

/**
 * One-way hashing for PINs and staff passwords (SEC-002).
 *
 * The secret is first HMAC'd with a server-side pepper, then stretched with
 * scrypt and a random salt. A six-digit PIN has only a million values, so a
 * copy of the database alone must not be enough to recover it: without the
 * pepper, which never touches the database, every guess is useless.
 *
 * Stored format: scrypt$<logN>$<r>$<p>$<salt>$<hash> (base64url), so the
 * parameters can be raised later without invalidating existing hashes.
 */
export class SecretHasher {
  constructor(private readonly pepper: string) {}

  async hash(secret: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await this.derive(
      secret,
      salt,
      SCRYPT.logN,
      SCRYPT.r,
      SCRYPT.p,
    );
    return [
      'scrypt',
      SCRYPT.logN,
      SCRYPT.r,
      SCRYPT.p,
      salt.toString('base64url'),
      derived.toString('base64url'),
    ].join('$');
  }

  async verify(secret: string, stored: string): Promise<boolean> {
    const [scheme, logN, r, p, salt, expected] = stored.split('$');
    if (scheme !== 'scrypt' || !logN || !r || !p || !salt || !expected)
      return false;
    const expectedBytes = Buffer.from(expected, 'base64url');
    const derived = await this.derive(
      secret,
      Buffer.from(salt, 'base64url'),
      Number(logN),
      Number(r),
      Number(p),
    );
    return (
      derived.length === expectedBytes.length &&
      timingSafeEqual(derived, expectedBytes)
    );
  }

  private derive(
    secret: string,
    salt: Buffer,
    logN: number,
    r: number,
    p: number,
  ) {
    const peppered = createHmac('sha256', this.pepper).update(secret).digest();
    const N = 2 ** logN;
    return scryptAsync(peppered, salt, SCRYPT.keyLength, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
  }
}

/** A random bearer token and the hash stored in its place. */
export const newSessionToken = (): { token: string; tokenHash: string } => {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
};

/** Tokens are high-entropy, so a fast hash suffices; only hashes are stored. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** A random six-digit PIN that is not trivially guessable. */
export const generateTemporaryPin = (): string => {
  for (;;) {
    const pin = randomInt(0, 10 ** PIN_LENGTH)
      .toString()
      .padStart(PIN_LENGTH, '0');
    if (!isWeakPin(pin)) return pin;
  }
};

const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** A random 16-character password without look-alike characters. */
export const generateTemporaryPassword = (): string =>
  Array.from(
    { length: 16 },
    () => PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)],
  ).join('');

/**
 * Authenticated encryption (AES-256-GCM) for secrets the server must read
 * back, such as staff MFA seeds. Format: v1.<iv>.<tag>.<ciphertext>.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    this.key = Buffer.from(hexKey, 'hex');
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return ['v1', iv, cipher.getAuthTag(), ciphertext]
      .map((part) =>
        typeof part === 'string' ? part : part.toString('base64url'),
      )
      .join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, ciphertext] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) {
      throw new Error('Unrecognised sealed secret.');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
