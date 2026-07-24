import { beforeEach, describe, expect, it } from "vitest";
import { getBowelDay } from "../../../../src/contexts/health/application/get-bowel-day";
import { setBowelDay } from "../../../../src/contexts/health/application/set-bowel-day";
import type { BowelLog } from "../../../../src/contexts/health/domain/bowel";
import type { SetBowelLogInput, BowelRepository } from "../../../../src/contexts/health/domain/bowel-repository";

class InMemoryBowelRepository implements BowelRepository {
  private byUserDay = new Map<string, BowelLog>();

  async get(userId: string, day: string): Promise<BowelLog | null> {
    return this.byUserDay.get(`${userId}:${day}`) ?? null;
  }

  async set(input: SetBowelLogInput): Promise<BowelLog> {
    const log: BowelLog = {
      userId: input.userId,
      day: input.day,
      count: input.count,
      isNormal: input.isNormal,
      note: input.note,
    };
    this.byUserDay.set(`${input.userId}:${input.day}`, log);
    return log;
  }

  async setMany(rows: SetBowelLogInput[]): Promise<void> {
    for (const row of rows) {
      await this.set(row);
    }
  }

  async listRange(userId: string, from: string, to: string): Promise<BowelLog[]> {
    return [...this.byUserDay.values()].filter((r) => r.userId === userId && r.day >= from && r.day <= to);
  }
}

let repo: InMemoryBowelRepository;

beforeEach(() => {
  repo = new InMemoryBowelRepository();
});

describe("getBowelDay", () => {
  it("returns the day's record when one exists", async () => {
    await setBowelDay(repo, { userId: "user-1", day: "2026-07-18", count: 2, isNormal: true, note: "fine" });

    const result = await getBowelDay(repo, "user-1", "2026-07-18");

    expect(result).toEqual({ day: "2026-07-18", count: 2, isNormal: true, note: "fine" });
  });

  it("returns an empty default when the day has no record", async () => {
    const result = await getBowelDay(repo, "user-1", "2026-07-18");

    expect(result).toEqual({ day: "2026-07-18", count: 0, isNormal: null, note: "" });
  });
});

describe("setBowelDay", () => {
  it("upserts the day's count, flag, and note", async () => {
    await setBowelDay(repo, { userId: "user-1", day: "2026-07-18", count: 1, isNormal: false, note: "a" });
    const log = await setBowelDay(repo, { userId: "user-1", day: "2026-07-18", count: 3, isNormal: true, note: "b" });

    expect(log).toEqual({ userId: "user-1", day: "2026-07-18", count: 3, isNormal: true, note: "b" });
    expect(await repo.get("user-1", "2026-07-18")).toEqual({
      userId: "user-1",
      day: "2026-07-18",
      count: 3,
      isNormal: true,
      note: "b",
    });
  });

  it("allows a null flag and an empty note", async () => {
    const log = await setBowelDay(repo, { userId: "user-1", day: "2026-07-18", count: 1, isNormal: null, note: "" });

    expect(log.isNormal).toBeNull();
    expect(log.note).toBe("");
  });
});
