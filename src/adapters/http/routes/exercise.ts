import type { Context } from "hono";
import { applyExerciseBonus } from "../../../contexts/health/application/apply-exercise-bonus";
import { deleteExerciseEntry } from "../../../contexts/health/application/delete-exercise-entry";
import { getExerciseDay, type ExerciseDay, type ExerciseDayEntry } from "../../../contexts/health/application/get-exercise-day";
import { listExerciseActivities } from "../../../contexts/health/application/list-exercise-activities";
import { logExercise } from "../../../contexts/health/application/log-exercise";
import type { DailyTargetRepository } from "../../../contexts/health/domain/daily-target-repository";
import { findActivity } from "../../../contexts/health/domain/exercise-activity";
import type { ExerciseRepository } from "../../../contexts/health/domain/exercise-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireDay, requireFiniteNumber, requireString } from "../validation";

export interface ExerciseHandlerOptions {
  userRepository: UserRepository;
  exerciseRepository: ExerciseRepository;
  dailyTargetRepository: DailyTargetRepository;
}

function entryToJson(entry: ExerciseDayEntry) {
  return {
    id: entry.id,
    activity_id: entry.activityId,
    activity_name: entry.activityName,
    category: entry.category,
    duration_minutes: entry.durationMinutes,
    note: entry.note,
    created_at: entry.createdAt.toISOString(),
  };
}

/** Protected `GET /api/exercise/activities`: the static activity library. */
export function createListExerciseActivitiesHandler(_options: ExerciseHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    return c.json({ activities: listExerciseActivities() });
  };
}

/** The day's exercise entries and total as JSON; shared with the health-overview batch section so the two cannot drift. */
export function exerciseDayToJson(day: ExerciseDay) {
  return {
    day: day.day,
    entries: day.entries.map(entryToJson),
    total_minutes: day.totalMinutes,
  };
}

/** Protected `GET /api/exercise?day=`: the day's entries (enriched) and total duration. */
export function createGetExerciseHandler(options: ExerciseHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const day = await getExerciseDay(options.exerciseRepository, userId, requireDay(c.req.query("day")));
    return c.json(exerciseDayToJson(day));
  };
}

/** Protected `POST /api/exercise`: append an entry and return it (enriched). */
export function createLogExerciseHandler(options: ExerciseHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const day = requireDay(body.day);
    const activityId = requireString(body.activity_id, "activity_id");
    const activity = findActivity(activityId);
    if (!activity) throw new BadRequestError(`unknown activity_id: ${activityId}`);
    const durationMinutes = requireFiniteNumber(body.duration_minutes, "duration_minutes");
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      throw new BadRequestError("duration_minutes must be a positive integer");
    }
    const note = typeof body.note === "string" ? body.note : "";

    const entry = await logExercise(options.exerciseRepository, { userId, day, activityId, durationMinutes, note });
    // Couple exercise → food: recompute the day's bonus target. Not transactional
    // with the append above — if this throws the entry is still saved and the next
    // exercise change re-syncs the bonus (the ports expose no shared transaction).
    await applyExerciseBonus(options.dailyTargetRepository, options.exerciseRepository, userId, day);
    return c.json(
      entryToJson({
        id: entry.id,
        activityId: entry.activityId,
        activityName: activity.name,
        category: activity.category,
        durationMinutes: entry.durationMinutes,
        note: entry.note,
        createdAt: entry.createdAt,
      }),
    );
  };
}

/** Protected `DELETE /api/exercise/:id`: delete an owned entry; reports whether one was deleted. */
export function createDeleteExerciseHandler(options: ExerciseHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const day = await deleteExerciseEntry(options.exerciseRepository, userId, c.req.param("id") ?? "");
    // Recompute the day's bonus so removing exercise lowers the food target.
    if (day !== null) {
      await applyExerciseBonus(options.dailyTargetRepository, options.exerciseRepository, userId, day);
    }
    return c.json({ deleted: day !== null });
  };
}
