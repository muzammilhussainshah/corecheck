/**
 * Dates and times are shown in the organisation's time zone (NFR-005); the
 * admin portal passes undefined to use the viewer's own.
 */

// Fixed three-letter months: some runtimes print "Sept" for en-GB.
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Calendar parts of an instant in the given zone (the viewer's by default). */
const partsOf = (date: Date, timeZone?: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: Number(parts.day),
    month: Number(parts.month),
    year: Number(parts.year),
    time: `${parts.hour}:${parts.minute}`,
  };
};

/** "15 Oct 2026". */
export const formatDate = (
  iso: string | null | undefined,
  timeZone?: string,
): string => {
  if (!iso) return '—';
  // Plain dates ("2026-10-15") are calendar days, not instants: never shift them.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [year, month, day] = iso.split('-').map(Number);
    return `${day} ${MONTHS[month! - 1]} ${year}`;
  }
  const { day, month, year } = partsOf(new Date(iso), timeZone);
  return `${day} ${MONTHS[month - 1]} ${year}`;
};

/** "15 Oct 2026, 09:37". */
export const formatDateTime = (
  iso: string | null | undefined,
  timeZone?: string,
): string => {
  if (!iso) return '—';
  const { day, month, year, time } = partsOf(new Date(iso), timeZone);
  return `${day} ${MONTHS[month - 1]} ${year}, ${time}`;
};

/** "1.4 MB". */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

export const fullName = (person: {
  firstName: string;
  lastName: string;
}): string => `${person.firstName} ${person.lastName}`;

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;
