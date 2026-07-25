const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface LocalParts {
  /** `YYYY-MM-DD` in the given timezone. */
  date: string;
  /** `HH:mm` (00-23) in the given timezone. */
  hhmm: string;
  /** 0 (Sunday) .. 6 (Saturday), of the local `date`. */
  weekday: number;
}

/**
 * Resolves the local calendar date, time-of-day, and weekday for a UTC instant
 * in `timeZone`, via `Intl.DateTimeFormat` (available in workerd) — never a
 * manual UTC offset (D1 in add-medication-reminders/design.md). `weekday` is
 * derived from the resolved local `YYYY-MM-DD` (locale/DST independent: the
 * day-of-week of a Gregorian calendar date never depends on time zone).
 */
export function localParts(now: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const date = `${year}-${month}-${day}`;
  const hhmm = `${get("hour")}:${get("minute")}`;
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();

  return { date, hhmm, weekday };
}

/** Parses a `YYYY-MM-DD` string as a UTC-midnight instant (calendar-date arithmetic, no tz drift). */
function parseLocalDateUTC(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Whole anchor-relative 7-day windows between `anchorDate` and `localDate`
 * (D4 in design.md): `floor(daysBetween / 7)`. Negative when `anchorDate` is
 * after `localDate` (a future anchor — not yet active).
 */
export function weeksSince(anchorDate: string, localDate: string): number {
  const daysBetween = Math.round((parseLocalDateUTC(localDate) - parseLocalDateUTC(anchorDate)) / MS_PER_DAY);
  return Math.floor(daysBetween / 7);
}

/** The weekday (0=Sun..6=Sat) of an arbitrary `YYYY-MM-DD` (locale/DST independent). */
export function weekdayOf(date: string): number {
  return new Date(parseLocalDateUTC(date)).getUTCDay();
}

/** The calendar day before `date` (`YYYY-MM-DD`), correct across month/year boundaries. */
export function previousLocalDate(date: string): string {
  const d = new Date(parseLocalDateUTC(date) - MS_PER_DAY);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The calendar day after `date` (`YYYY-MM-DD`), correct across month/year boundaries. */
export function nextLocalDate(date: string): string {
  const d = new Date(parseLocalDateUTC(date) + MS_PER_DAY);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * A monotonic integer "absolute local minute" for `date`+`hhmm`, treating the
 * local wall-clock value as if it were UTC. Used to compare a schedule
 * candidate's time against "now" across a midnight rollover by minute-integer
 * subtraction — never by comparing `HH:mm` strings, which breaks at midnight
 * (D3 in add-medication-reminders/design.md).
 */
export function localMinute(date: string, hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return Math.floor((parseLocalDateUTC(date) + hour * 60 * 60 * 1000 + minute * 60 * 1000) / 60000);
}
