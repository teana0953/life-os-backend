import type { Context } from "hono";
import { deleteExerciseEntry } from "../../../contexts/health/application/delete-exercise-entry";
import { getExerciseDay, type ExerciseDayEntry } from "../../../contexts/health/application/get-exercise-day";
import { listExerciseActivities } from "../../../contexts/health/application/list-exercise-activities";
import { logExercise } from "../../../contexts/health/application/log-exercise";
import { findActivity } from "../../../contexts/health/domain/exercise-activity";
import type { ExerciseRepository } from "../../../contexts/health/domain/exercise-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireDay, requireFiniteNumber, requireString } from "../validation";

export interface ExerciseHandlerOptions {
  userRepository: UserRepository;
  exerciseRepository: ExerciseRepository;
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

/** Protected `GET /api/exercise?day=`: the day's entries (enriched) and total duration. */
export function createGetExerciseHandler(options: ExerciseHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const day = await getExerciseDay(options.exerciseRepository, userId, requireDay(c.req.query("day")));
    return c.json({
      day: day.day,
      entries: day.entries.map(entryToJson),
      total_minutes: day.totalMinutes,
    });
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
    if (!(durationMinutes > 0)) throw new BadRequestError("duration_minutes must be greater than 0");
    const note = typeof body.note === "string" ? body.note : "";

    const entry = await logExercise(options.exerciseRepository, { userId, day, activityId, durationMinutes, note });
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
    const deleted = await deleteExerciseEntry(options.exerciseRepository, userId, c.req.param("id") ?? "");
    return c.json({ deleted });
  };
}
