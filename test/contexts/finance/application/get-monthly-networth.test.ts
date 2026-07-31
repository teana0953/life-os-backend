import { beforeEach, describe, expect, it } from "vitest";
import { getMonthlyNetWorth } from "../../../../src/contexts/finance/application/get-monthly-networth";
import { InMemoryNetWorthRepository } from "../networth-fakes";

let repo: InMemoryNetWorthRepository;

beforeEach(() => {
  repo = new InMemoryNetWorthRepository();
});

async function seedAccount(userId: string, kind: "asset" | "liability", name: string) {
  return repo.createAccount({ userId, kind, name });
}

describe("getMonthlyNetWorth", () => {
  it("subtracts liabilities from assets and computes growth against the prior month (spec example)", async () => {
    const stock = await seedAccount("user-1", "asset", "股票");
    const cash = await seedAccount("user-1", "asset", "台幣活存");
    const card = await seedAccount("user-1", "liability", "信用卡");
    const juneAsset = await seedAccount("user-1", "asset", "基金");
    // June net worth = 460181 (single asset snapshot).
    await repo.upsertSnapshot({ userId: "user-1", accountId: juneAsset.id, month: "2026-06", value: 460181 });
    // July: assets sum 520000, liabilities sum 41484 -> net 478516.
    await repo.upsertSnapshot({ userId: "user-1", accountId: stock.id, month: "2026-07", value: 350000 });
    await repo.upsertSnapshot({ userId: "user-1", accountId: cash.id, month: "2026-07", value: 170000 });
    await repo.upsertSnapshot({ userId: "user-1", accountId: card.id, month: "2026-07", value: 41484 });

    const result = await getMonthlyNetWorth(repo, "user-1", "2026-07");
    expect(result.totalAsset).toBe(520000);
    expect(result.totalLiability).toBe(41484);
    expect(result.netWorth).toBe(478516);
    expect(result.prevNetWorth).toBe(460181);
    expect(result.growthRate).toBeCloseTo(0.0398, 4);
    expect(result.accounts).toHaveLength(3);
  });

  it("returns null prev_net_worth and growth_rate for the first month with data", async () => {
    const stock = await seedAccount("user-1", "asset", "股票");
    await repo.upsertSnapshot({ userId: "user-1", accountId: stock.id, month: "2026-07", value: 100000 });
    const result = await getMonthlyNetWorth(repo, "user-1", "2026-07");
    expect(result.netWorth).toBe(100000);
    expect(result.prevNetWorth).toBeNull();
    expect(result.growthRate).toBeNull();
  });

  it("uses the most recent earlier month with data as prev, skipping empty calendar months", async () => {
    const asset = await seedAccount("user-1", "asset", "股票");
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-01", value: 100000 });
    // Feb, Mar empty; April queried -> prev is January, not March.
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-04", value: 110000 });
    const result = await getMonthlyNetWorth(repo, "user-1", "2026-04");
    expect(result.prevNetWorth).toBe(100000);
    expect(result.growthRate).toBeCloseTo(0.1, 4);
  });

  it("gives null growth_rate when the prior net worth is zero", async () => {
    const asset = await seedAccount("user-1", "asset", "股票");
    const liability = await seedAccount("user-1", "liability", "信用卡");
    // June net worth = asset 500 - liability 500 = 0.
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-06", value: 500 });
    await repo.upsertSnapshot({ userId: "user-1", accountId: liability.id, month: "2026-06", value: 500 });
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-07", value: 1000 });
    const result = await getMonthlyNetWorth(repo, "user-1", "2026-07");
    expect(result.prevNetWorth).toBe(0);
    expect(result.growthRate).toBeNull();
  });

  it("gives null growth_rate when the prior net worth is negative", async () => {
    const asset = await seedAccount("user-1", "asset", "股票");
    const liability = await seedAccount("user-1", "liability", "信用卡");
    // June net worth = 100 - 500 = -400.
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-06", value: 100 });
    await repo.upsertSnapshot({ userId: "user-1", accountId: liability.id, month: "2026-06", value: 500 });
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-07", value: 1000 });
    const result = await getMonthlyNetWorth(repo, "user-1", "2026-07");
    expect(result.prevNetWorth).toBe(-400);
    expect(result.growthRate).toBeNull();
  });

  it("computes negative growth (spreadsheet 2月 example ≈ -4.0%)", async () => {
    const asset = await seedAccount("user-1", "asset", "股票");
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-01", value: 100000 });
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-02", value: 96000 });
    const result = await getMonthlyNetWorth(repo, "user-1", "2026-02");
    expect(result.growthRate).toBeCloseTo(-0.04, 4);
  });

  it("scopes to the requested user only", async () => {
    const mine = await seedAccount("user-1", "asset", "股票");
    const theirs = await seedAccount("user-2", "asset", "股票");
    await repo.upsertSnapshot({ userId: "user-1", accountId: mine.id, month: "2026-07", value: 100 });
    await repo.upsertSnapshot({ userId: "user-2", accountId: theirs.id, month: "2026-07", value: 999999 });
    const result = await getMonthlyNetWorth(repo, "user-1", "2026-07");
    expect(result.netWorth).toBe(100);
    expect(result.accounts).toHaveLength(1);
  });
});
