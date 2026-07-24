import type { Context } from "hono";
import {
  createMedicationReminder,
  deleteMedicationReminder,
  InvalidReminderScheduleError,
  listMedicationReminders,
  updateMedicationReminder,
} from "../../../contexts/notifications/application/medication-reminders";
import type { ReminderSchedule, ReminderScheduleRepository, UpdateReminderSchedulePatch } from "../../../contexts/notifications/domain/reminder-schedule";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import {
  BadRequestError,
  optionalBoolean,
  optionalBooleanOrUndefined,
  requireDay,
  requireFiniteNumber,
  requireNumberArray,
  requireString,
  requireStringArray,
} from "../validation";

export interface ReminderHandlerOptions {
  userRepository: UserRepository;
  reminderScheduleRepository: ReminderScheduleRepository;
}

function scheduleToJson(schedule: ReminderSchedule) {
  return {
    id: schedule.id,
    label: schedule.label,
    times: schedule.times,
    days_of_week: schedule.daysOfWeek,
    week_interval: schedule.weekInterval,
    anchor_date: schedule.anchorDate,
    enabled: schedule.enabled,
  };
}

/** Protected `POST /api/reminders/medication`: create a medication reminder schedule. */
export function createCreateMedicationReminderHandler(options: ReminderHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const input = {
      userId,
      label: requireString(body.label, "label"),
      times: requireStringArray(body.times, "times"),
      daysOfWeek: requireNumberArray(body.days_of_week, "days_of_week"),
      weekInterval: requireFiniteNumber(body.week_interval, "week_interval"),
      anchorDate: requireDay(body.anchor_date, "anchor_date"),
      enabled: optionalBoolean(body.enabled, "enabled", true),
    };

    try {
      const schedule = await createMedicationReminder(options.reminderScheduleRepository, input);
      return c.json(scheduleToJson(schedule));
    } catch (err) {
      if (err instanceof InvalidReminderScheduleError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}

/** Protected `GET /api/reminders/medication`: the caller's medication reminder schedules. */
export function createListMedicationRemindersHandler(options: ReminderHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const schedules = await listMedicationReminders(options.reminderScheduleRepository, userId);
    return c.json({ reminders: schedules.map(scheduleToJson) });
  };
}

/** Protected `PATCH /api/reminders/medication/:id`: partial-update an owned schedule; 404 when not owned/found. */
export function createUpdateMedicationReminderHandler(options: ReminderHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    // Build the patch by KEY PRESENCE: an absent field is left untouched.
    const patch: UpdateReminderSchedulePatch = {};
    if ("label" in body) patch.label = requireString(body.label, "label");
    if ("times" in body) patch.times = requireStringArray(body.times, "times");
    if ("days_of_week" in body) patch.daysOfWeek = requireNumberArray(body.days_of_week, "days_of_week");
    if ("week_interval" in body) patch.weekInterval = requireFiniteNumber(body.week_interval, "week_interval");
    if ("anchor_date" in body) patch.anchorDate = requireDay(body.anchor_date, "anchor_date");
    // Absent/null `enabled` means no change — unlike create, PATCH must not default it to `true`.
    const enabled = optionalBooleanOrUndefined(body.enabled, "enabled");
    if (enabled !== undefined) patch.enabled = enabled;

    try {
      const schedule = await updateMedicationReminder(options.reminderScheduleRepository, c.req.param("id") ?? "", userId, patch);
      if (!schedule) return c.json({ error: "not_found" }, 404);
      return c.json(scheduleToJson(schedule));
    } catch (err) {
      if (err instanceof InvalidReminderScheduleError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}

/** Protected `DELETE /api/reminders/medication/:id`: delete an owned schedule; reports whether one was deleted. */
export function createDeleteMedicationReminderHandler(options: ReminderHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const deleted = await deleteMedicationReminder(options.reminderScheduleRepository, c.req.param("id") ?? "", userId);
    return c.json({ deleted });
  };
}
