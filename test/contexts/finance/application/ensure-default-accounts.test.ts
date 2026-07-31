import { beforeEach, describe, expect, it } from "vitest";
import { ensureDefaultAccounts } from "../../../../src/contexts/finance/application/ensure-default-accounts";
import { InMemoryNetWorthRepository } from "../networth-fakes";

let repo: InMemoryNetWorthRepository;

beforeEach(() => {
  repo = new InMemoryNetWorthRepository();
});

describe("ensureDefaultAccounts", () => {
  it("seeds the 6 asset + 4 liability defaults for a user with none", async () => {
    await ensureDefaultAccounts(repo, "user-1");
    const accounts = await repo.listAccounts("user-1");
    expect(accounts).toHaveLength(10);
    expect(accounts.filter((a) => a.kind === "asset")).toHaveLength(6);
    expect(accounts.filter((a) => a.kind === "liability")).toHaveLength(4);
    expect(accounts.map((a) => a.name)).toContain("股票");
    expect(accounts.map((a) => a.name)).toContain("學貸");
  });

  it("is idempotent: calling twice does not duplicate", async () => {
    await ensureDefaultAccounts(repo, "user-1");
    await ensureDefaultAccounts(repo, "user-1");
    expect(await repo.listAccounts("user-1")).toHaveLength(10);
  });

  it("does not seed for a user who already has an account", async () => {
    await repo.createAccount({ userId: "user-1", kind: "asset", name: "custom" });
    await ensureDefaultAccounts(repo, "user-1");
    expect(await repo.listAccounts("user-1")).toHaveLength(1);
  });

  it("does not seed for a user whose only account is archived", async () => {
    const created = await repo.createAccount({ userId: "user-1", kind: "asset", name: "custom" });
    await repo.updateAccount("user-1", created.id, { archived: true });
    await ensureDefaultAccounts(repo, "user-1");
    expect(await repo.listAccounts("user-1")).toHaveLength(1);
  });

  it("seeding one user does not affect another", async () => {
    await ensureDefaultAccounts(repo, "user-1");
    expect(await repo.listAccounts("user-2")).toHaveLength(0);
  });
});
