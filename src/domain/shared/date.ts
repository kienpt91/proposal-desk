// Calendar-date arithmetic without the Date class, so the domain never reads a clock.
// Dates are ISO strings: "YYYY-MM-DD" days and "YYYY-MM-DDTHH:MM:SS.sssZ" timestamps.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isIsoDay(value: string): boolean {
  const m = DAY.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return year >= 1970 && year <= 2999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function isIsoTimestamp(value: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.exec(value);
  return m !== null && isIsoDay(m[1] as string);
}

/** Days since 1970-01-01 (proleptic Gregorian civil calendar). */
export function dayNumber(day: string): number {
  const m = DAY.exec(day);
  if (m === null) throw new RangeError(`not an ISO day: ${day}`);
  let year = Number(m[1]);
  const month = Number(m[2]);
  const d = Number(m[3]);
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The "YYYY-MM-DD" part of an ISO timestamp. */
export function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}
