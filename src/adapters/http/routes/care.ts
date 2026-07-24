import type { Context } from "hono";
import { answerCareSlot, type AnswerCareSlotInput } from "../../../contexts/notifications/application/answer-care-slot";
import {
  createCareItem,
  deleteCareItem,
  InvalidCareItemError,
  listCareItems,
  updateCareItem,
} from "../../../contexts/notifications/application/care-items";
import type {
  CareCategory,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
  CareScheduleInput,
  CreateCareItemInput,
  UpdateCareItemPatch,
} from "../../../contexts/notifications/domain/care-item";
import type { CareLog, CareLogRepository } from "../../../contexts/notifications/domain/care-log";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, optionalBoolean, requireDay, requireFiniteNumber, requireHHMM, requireNumberArray, requireString } from "../validation";

export interface CareHandlerOptions {
  userRepository: UserRepository;
  careItemRepository: CareItemRepository;
  careLogRepository: CareLogRepository;
}

/** A nullable string field present in the body; `null` stays `null`, a non-string throws 400. */
function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new BadRequestError(`${field} must be a string`);
  return value;
}

/** A nullable number field present in the body; `null` stays `null`, otherwise a finite number. */
function nullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  return requireFiniteNumber(value, field);
}

function parseSchedule(raw: unknown): CareScheduleInput {
  if (typeof raw !== "object" || raw === null) throw new BadRequestError("schedules entry must be an object");
  const body = raw as Record<string, unknown>;
  const input: CareScheduleInput = {
    timeOfDay: requireString(body.time_of_day, "time_of_day"),
    repeatDays: requireNumberArray(body.repeat_days, "repeat_days"),
    weekInterval: requireFiniteNumber(body.week_interval, "week_interval"),
    startDate: requireDay(body.start_date, "start_date"),
    endDate: body.end_date === undefined || body.end_date === null ? null : requireDay(body.end_date, "end_date"),
    doseQuantity: requireFiniteNumber(body.dose_quantity, "dose_quantity"),
    nagIntervalMinutes: requireFiniteNumber(body.nag_interval_minutes, "nag_interval_minutes"),
    enabled: optionalBoolean(body.enabled, "enabled", true),
  };
  if (typeof body.id === "string") input.id = body.id;
  return input;
}

function requireScheduleArray(value: unknown, field: string): CareScheduleInput[] {
  if (!Array.isArray(value)) throw new BadRequestError(`${field} must be an array`);
  return value.map(parseSchedule);
}

function scheduleToJson(schedule: CareSchedule) {
  return {
    id: schedule.id,
    time_of_day: schedule.timeOfDay,
    repeat_days: schedule.repeatDays,
    week_interval: schedule.weekInterval,
    start_date: schedule.startDate,
    end_date: schedule.endDate,
    dose_quantity: schedule.doseQuantity,
    nag_interval_minutes: schedule.nagIntervalMinutes,
    enabled: schedule.enabled,
  };
}

function itemToJson(item: CareItemWithSchedules) {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    note: item.note,
    dose: item.dose,
    stock: item.stock,
    stock_alert: item.stockAlert,
    schedules: item.schedules.map(scheduleToJson),
  };
}

function careLogToJson(log: CareLog) {
  return {
    id: log.id,
    care_schedule_id: log.careScheduleId,
    local_date: log.localDate,
    time_of_day: log.timeOfDay,
    status: log.status,
    done_time: log.doneTime ? log.doneTime.toISOString() : null,
    dose_quantity: log.doseQuantity,
  };
}

/** Protected `POST /api/care/items`: create a care item with its schedules inline. */
export function createCreateCareItemHandler(options: CareHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const input: CreateCareItemInput = {
      userId,
      category: requireString(body.category, "category") as CareCategory,
      title: requireString(body.title, "title"),
      note: body.note === undefined ? undefined : nullableString(body.note, "note"),
      dose: body.dose === undefined ? undefined : nullableString(body.dose, "dose"),
      stock: body.stock === undefined ? undefined : nullableNumber(body.stock, "stock"),
      stockAlert: body.stock_alert === undefined ? undefined : nullableNumber(body.stock_alert, "stock_alert"),
      schedules: requireScheduleArray(body.schedules ?? [], "schedules"),
    };

    try {
      const item = await createCareItem(options.careItemRepository, input);
      return c.json(itemToJson(item));
    } catch (err) {
      if (err instanceof InvalidCareItemError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}

/** Protected `GET /api/care/items`: the caller's care items, optionally `?category=`-filtered. */
export function createListCareItemsHandler(options: CareHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const category = c.req.query("category") as CareCategory | undefined;
    const items = await listCareItems(options.careItemRepository, userId, category);
    return c.json({ items: items.map(itemToJson) });
  };
}

/** Protected `PATCH /api/care/items/:id`: partial-update an owned item; 404 when not owned/found. */
export function createUpdateCareItemHandler(options: CareHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    // Build the patch by KEY PRESENCE: an absent field (including `schedules`) is left untouched.
    const patch: UpdateCareItemPatch = {};
    if ("category" in body) patch.category = requireString(body.category, "category") as CareCategory;
    if ("title" in body) patch.title = requireString(body.title, "title");
    if ("note" in body) patch.note = nullableString(body.note, "note");
    if ("dose" in body) patch.dose = nullableString(body.dose, "dose");
    if ("stock" in body) patch.stock = nullableNumber(body.stock, "stock");
    if ("stock_alert" in body) patch.stockAlert = nullableNumber(body.stock_alert, "stock_alert");
    if ("schedules" in body) patch.schedules = requireScheduleArray(body.schedules, "schedules");

    try {
      const item = await updateCareItem(options.careItemRepository, c.req.param("id") ?? "", userId, patch);
      if (!item) return c.json({ error: "not_found" }, 404);
      return c.json(itemToJson(item));
    } catch (err) {
      if (err instanceof InvalidCareItemError) throw new BadRequestError(err.message);
      throw err;
    }
  };
}

/** Protected `DELETE /api/care/items/:id`: delete an owned item; reports whether one was deleted. */
export function createDeleteCareItemHandler(options: CareHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const deleted = await deleteCareItem(options.careItemRepository, c.req.param("id") ?? "", userId);
    return c.json({ deleted });
  };
}

/** A `done`/`skipped` status; throws 400 for anything else (`missed` is cron-only). */
function requireCareLogStatus(value: unknown): "done" | "skipped" {
  const s = requireString(value, "status");
  if (s !== "done" && s !== "skipped") throw new BadRequestError("status must be 'done' or 'skipped'");
  return s;
}

/** Protected `POST /api/care/log`: record a slot as done/skipped; 404 when the schedule isn't owned by the caller. */
export function createAnswerCareSlotHandler(options: CareHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const input: AnswerCareSlotInput = {
      careScheduleId: requireString(body.care_schedule_id, "care_schedule_id"),
      localDate: requireDay(body.local_date, "local_date"),
      timeOfDay: requireHHMM(body.time_of_day, "time_of_day"),
      status: requireCareLogStatus(body.status),
    };

    const log = await answerCareSlot(
      { careItemRepo: options.careItemRepository, careLogRepo: options.careLogRepository },
      userId,
      input,
    );
    if (!log) return c.json({ error: "not_found" }, 404);
    return c.json(careLogToJson(log));
  };
}
