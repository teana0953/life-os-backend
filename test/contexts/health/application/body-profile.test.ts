import { beforeEach, describe, expect, it } from "vitest";
import { getBodyProfile } from "../../../../src/contexts/health/application/get-body-profile";
import { getWeightGoal } from "../../../../src/contexts/health/application/get-weight-goal";
import { InvalidBodyProfileError, setBodyProfile } from "../../../../src/contexts/health/application/set-body-profile";
import type { BodyProfile } from "../../../../src/contexts/health/domain/body-profile";
import type {
  BodyProfileRepository,
  UpdateBodyProfilePatch,
} from "../../../../src/contexts/health/domain/body-profile-repository";
import type { VitalsRecord } from "../../../../src/contexts/health/domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../../../../src/contexts/health/domain/vitals-repository";

class InMemoryBodyProfileRepository implements BodyProfileRepository {
  private byUser = new Map<string, BodyProfile>();

  async get(userId: string): Promise<BodyProfile | null> {
    return this.byUser.get(userId) ?? null;
  }

  async upsert(userId: string, patch: UpdateBodyProfilePatch): Promise<BodyProfile> {
    const current = this.byUser.get(userId) ?? { userId, heightCm: null, targetWeightKg: null };
    // Empty patch → no-op returning the current profile (or default).
    const next: BodyProfile = {
      userId,
      heightCm: patch.heightCm !== undefined ? patch.heightCm : current.heightCm,
      targetWeightKg: patch.targetWeightKg !== undefined ? patch.targetWeightKg : current.targetWeightKg,
    };
    this.byUser.set(userId, next);
    return next;
  }
}

/** A minimal vitals fake exposing only the two weight reads used by getWeightGoal. */
class FakeVitalsRepository implements VitalsRepository {
  constructor(
    private readonly latest: number | null,
    private readonly earliest: number | null,
    private readonly weightDays = 2,
  ) {}
  async get(): Promise<VitalsRecord | null> {
    throw new Error("not used");
  }
  async set(_input: SetVitalsInput): Promise<VitalsRecord> {
    throw new Error("not used");
  }
  async setMany(): Promise<void> {
    throw new Error("not used");
  }
  async getLatestWeight(): Promise<number | null> {
    return this.latest;
  }
  async getEarliestWeight(): Promise<number | null> {
    return this.earliest;
  }
  async getWeightDayCount(): Promise<number> {
    return this.weightDays;
  }
  async listRange(): Promise<VitalsRecord[]> {
    throw new Error("not used");
  }
}

let repo: InMemoryBodyProfileRepository;

beforeEach(() => {
  repo = new InMemoryBodyProfileRepository();
});

describe("getBodyProfile", () => {
  it("returns the stored profile", async () => {
    await repo.upsert("user-1", { heightCm: 165, targetWeightKg: 51 });
    expect(await getBodyProfile(repo, "user-1")).toEqual({ userId: "user-1", heightCm: 165, targetWeightKg: 51 });
  });

  it("returns a null-valued default when none is set", async () => {
    expect(await getBodyProfile(repo, "user-1")).toEqual({ userId: "user-1", heightCm: null, targetWeightKg: null });
  });
});

describe("setBodyProfile", () => {
  it("a partial update changes only the given field, leaving the other unchanged", async () => {
    await setBodyProfile(repo, "user-1", { heightCm: 165, targetWeightKg: 55 });
    const updated = await setBodyProfile(repo, "user-1", { targetWeightKg: 51 });
    expect(updated).toEqual({ userId: "user-1", heightCm: 165, targetWeightKg: 51 });
  });

  it("rejects a non-positive height or target weight", async () => {
    await expect(setBodyProfile(repo, "user-1", { heightCm: 0 })).rejects.toBeInstanceOf(InvalidBodyProfileError);
    await expect(setBodyProfile(repo, "user-1", { targetWeightKg: -1 })).rejects.toBeInstanceOf(InvalidBodyProfileError);
    expect(await repo.get("user-1")).toBeNull();
  });
});

describe("getWeightGoal", () => {
  it("full overview: height 165, target 51, earliest 55, latest 52 → current 52, remaining 1, bmi 19.1, achievement 75", async () => {
    await repo.upsert("user-1", { heightCm: 165, targetWeightKg: 51 });
    const vitals = new FakeVitalsRepository(52, 55);
    expect(await getWeightGoal(repo, vitals, "user-1")).toEqual({
      heightCm: 165,
      targetWeightKg: 51,
      currentWeightKg: 52,
      remainingKg: 1,
      achievementRate: 75,
      bmi: 19.1,
    });
  });

  it("no target → remaining and achievement are null (BMI still computes)", async () => {
    await repo.upsert("user-1", { heightCm: 165 });
    const vitals = new FakeVitalsRepository(52, 55);
    const overview = await getWeightGoal(repo, vitals, "user-1");
    expect(overview.remainingKg).toBeNull();
    expect(overview.achievementRate).toBeNull();
    expect(overview.bmi).toBe(19.1);
  });

  it("weight on only one day → achievement null (not enough history)", async () => {
    await repo.upsert("user-1", { heightCm: 165, targetWeightKg: 51 });
    const vitals = new FakeVitalsRepository(52, 52, 1); // 1 weight day
    const overview = await getWeightGoal(repo, vitals, "user-1");
    expect(overview.achievementRate).toBeNull();
    expect(overview.currentWeightKg).toBe(52);
    expect(overview.remainingKg).toBe(1);
  });

  it("weight on two days at the same value → achievement 0 (no progress, not null)", async () => {
    await repo.upsert("user-1", { heightCm: 165, targetWeightKg: 51 });
    const vitals = new FakeVitalsRepository(52, 52, 2); // 2 weight days, same value
    const overview = await getWeightGoal(repo, vitals, "user-1");
    expect(overview.achievementRate).toBe(0);
  });
});
