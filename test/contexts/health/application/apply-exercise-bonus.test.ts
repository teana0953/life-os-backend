import { describe, expect, it } from "vitest";
import { applyExerciseBonus } from "../../../../src/contexts/health/application/apply-exercise-bonus";
import type { DailyTarget } from "../../../../src/contexts/health/domain/daily-target";
import type { DailyTargetRepository, SetDailyTargetInput } from "../../../../src/contexts/health/domain/daily-target-repository";
import type { ExerciseEntry } from "../../../../src/contexts/health/domain/exercise-entry";
import type { AddExerciseEntryInput, ExerciseRepository } from "../../../../src/contexts/health/domain/exercise-repository";

class FakeExerciseRepository implements ExerciseRepository {
  constructor(private readonly minutesByDay: Record<string, number[]>) {}
  async addEntry(_input: AddExerciseEntryInput): Promise<ExerciseEntry> {
    throw new Error("not used");
  }
  async listByDay(_userId: string, day: string): Promise<ExerciseEntry[]> {
    return (this.minutesByDay[day] ?? []).map((minutes, i) => ({
      id: `${day}-${i}`,
      userId: "user-1",
      day,
      activityId: "jogging",
      durationMinutes: minutes,
      note: "",
      createdAt: new Date(0),
    }));
  }
  async deleteEntry(): Promise<string | null> {
    throw new Error("not used");
  }
}

class FakeDailyTargetRepository implements DailyTargetRepository {
  targets = new Map<string, DailyTarget>();
  lastSet?: SetDailyTargetInput;

  seed(day: string, baseStaple: number): void {
    this.targets.set(day, {
      id: day,
      userId: "user-1",
      day,
      baseStaple,
      baseMeat: 0,
      baseFruit: 0,
      baseVeg: 0,
      bonusStaple: 0,
      bonusMeat: 0,
      bonusFruit: 0,
      bonusVeg: 0,
    });
  }
  async get(_userId: string, day: string): Promise<DailyTarget | null> {
    return this.targets.get(day) ?? null;
  }
  async getLatestOnOrBefore(_userId: string, day: string): Promise<DailyTarget | null> {
    let latest: DailyTarget | null = null;
    for (const t of this.targets.values()) {
      if (t.day <= day && (!latest || t.day > latest.day)) latest = t;
    }
    return latest;
  }
  async listInRange(): Promise<DailyTarget[]> {
    return [];
  }
  async set(input: SetDailyTargetInput): Promise<DailyTarget> {
    this.lastSet = input;
    const target: DailyTarget = {
      id: input.day,
      userId: input.userId,
      day: input.day,
      baseStaple: input.baseStaple,
      baseMeat: input.baseMeat,
      baseFruit: input.baseFruit,
      baseVeg: input.baseVeg,
      bonusStaple: input.bonusStaple ?? 0,
      bonusMeat: input.bonusMeat ?? 0,
      bonusFruit: input.bonusFruit ?? 0,
      bonusVeg: input.bonusVeg ?? 0,
    };
    this.targets.set(input.day, target);
    return target;
  }
}

describe("applyExerciseBonus", () => {
  it("writes a staple + meat bonus from the day's total minutes, preserving the base", async () => {
    const exercise = new FakeExerciseRepository({ "2026-07-18": [30, 45] }); // 75 min → 2 portions
    const targets = new FakeDailyTargetRepository();
    targets.seed("2026-07-18", 12); // base staple 12

    await applyExerciseBonus(targets, exercise, "user-1", "2026-07-18");

    expect(targets.lastSet).toMatchObject({
      day: "2026-07-18",
      baseStaple: 12, // preserved
      bonusStaple: 2,
      bonusMeat: 2,
      bonusFruit: 0,
      bonusVeg: 0,
    });
  });

  it("carries a base forward from an earlier target when the day has none of its own", async () => {
    const exercise = new FakeExerciseRepository({ "2026-07-20": [60] }); // 2 portions
    const targets = new FakeDailyTargetRepository();
    targets.seed("2026-07-01", 10); // earlier target → carries to 2026-07-20

    await applyExerciseBonus(targets, exercise, "user-1", "2026-07-20");

    expect(targets.lastSet).toMatchObject({ baseStaple: 10, bonusStaple: 2, bonusMeat: 2 });
  });

  it("clears the bonus when the day has no exercise", async () => {
    const exercise = new FakeExerciseRepository({}); // no entries
    const targets = new FakeDailyTargetRepository();
    targets.seed("2026-07-18", 12);

    await applyExerciseBonus(targets, exercise, "user-1", "2026-07-18");

    expect(targets.lastSet).toMatchObject({ bonusStaple: 0, bonusMeat: 0 });
  });
});
