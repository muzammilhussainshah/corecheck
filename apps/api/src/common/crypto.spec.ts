import { isWeakPin } from '@corecheck/shared';
import {
  generateTemporaryPassword,
  generateTemporaryPin,
  hashToken,
  newSessionToken,
  SecretBox,
  SecretHasher,
} from './crypto.js';

describe('SecretHasher (SEC-002)', () => {
  const hasher = new SecretHasher('pepper-for-tests-0123456789abcdef');

  it('verifies the right secret and rejects a wrong one', async () => {
    const stored = await hasher.hash('258147');
    expect(stored).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(stored).not.toContain('258147');
    await expect(hasher.verify('258147', stored)).resolves.toBe(true);
    await expect(hasher.verify('258148', stored)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hasher.hash('258147')).not.toBe(await hasher.hash('258147'));
  });

  it('is useless without the pepper', async () => {
    const stored = await hasher.hash('258147');
    const withoutPepper = new SecretHasher('a-different-pepper-0123456789abcd');
    await expect(withoutPepper.verify('258147', stored)).resolves.toBe(false);
  });

  it('rejects malformed stored values', async () => {
    await expect(hasher.verify('258147', 'plain-text')).resolves.toBe(false);
  });
});

describe('SecretBox', () => {
  const box = new SecretBox(
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  );

  it('round-trips and never repeats ciphertext', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(box.seal('JBSWY3DPEHPK3PXP')).not.toBe(sealed);
  });

  it('detects tampering', () => {
    const [version, iv, tag, data] = box.seal('secret').split('.');
    const flipped = Buffer.from(data!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() =>
      box.open([version, iv, tag, flipped.toString('base64url')].join('.')),
    ).toThrow();
  });
});

describe('generated credentials', () => {
  it('issues six-digit temporary PINs that are never weak', () => {
    for (let i = 0; i < 500; i += 1) {
      const pin = generateTemporaryPin();
      expect(pin).toMatch(/^\d{6}$/);
      expect(isWeakPin(pin)).toBe(false);
    }
  });

  it('issues 16-character passwords without look-alike characters', () => {
    const password = generateTemporaryPassword();
    expect(password).toHaveLength(16);
    expect(password).not.toMatch(/[0O1lI]/);
  });

  it('stores only a hash of each session token', () => {
    const { token, tokenHash } = newSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toContain(token);
  });
});
