import { beforeEach, describe, expect, it } from "vitest";
import { upsertNetWorthSnapshot } from "../../../../src/contexts/finance/application/upsert-networth-snapshot";
import { InvalidFinanceInputError } from "../../../../src/contexts/finance/domain/errors";
import { NetWorthAccountArchived, NetWorthAccountNotFound } from "../../../../src/contexts/finance/domain/networth-errors";
import { InMemoryNetWorthRepository } from "../networth-fakes";

let repo: InMemoryNetWorthRepository;

beforeEach(() => {
  repo = new InMemoryNetWorthRepository();
});

describe("upsertNetWorthSnapshot", () => {
  it("overwrites the value for an existing (account, month)", async () => {
    const account = await repo.createAccount({ userId: "user-1", kind: "asset", name: "股票" });
    await upsertNetWorthSnapshot(repo, { userId: "user-1", accountId: account.id, month: "2026-07", value: 30000 });
    await upsertNetWorthSnapshot(repo, { userId: "user-1", accountId: account.id, month: "2026-07", value: 25000 });
    const forMonth = repo.snapshots.filter((s) => s.accountId === account.id && s.month === "2026-07");
    expect(forMonth).toHaveLength(1);
    expect(forMonth[0].value).toBe(25000);
  });

  it("accepts a zero value", async () => {
    const account = await repo.createAccount({ userId: "user-1", kind: "asset", name: "股票" });
    const snapshot = await upsertNetWorthSnapshot(repo, { userId: "user-1", accountId: account.id, month: "2026-07", value: 0 });
    expect(snapshot.value).toBe(0);
  });

  it("rejects a negative value with 400", async () => {
    const account = await repo.createAccount({ userId: "user-1", kind: "asset", name: "股票" });
    await expect(
      upsertNetWorthSnapshot(repo, { userId: "user-1", accountId: account.id, month: "2026-07", value: -1 }),
    ).rejects.toBeInstanceOf(InvalidFinanceInputError);
  });

  it("rejects a non-integer value with 400", async () => {
    const account = await repo.createAccount({ userId: "user-1", kind: "asset", name: "股票" });
    await expect(
      upsertNetWorthSnapshot(repo, { userId: "user-1", accountId: account.id, month: "2026-07", value: 1.5 }),
    ).rejects.toBeInstanceOf(InvalidFinanceInputError);
  });

  it("rejects writing onto an archived account with NetWorthAccountArchived", async () => {
    const account = await repo.createAccount({ userId: "user-1", kind: "asset", name: "股票" });
    await repo.updateAccount("user-1", account.id, { archived: true });
    await expect(
      upsertNetWorthSnapshot(repo, { userId: "user-1", accountId: account.id, month: "2026-07", value: 100 }),
    ).rejects.toBeInstanceOf(NetWorthAccountArchived);
  });

  it("throws NetWorthAccountNotFound for a foreign account", async () => {
    const account = await repo.createAccount({ userId: "user-1", kind: "asset", name: "股票" });
    await expect(
      upsertNetWorthSnapshot(repo, { userId: "user-2", accountId: account.id, month: "2026-07", value: 100 }),
    ).rejects.toBeInstanceOf(NetWorthAccountNotFound);
  });

  it("throws NetWorthAccountNotFound for a missing account", async () => {
    await expect(
      upsertNetWorthSnapshot(repo, { userId: "user-1", accountId: "nope", month: "2026-07", value: 100 }),
    ).rejects.toBeInstanceOf(NetWorthAccountNotFound);
  });
});
