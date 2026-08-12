/**
 * Timezone-aware local-date/time calendar math, shared by the contexts that
 * need it (notifications, finance). Originally
 * `notifications/domain/reminder-clock.ts`, moved out once finance became its
 * second consumer — no financial use case had ever read `users.timezone`
 * before (add-installments design.md D5).
 *
 * **Why `shared-kernel/` and not `shared/`.** In this repo `shared/` means
 * cross-context *infrastructure* — it holds exactly `db/` and `auth/`, and
 * CLAUDE.md's dependency rule forbids `domain`/`application` from importing
 * it. This file is the opposite kind of thing: pure calendar math, no I/O, no
 * infrastructure, nothing to inject. Putting it in `shared/` made seven
 * domain/application files read as breaking that rule when nothing about the
 * dependency direction was actually wrong.
 *
 * A shared kernel (the DDD term for a small model two bounded contexts agree
 * to share) sits at domain level, so importing it points inward, not outward.
 * The rule stays literally true and needs no exception.
 *
 * **What belongs here:** pure, dependency-free logic that more than one
 * context genuinely needs. Not infrastructure (that is `shared/`), and not
 * business rules belonging to one context (those stay in that context).
 */
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

/**
 * `timeZone`'s UTC offset at `instantMs`, defined as
 * `(local wall clock at instantMs, re-interpreted as if it were itself a UTC
 * timestamp) - instantMs`. E.g. for `America/New_York` in EST (UTC-5) this is
 * `-5h`: the local wall clock reads 5 hours *behind* the real UTC instant.
 */
function offsetMsAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtcMs - instantMs;
}

/**
 * The UTC instant at which `hhmm` on `localDate` occurs in `timeZone` — the
 * one place in this file that does local→UTC conversion (D1' in
 * replace-cron-with-workflows/design.md; every other function here compares
 * local wall-clock values and never needs this). Used only to compute how
 * long a Workflow instance should `sleepUntil`; deciding whether a slot is
 * *due* always stays on local wall-clock comparison (`localMinute`/
 * `localParts`), recomputed fresh on every wake — this function is not a
 * substitute for that and must not be used to pre-derive "today's due times"
 * once and cache them.
 *
 * Algorithm: sample `timeZone`'s offset a day before and a day after the
 * target wall-clock value. Equal offsets (the common case) mean no DST
 * transition nearby — one offset applies throughout, solved directly. When
 * they differ, a transition falls within that day; binary-search it to
 * minute resolution (matching `hhmm`'s own granularity — and needed because
 * `Intl.DateTimeFormat`'s formatted parts are whole seconds, so comparing
 * offsets at a non-minute-aligned instant is unreliable by up to 1ms), then
 * classify:
 * - **both** the before- and after-offset candidates land on the correct side
 *   of the transition and round-trip back to `localDate`/`hhmm` → a
 *   fall-back **overlap** (the wall-clock time occurs twice) → return the
 *   **earlier** of the two (first occurrence).
 * - **neither** does → a spring-forward **gap** (the wall-clock time never
 *   occurs) → return the transition instant itself (the first legal instant
 *   after the gap).
 * - exactly one does → the ordinary case, despite the transition being
 *   nearby in the sampling window.
 */
export function utcInstantFor(localDate: string, hhmm: string, timeZone: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  // The wall-clock value, provisionally labeled as if it were itself a UTC
  // timestamp — not a real instant yet, just a fixed point to offset from.
  const targetWallMs = Date.UTC(year, month - 1, day, hour, minute);

  const DAY_MS = MS_PER_DAY;
  let lo = targetWallMs - DAY_MS;
  let hi = targetWallMs + DAY_MS;
  const offsetLo = offsetMsAt(lo, timeZone);
  const offsetHi = offsetMsAt(hi, timeZone);

  if (offsetLo === offsetHi) {
    // No DST transition within a day of the target: one offset applies throughout.
    return new Date(targetWallMs - offsetLo);
  }

  // A transition falls within the window (`offsetLo` applies at `lo`,
  // `offsetHi` from the transition instant onward): binary-search that
  // instant to minute resolution. `lo`/`hi` start minute-aligned
  // (`targetWallMs` ± a whole day), and every `mid` is floored to a minute
  // too, so the search stays minute-aligned throughout.
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
    if (offsetMsAt(mid, timeZone) === offsetLo) lo = mid;
    else hi = mid;
  }
  const transitionMs = hi; // first instant observed with `offsetHi`.

  const candidateEarly = targetWallMs - offsetLo;
  const candidateLate = targetWallMs - offsetHi;
  const validEarly = candidateEarly < transitionMs && offsetMsAt(candidateEarly, timeZone) === offsetLo;
  const validLate = candidateLate >= transitionMs && offsetMsAt(candidateLate, timeZone) === offsetHi;

  if (validEarly && validLate) return new Date(Math.min(candidateEarly, candidateLate)); // overlap: first occurrence.
  if (validEarly) return new Date(candidateEarly);
  if (validLate) return new Date(candidateLate);
  return new Date(transitionMs); // gap: first legal instant after it.
}

/** The UTC instant of the next local midnight (00:00) in `timeZone`, strictly after `now`. */
export function nextLocalMidnightInstant(now: Date, timeZone: string): Date {
  const { date } = localParts(now, timeZone);
  return utcInstantFor(nextLocalDate(date), "00:00", timeZone);
}
