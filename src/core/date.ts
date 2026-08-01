const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function partsToDateKey(parts: Intl.DateTimeFormatPart[]): string {
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return partsToDateKey(formatter.formatToParts(date));
}

export function todayDateKey(
  date: Date = new Date(),
  timeZone: string = process.env.STUDYMATE_TIME_ZONE
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
  return dateKeyInTimeZone(date, timeZone);
}

export function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseDateKey(value: string): Date {
  if (!isDateKey(value)) throw new Error(`Invalid date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDaysToDateKey(value: string, days: number): string {
  const date = parseDateKey(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetweenDateKeys(start: string, end: string): number {
  return Math.round((parseDateKey(end).getTime() - parseDateKey(start).getTime()) / DAY_MS);
}
