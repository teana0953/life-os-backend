import { beforeEach, describe, expect, it } from "vitest";
import { getNetWorthTrend } from "../../../../src/contexts/finance/application/get-networth-trend";
import { InMemoryNetWorthRepository } from "../networth-fakes";

let repo: InMemoryNetWorthRepository;

beforeEach(() => {
  repo = new InMemoryNetWorthRepository();
});

describe("getNetWorthTrend", () => {
  it("lists months ascending with each month's net worth, skipping months with no snapshot", async () => {
    const asset = await repo.createAccount({ userId: "user-1", kind: "asset", name: "股票" });
    const liability = await repo.createAccount({ userId: "user-1", kind: "liability", name: "信用卡" });
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-01", value: 400000 });
    await repo.upsertSnapshot({ userId: "user-1", accountId: liability.id, month: "2026-01", value: 24959 });
    // Feb absent.
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-03", value: 420000 });

    const points = await getNetWorthTrend(repo, "user-1", "2026-01", "2026-03");
    expect(points).toEqual([
      { month: "2026-01", netWorth: 375041 },
      { month: "2026-03", netWorth: 420000 },
    ]);
  });

  it("still counts an archived account's existing snapshots in the trend (archive is not retroactive)", async () => {
    const asset = await repo.createAccount({ userId: "user-1", kind: "asset", name: "股票" });
    const oldCash = await repo.createAccount({ userId: "user-1", kind: "asset", name: "舊帳戶" });
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-01", value: 100000 });
    await repo.upsertSnapshot({ userId: "user-1", accountId: oldCash.id, month: "2026-01", value: 50000 });
    // Archive AFTER the January snapshot exists.
    oldCash.archived = true;

    const points = await getNetWorthTrend(repo, "user-1", "2026-01", "2026-01");
    // 100000 + 50000 must stay; the January point must not shrink to 100000.
    expect(points).toEqual([{ month: "2026-01", netWorth: 150000 }]);
  });

  it("returns an empty series for a range with no snapshots", async () => {
    const asset = await repo.createAccount({ userId: "user-1", kind: "asset", name: "股票" });
    await repo.upsertSnapshot({ userId: "user-1", accountId: asset.id, month: "2026-01", value: 100 });
    expect(await getNetWorthTrend(repo, "user-1", "2026-05", "2026-08")).toEqual([]);
  });
});
