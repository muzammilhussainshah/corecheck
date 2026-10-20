import { usernameBase, usernameCandidates } from './username.js';

describe('usernames (USR-001)', () => {
  it('joins first and last name in lower case', () => {
    expect(usernameBase('John', 'Smith')).toBe('johnsmith');
  });

  it('drops accents, spaces, apostrophes and hyphens', () => {
    expect(usernameBase('José', "O'Connor-Smith")).toBe('joseoconnorsmith');
    expect(usernameBase('Zoë', 'van der Berg')).toBe('zoevanderberg');
  });

  it('caps the name part at twenty letters', () => {
    expect(
      usernameBase('Maximilianus', 'Wolfeschlegelsteinhausen'),
    ).toHaveLength(20);
  });

  it('falls back to "user" when a name has no Latin letters', () => {
    expect(usernameBase('محمد', 'علی')).toBe('user');
  });

  it('tries two-digit suffixes before three-digit ones', () => {
    const candidates = [...usernameCandidates('ann')];
    expect(candidates.slice(0, 20).every((c) => /^ann\d{2}$/.test(c))).toBe(
      true,
    );
    expect(candidates.slice(20).every((c) => /^ann\d{3}$/.test(c))).toBe(true);
    expect(candidates.every((c) => !c.startsWith('ann0'))).toBe(true);
  });
});
