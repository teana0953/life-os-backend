import type { CareSchedule } from "./care-item";
import type { CareLog, CareLogStatus } from "./care-log";
import { isActiveOn } from "./care-schedule";

export interface CareAdherenceDay {
  date: string;
  scheduled: number;
  done: number;
  skipped: number;
  missed: number;
}

export interface CareAdherenceSeries {
  from: string;
  to: string;
  days: CareAdherenceDay[];
}

/** Parses a `YYYY-MM-DD` string as a UTC-midnight instant (calendar-date arithmetic, no tz drift). */
function parseLocalDateUTC(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** The calendar day after `date` (`YYYY-MM-DD`), correct across month/year boundaries. */
function nextLocalDate(date: string): string {
  const d = new Date(parseLocalDateUTC(date) + 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function countByStatus(logs: CareLog[], status: CareLogStatus): number {
  return logs.filter((log) => log.status === status).length;
}

/**
 * Pure builder: the daily `{scheduled, done, skipped, missed}` breakdown over
 * `[from, to]` (inclusive), one entry per calendar day (including days with
 * `scheduled: 0`). `scheduled` is the count of `enabled` schedules active on
 * that day per the shared `isActiveOn` — `isActiveOn` itself does not check
 * `enabled`, so it's filtered here (a disabled schedule never produces a log,
 * so leaving it counted would inflate `scheduled` and understate adherence).
 * `done`/`skipped`/`missed` are that day's `care_log` rows by status. Reflects
 * the *current* schedule definitions applied retroactively to every past day,
 * while logs are historical — the two can be asymmetric after schedules are
 * edited/disabled/deleted (a known tradeoff; rate/clamping is left to callers).
 */
export function buildCareAdherenceSeries(schedules: CareSchedule[], logs: CareLog[], from: string, to: string): CareAdherenceSeries {
  const logsByDate = new Map<string, CareLog[]>();
  for (const log of logs) {
    const forDate = logsByDate.get(log.localDate);
    if (forDate) forDate.push(log);
    else logsByDate.set(log.localDate, [log]);
  }

  const days: CareAdherenceDay[] = [];
  for (let date = from; date <= to; date = nextLocalDate(date)) {
    const scheduled = schedules.filter((schedule) => schedule.enabled && isActiveOn(schedule, date)).length;
    const dayLogs = logsByDate.get(date) ?? [];
    days.push({
      date,
      scheduled,
      done: countByStatus(dayLogs, "done"),
      skipped: countByStatus(dayLogs, "skipped"),
      missed: countByStatus(dayLogs, "missed"),
    });
  }

  return { from, to, days };
}
