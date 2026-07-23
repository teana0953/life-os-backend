import { beforeEach, describe, expect, it } from "vitest";
import { deleteExerciseEntry } from "../../../../src/contexts/health/application/delete-exercise-entry";
import { getExerciseDay } from "../../../../src/contexts/health/application/get-exercise-day";
import { listExerciseActivities } from "../../../../src/contexts/health/application/list-exercise-activities";
import { InvalidExerciseError, logExercise } from "../../../../src/contexts/health/application/log-exercise";
import { EXERCISE_ACTIVITIES } from "../../../../src/contexts/health/domain/exercise-activity";
import type { ExerciseEntry } from "../../../../src/contexts/health/domain/exercise-entry";
import type { AddExerciseEntryInput, ExerciseRepository } from "../../../../src/contexts/health/domain/exercise-repository";

class InMemoryExerciseRepository implements ExerciseRepository {
  // A single ordered list preserves insertion order for stable assertions.
  entries: ExerciseEntry[] = [];
  private nextId = 1;

  async addEntry(input: AddExerciseEntryInput): Promise<ExerciseEntry> {
    const entry: ExerciseEntry = {
      id: `entry-${this.nextId}`,
      userId: input.userId,
      day: input.day,
      activityId: input.activityId,
      durationMinutes: input.durationMinutes,
      note: input.note,
      createdAt: new Date(Date.UTC(2026, 6, 18, 0, 0, this.nextId)),
    };
    this.nextId++;
    this.entries.push(entry);
    return entry;
  }

  async listByDay(userId: string, day: string): Promise<ExerciseEntry[]> {
    return this.entries
      .filter((e) => e.userId === userId && e.day === day)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async deleteEntry(userId: string, entryId: string): Promise<string | null> {
    const idx = this.entries.findIndex((e) => e.id === entryId && e.userId === userId);
    if (idx === -1) return null;
    const [removed] = this.entries.splice(idx, 1);
    return removed.day;
  }
}

let repo: InMemoryExerciseRepository;

beforeEach(() => {
  repo = new InMemoryExerciseRepository();
});

describe("listExerciseActivities", () => {
  it("returns the static library", () => {
    expect(listExerciseActivities()).toEqual(EXERCISE_ACTIVITIES);
  });
});

describe("logExercise", () => {
  it("appends and returns the entry", async () => {
    const entry = await logExercise(repo, {
      userId: "user-1",
      day: "2026-07-18",
      activityId: "jogging",
      durationMinutes: 30,
      note: "morning",
    });

    expect(entry.activityId).toBe("jogging");
    expect(entry.durationMinutes).toBe(30);
    expect(repo.entries).toHaveLength(1);
  });

  it("rejects an activityId not in the library", async () => {
    await expect(
      logExercise(repo, { userId: "user-1", day: "2026-07-18", activityId: "nope", durationMinutes: 30, note: "" }),
    ).rejects.toBeInstanceOf(InvalidExerciseError);
    expect(repo.entries).toHaveLength(0);
  });

  it("rejects a non-positive durationMinutes", async () => {
    await expect(
      logExercise(repo, { userId: "user-1", day: "2026-07-18", activityId: "jogging", durationMinutes: 0, note: "" }),
    ).rejects.toBeInstanceOf(InvalidExerciseError);
    await expect(
      logExercise(repo, { userId: "user-1", day: "2026-07-18", activityId: "jogging", durationMinutes: -5, note: "" }),
    ).rejects.toBeInstanceOf(InvalidExerciseError);
    expect(repo.entries).toHaveLength(0);
  });
});

describe("getExerciseDay", () => {
  it("returns an empty default when the day has no entries", async () => {
    const day = await getExerciseDay(repo, "user-1", "2026-07-18");
    expect(day).toEqual({ day: "2026-07-18", entries: [], totalMinutes: 0 });
  });

  it("enriches entries and sums total minutes", async () => {
    await logExercise(repo, { userId: "user-1", day: "2026-07-18", activityId: "jogging", durationMinutes: 30, note: "a" });
    await logExercise(repo, { userId: "user-1", day: "2026-07-18", activityId: "squats", durationMinutes: 20, note: "" });

    const day = await getExerciseDay(repo, "user-1", "2026-07-18");

    expect(day.totalMinutes).toBe(50);
    expect(day.entries).toHaveLength(2);
    expect(day.entries[0]).toMatchObject({ activityId: "jogging", activityName: "慢跑", category: "aerobic", durationMinutes: 30 });
    expect(day.entries[1]).toMatchObject({ activityId: "squats", activityName: "深蹲", category: "anaerobic", durationMinutes: 20 });
  });

  it("reports null name/category when an entry references an id outside the library", async () => {
    // Insert directly, bypassing logExercise's validation, to simulate a stale id.
    await repo.addEntry({ userId: "user-1", day: "2026-07-18", activityId: "removed", durationMinutes: 15, note: "" });

    const day = await getExerciseDay(repo, "user-1", "2026-07-18");

    expect(day.entries[0].activityName).toBeNull();
    expect(day.entries[0].category).toBeNull();
    expect(day.totalMinutes).toBe(15);
  });
});

describe("deleteExerciseEntry", () => {
  it("returns the day when the owned entry is deleted", async () => {
    const entry = await logExercise(repo, { userId: "user-1", day: "2026-07-18", activityId: "jogging", durationMinutes: 30, note: "" });
    expect(await deleteExerciseEntry(repo, "user-1", entry.id)).toBe("2026-07-18");
    expect(repo.entries).toHaveLength(0);
  });

  it("returns null for another user's entry", async () => {
    const entry = await logExercise(repo, { userId: "user-1", day: "2026-07-18", activityId: "jogging", durationMinutes: 30, note: "" });
    expect(await deleteExerciseEntry(repo, "user-2", entry.id)).toBeNull();
    expect(repo.entries).toHaveLength(1);
  });
});
