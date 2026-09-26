/** Presentation helpers. Locale-stable on purpose — this is a reading product and
 *  dates should not shift meaning because of where the server is. */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function longDate(ms: number | null | undefined): string {
  if (!ms) return 'Unpublished';
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function shortDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** "3 days ago" / "in 2 months", rounded. Used for staleness and read times. */
export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return 'never';
  const delta = ms - now;
  const abs = Math.abs(delta);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536e6],
    ['month', 2592e6],
    ['week', 6048e5],
    ['day', 864e5],
    ['hour', 36e5],
    ['minute', 6e4],
  ];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (abs >= size) return rtf.format(Math.round(delta / size), unit);
  }
  return 'just now';
}

/** "14 months" — for the staleness badge, where a vague "a while ago" is useless. */
export function staleFor(ms: number | null | undefined, now = Date.now()): string | null {
  if (!ms) return null;
  const days = Math.floor((now - ms) / 864e5);
  if (days < 180) return null;
  if (days < 730) return `${Math.round(days / 30)} months`;
  const years = days / 365;
  return `${years.toFixed(years < 2 ? 1 : 0)} years`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
