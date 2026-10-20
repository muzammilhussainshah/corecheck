import { addDays, dateInTimeZone } from './clock.js';

describe('dateInTimeZone (NFR-005)', () => {
  // 23:30 UTC on 31 December: already 1 January in Karachi, still 31 December in London.
  const instant = new Date('2026-12-31T23:30:00Z');

  it('gives the calendar date in the organisation’s zone', () => {
    expect(dateInTimeZone(instant, 'Europe/London')).toBe('2026-12-31');
    expect(dateInTimeZone(instant, 'Asia/Karachi')).toBe('2027-01-01');
    expect(dateInTimeZone(instant, 'America/New_York')).toBe('2026-12-31');
  });

  it('handles daylight-saving changes', () => {
    expect(
      dateInTimeZone(new Date('2026-03-29T00:30:00Z'), 'Europe/London'),
    ).toBe('2026-03-29');
    expect(
      dateInTimeZone(
        addDays(new Date('2026-03-28T12:00:00Z'), 1),
        'Europe/London',
      ),
    ).toBe('2026-03-29');
  });
});
