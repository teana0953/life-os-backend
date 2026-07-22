import { beforeEach, describe, expect, it } from "vitest";
import { addPeriod, InvalidPeriodError } from "../../../../src/contexts/health/application/add-period";
import { updatePeriod } from "../../../../src/contexts/health/application/update-period";
import { deletePeriod } from "../../../../src/contexts/health/application/delete-period";
import { getMenstrualOverview } from "../../../../src/contexts/health/application/get-menstrual-overview";
import type { MenstrualPeriod } from "../../../../src/contexts/health/domain/menstrual-period";
import type {
  AddPeriodInput,
  MenstrualRepository,
  UpdatePeriodPatch,
} from "../../../../src/contexts/health/domain/menstrual-repository";

class InMemoryMenstrualRepository implements MenstrualRepository {
  periods: MenstrualPeriod[] = [];
  private nextId = 1;

  async add(input: AddPeriodInput): Promise<MenstrualPeriod> {
    const period: MenstrualPeriod = {
      id: `period-${this.nextId++}`,
      userId: input.userId,
      startDate: input.startDate,
      endDate: input.endDate,
    };
    this.periods.push(period);
    return period;
  }

  async listByUser(userId: string): Promise<MenstrualPeriod[]> {
    return this.periods
      .filter((p) => p.userId === userId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  async update(userId: string, id: string, patch: UpdatePeriodPatch): Promise<MenstrualPeriod | null> {
    const period = this.periods.find((p) => p.id === id && p.userId === userId);
    if (!period) return null;
    if ("startDate" in patch && patch.startDate !== undefined) period.startDate = patch.startDate;
    if ("endDate" in patch) period.endDate = patch.endDate as string | null;
    return period;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const idx = this.periods.findIndex((p) => p.id === id && p.userId === userId);
    if (idx === -1) return false;
    this.periods.splice(idx, 1);
    return true;
  }
}

let repo: InMemoryMenstrualRepository;

beforeEach(() => {
  repo = new InMemoryMenstrualRepository();
});

describe("addPeriod", () => {
  it("stores and returns an open period", async () => {
    const period = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: null });
    expect(period).toMatchObject({ startDate: "2026-05-01", endDate: null });
    expect(repo.periods).toHaveLength(1);
  });

  it("stores a completed period with an end date on or after the start", async () => {
    const period = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: "2026-05-05" });
    expect(period.endDate).toBe("2026-05-05");
  });

  it("rejects an end date earlier than the start date", async () => {
    await expect(
      addPeriod(repo, { userId: "user-1", startDate: "2026-05-05", endDate: "2026-05-01" }),
    ).rejects.toBeInstanceOf(InvalidPeriodError);
    expect(repo.periods).toHaveLength(0);
  });
});

describe("updatePeriod", () => {
  it("sets an end date on an open period, preserving the start date", async () => {
    const created = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: null });
    const updated = await updatePeriod(repo, "user-1", created.id, { endDate: "2026-05-05" });
    expect(updated).toMatchObject({ startDate: "2026-05-01", endDate: "2026-05-05" });
  });

  it("patching only startDate does NOT wipe the existing endDate", async () => {
    const created = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: "2026-05-05" });
    const updated = await updatePeriod(repo, "user-1", created.id, { startDate: "2026-05-02" });
    expect(updated).toMatchObject({ startDate: "2026-05-02", endDate: "2026-05-05" });
  });

  it("patching only endDate keeps the existing startDate", async () => {
    const created = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: "2026-05-05" });
    const updated = await updatePeriod(repo, "user-1", created.id, { endDate: "2026-05-07" });
    expect(updated).toMatchObject({ startDate: "2026-05-01", endDate: "2026-05-07" });
  });

  it("clears the end date when endDate is explicitly null", async () => {
    const created = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: "2026-05-05" });
    const updated = await updatePeriod(repo, "user-1", created.id, { endDate: null });
    expect(updated?.endDate).toBeNull();
  });

  it("an empty patch is a no-op returning the current period", async () => {
    const created = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: "2026-05-05" });
    const updated = await updatePeriod(repo, "user-1", created.id, {});
    expect(updated).toMatchObject({ startDate: "2026-05-01", endDate: "2026-05-05" });
  });

  it("rejects when the merged end date is earlier than the (kept) start date", async () => {
    const created = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-05", endDate: null });
    await expect(updatePeriod(repo, "user-1", created.id, { endDate: "2026-05-01" })).rejects.toBeInstanceOf(
      InvalidPeriodError,
    );
    // unchanged
    expect(repo.periods[0].endDate).toBeNull();
  });

  it("rejects when a new start date is after the (kept) end date", async () => {
    const created = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: "2026-05-05" });
    await expect(updatePeriod(repo, "user-1", created.id, { startDate: "2026-05-10" })).rejects.toBeInstanceOf(
      InvalidPeriodError,
    );
  });

  it("returns null for another user's / unknown id", async () => {
    const created = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: null });
    expect(await updatePeriod(repo, "user-2", created.id, { endDate: "2026-05-05" })).toBeNull();
    expect(await updatePeriod(repo, "user-1", "nope", { endDate: "2026-05-05" })).toBeNull();
  });
});

describe("deletePeriod", () => {
  it("returns true when the owned period is deleted", async () => {
    const created = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: null });
    expect(await deletePeriod(repo, "user-1", created.id)).toBe(true);
    expect(repo.periods).toHaveLength(0);
  });

  it("returns false for another user's period", async () => {
    const created = await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: null });
    expect(await deletePeriod(repo, "user-2", created.id)).toBe(false);
    expect(repo.periods).toHaveLength(1);
  });
});

describe("getMenstrualOverview", () => {
  it("returns empty periods, all-null stats, and null lastPeriod for a user with none", async () => {
    const overview = await getMenstrualOverview(repo, "user-1");
    expect(overview).toEqual({
      periods: [],
      stats: { averageCycleDays: null, averagePeriodDays: null, predictedNextStart: null },
      lastPeriod: null,
    });
  });

  it("returns sorted periods, computed stats, and the most recent period", async () => {
    await addPeriod(repo, { userId: "user-1", startDate: "2026-06-26", endDate: null });
    await addPeriod(repo, { userId: "user-1", startDate: "2026-05-01", endDate: "2026-05-05" });
    await addPeriod(repo, { userId: "user-1", startDate: "2026-05-29", endDate: null });

    const overview = await getMenstrualOverview(repo, "user-1");

    expect(overview.periods.map((p) => p.startDate)).toEqual(["2026-05-01", "2026-05-29", "2026-06-26"]);
    expect(overview.stats.averageCycleDays).toBe(28);
    expect(overview.stats.averagePeriodDays).toBe(5);
    expect(overview.stats.predictedNextStart).toBe("2026-07-24");
    expect(overview.lastPeriod?.startDate).toBe("2026-06-26");
  });
});
