import { beforeEach, describe, expect, it } from "vitest";
import { createNetWorthAccount } from "../../../../src/contexts/finance/application/create-networth-account";
import { listNetWorthAccounts } from "../../../../src/contexts/finance/application/list-networth-accounts";
import { updateNetWorthAccount } from "../../../../src/contexts/finance/application/update-networth-account";
import { NetWorthAccountNameConflict, NetWorthAccountNotFound } from "../../../../src/contexts/finance/domain/networth-errors";
import { InMemoryNetWorthRepository } from "../networth-fakes";

let repo: InMemoryNetWorthRepository;

beforeEach(() => {
  repo = new InMemoryNetWorthRepository();
});

describe("listNetWorthAccounts", () => {
  it("seeds and returns the defaults on first call", async () => {
    expect(await listNetWorthAccounts(repo, "user-1")).toHaveLength(10);
  });

  it("does not re-seed on a second call", async () => {
    await listNetWorthAccounts(repo, "user-1");
    expect(await listNetWorthAccounts(repo, "user-1")).toHaveLength(10);
  });
});

describe("createNetWorthAccount", () => {
  it("creates an account with default sort_order and archived false", async () => {
    const account = await createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "加密貨幣" });
    expect(account).toMatchObject({ kind: "asset", name: "加密貨幣", sortOrder: 0, archived: false });
  });

  it("rejects an unknown kind", async () => {
    await expect(
      createNetWorthAccount(repo, { userId: "user-1", kind: "savings" as never, name: "x" }),
    ).rejects.toBeInstanceOf(NetWorthAccountNameConflict);
  });

  it("rejects a duplicate name within the same kind as a name conflict, not a DB error", async () => {
    await createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "股票" });
    await expect(createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "股票" })).rejects.toBeInstanceOf(
      NetWorthAccountNameConflict,
    );
  });

  it("allows the same name for a different kind", async () => {
    await createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "其他" });
    const liability = await createNetWorthAccount(repo, { userId: "user-1", kind: "liability", name: "其他" });
    expect(liability.name).toBe("其他");
  });

  it("allows the same name for a different user", async () => {
    await createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "股票" });
    const other = await createNetWorthAccount(repo, { userId: "user-2", kind: "asset", name: "股票" });
    expect(other.name).toBe("股票");
  });
});

describe("updateNetWorthAccount", () => {
  it("updates name/sort_order/archived", async () => {
    const account = await createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "股票" });
    const updated = await updateNetWorthAccount(repo, "user-1", account.id, { name: "台股", sortOrder: 9, archived: true });
    expect(updated).toMatchObject({ name: "台股", sortOrder: 9, archived: true });
  });

  it("cannot change kind (patch has no kind field) — kind stays as created", async () => {
    const account = await createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "股票" });
    const updated = await updateNetWorthAccount(repo, "user-1", account.id, { name: "台股" });
    expect(updated.kind).toBe("asset");
  });

  it("throws NetWorthAccountNotFound for another user's account", async () => {
    const account = await createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "股票" });
    await expect(updateNetWorthAccount(repo, "user-2", account.id, { name: "台股" })).rejects.toBeInstanceOf(NetWorthAccountNotFound);
  });

  it("throws NetWorthAccountNotFound for an unknown id", async () => {
    await expect(updateNetWorthAccount(repo, "user-1", "nope", { name: "台股" })).rejects.toBeInstanceOf(NetWorthAccountNotFound);
  });

  it("rejects renaming to a name that collides within the same kind", async () => {
    await createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "股票" });
    const target = await createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "基金" });
    await expect(updateNetWorthAccount(repo, "user-1", target.id, { name: "股票" })).rejects.toBeInstanceOf(NetWorthAccountNameConflict);
  });

  it("archiving an account leaves it readable via listNetWorthAccounts", async () => {
    const account = await createNetWorthAccount(repo, { userId: "user-1", kind: "asset", name: "股票" });
    await updateNetWorthAccount(repo, "user-1", account.id, { archived: true });
    const accounts = await listNetWorthAccounts(repo, "user-1");
    expect(accounts.find((a) => a.id === account.id)).toMatchObject({ archived: true });
  });
});
