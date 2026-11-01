import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleNetWorthRepository } from "../../src/contexts/finance/adapters/drizzle-networth-repository";
import { updateNetWorthAccount } from "../../src/contexts/finance/application/update-networth-account";
import type { ExposureFactor } from "../../src/contexts/finance/domain/networth-account";
import { NetWorthAccountNotFound, NetWorthExposureNotAllowed } from "../../src/contexts/finance/domain/networth-errors";
import { createTestDb, insertUser, type TestDb } from "./harness";

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const factors: (ExposureFactor | null)[] = [0, 1, 2, 3, null];

describe("net-worth exposure persistence and migration", () => {
  let harness: TestDb;
  let deviceA: DrizzleNetWorthRepository;
  let deviceB: DrizzleNetWorthRepository;

  beforeAll(async () => {
    harness = await createTestDb();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.resetDb();
    await insertUser(harness.db, OWNER, "owner@example.com");
    await insertUser(harness.db, OTHER, "other@example.com");
    deviceA = new DrizzleNetWorthRepository(() => harness.db);
    deviceB = new DrizzleNetWorthRepository(() => harness.db);
  });

  it("applies the generated migration to legacy rows with unknown exposure and defaults new rows to null", async () => {
    const asset = await deviceA.createAccount({ userId: OWNER, kind: "asset", name: "legacy asset" });
    const liability = await deviceA.createAccount({ userId: OWNER, kind: "liability", name: "legacy debt" });
    await harness.db.execute(sql.raw(
      "ALTER TABLE finance_networth_account DROP CONSTRAINT finance_networth_account_exposure_factor_check, DROP COLUMN exposure_factor",
    ));
    const migration = readFileSync("drizzle/0037_old_bedlam.sql", "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      await harness.db.execute(sql.raw(statement));
    }
    expect(await deviceB.listAccounts(OWNER)).toEqual([
      { ...asset, exposureFactor: null },
      { ...liability, exposureFactor: null },
    ]);
    for (const kind of ["asset", "liability"] satisfies ("asset" | "liability")[]) {
      expect((await deviceB.createAccount({ userId: OWNER, kind, name: `new ${kind}` })).exposureFactor).toBeNull();
    }
    await deviceA.insertDefaultAccountsIfMissing([{ userId: OTHER, kind: "asset", name: "default" }]);
    expect(await deviceB.listAccounts(OTHER)).toMatchObject([{ exposureFactor: null }]);
  });

  it.each(factors)("round-trips %s across two real repository instances", async (exposureFactor) => {
    const asset = await deviceA.createAccount({ userId: OWNER, kind: "asset", name: "shares", sortOrder: 8 });
    await updateNetWorthAccount(deviceA, OWNER, asset.id, { exposureFactor: 2, archived: true });
    const saved = await updateNetWorthAccount(deviceA, OWNER, asset.id, { exposureFactor });
    expect(saved).toEqual({ ...asset, exposureFactor, archived: true });
    expect(await deviceB.listAccounts(OWNER)).toEqual([saved]);
    expect(await deviceB.findAccountById(asset.id)).toEqual(saved);
    expect(await deviceB.findAccountByUserKindName(OWNER, "asset", "shares")).toEqual(saved);
  });

  it("device B clears a device A save and device A reloads unknown", async () => {
    const asset = await deviceA.createAccount({ userId: OWNER, kind: "asset", name: "shares" });
    await updateNetWorthAccount(deviceA, OWNER, asset.id, { exposureFactor: 3 });
    expect((await deviceB.listAccounts(OWNER))[0].exposureFactor).toBe(3);
    await updateNetWorthAccount(deviceB, OWNER, asset.id, { exposureFactor: null });
    expect((await deviceA.listAccounts(OWNER))[0].exposureFactor).toBeNull();
  });

  it("unrelated writes and batch reorder preserve exposure, and exposure writes preserve other fields", async () => {
    const asset = await deviceA.createAccount({ userId: OWNER, kind: "asset", name: "shares" });
    await deviceA.updateAccount(OWNER, asset.id, { exposureFactor: 0 });
    for (const patch of [{ name: "renamed" }, { sortOrder: 12 }, { archived: true }, {}]) {
      expect((await deviceB.updateAccount(OWNER, asset.id, patch))?.exposureFactor).toBe(0);
    }
    await deviceB.reorderAccounts(OWNER, "asset", [asset.id]);
    expect(await deviceA.findAccountById(asset.id)).toEqual({ ...asset, name: "renamed", sortOrder: 0, archived: true, exposureFactor: 0 });
    await deviceA.updateAccount(OWNER, asset.id, { exposureFactor: 3 });
    expect(await deviceB.findAccountById(asset.id)).toEqual({ ...asset, name: "renamed", sortOrder: 0, archived: true, exposureFactor: 3 });
  });

  it("scopes reads and direct updates to the owner and conceals foreign accounts in the use case", async () => {
    const owned = await deviceA.createAccount({ userId: OWNER, kind: "asset", name: "same name" });
    const foreign = await deviceB.createAccount({ userId: OTHER, kind: "asset", name: "same name" });
    await deviceA.updateAccount(OWNER, owned.id, { exposureFactor: 1 });
    await deviceB.updateAccount(OTHER, foreign.id, { exposureFactor: 2 });
    expect(await deviceB.updateAccount(OTHER, owned.id, { exposureFactor: 3, name: "spoofed" })).toBeNull();
    expect(await deviceB.updateAccount(OWNER, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", { exposureFactor: 3 })).toBeNull();
    await expect(updateNetWorthAccount(deviceB, OTHER, owned.id, { exposureFactor: null })).rejects.toBeInstanceOf(NetWorthAccountNotFound);
    expect(await deviceA.listAccounts(OWNER)).toEqual([{ ...owned, exposureFactor: 1 }]);
    expect(await deviceB.listAccounts(OTHER)).toEqual([{ ...foreign, exposureFactor: 2 }]);
  });

  it.each([-1, 4, 100])("SQL rejects out-of-set exposure %s on insert and update", async (invalid) => {
    const asset = await deviceA.createAccount({ userId: OWNER, kind: "asset", name: "shares" });
    await expect(harness.db.execute(sql`
      INSERT INTO finance_networth_account (user_id, kind, name, exposure_factor)
      VALUES (${OWNER}, 'asset', 'invalid', ${invalid})
    `)).rejects.toMatchObject({ cause: { code: "23514", constraint: "finance_networth_account_exposure_factor_check" } });
    await expect(harness.db.execute(sql`
      UPDATE finance_networth_account SET exposure_factor = ${invalid} WHERE id = ${asset.id}
    `)).rejects.toMatchObject({ cause: { code: "23514", constraint: "finance_networth_account_exposure_factor_check" } });
    expect((await deviceB.findAccountById(asset.id))?.exposureFactor).toBeNull();
  });

  it.each(factors.filter((factor) => factor !== null))("SQL rejects liability exposure %s on insert, update, and kind change", async (exposureFactor) => {
    const liability = await deviceA.createAccount({ userId: OWNER, kind: "liability", name: "debt" });
    const asset = await deviceA.createAccount({ userId: OWNER, kind: "asset", name: "shares" });
    await expect(harness.db.execute(sql`
      INSERT INTO finance_networth_account (user_id, kind, name, exposure_factor)
      VALUES (${OWNER}, 'liability', 'invalid', ${exposureFactor})
    `)).rejects.toMatchObject({ cause: { code: "23514", constraint: "finance_networth_account_exposure_factor_check" } });
    await expect(harness.db.execute(sql`
      UPDATE finance_networth_account SET exposure_factor = ${exposureFactor} WHERE id = ${liability.id}
    `)).rejects.toMatchObject({ cause: { code: "23514", constraint: "finance_networth_account_exposure_factor_check" } });
    await deviceA.updateAccount(OWNER, asset.id, { exposureFactor });
    await expect(harness.db.execute(sql`
      UPDATE finance_networth_account SET kind = 'liability' WHERE id = ${asset.id}
    `)).rejects.toMatchObject({ cause: { code: "23514", constraint: "finance_networth_account_exposure_factor_check" } });
    expect((await deviceB.findAccountById(liability.id))?.exposureFactor).toBeNull();
    expect((await deviceB.findAccountById(asset.id))?.kind).toBe("asset");
  });

  it.each(factors)("use case rejects liability patch %s, even when SQL would permit null", async (exposureFactor) => {
    const liability = await deviceA.createAccount({ userId: OWNER, kind: "liability", name: "debt" });
    await expect(updateNetWorthAccount(deviceA, OWNER, liability.id, { exposureFactor, archived: true }))
      .rejects.toBeInstanceOf(NetWorthExposureNotAllowed);
    expect(await deviceB.findAccountById(liability.id)).toEqual(liability);
    expect((await updateNetWorthAccount(deviceA, OWNER, liability.id, { name: "renamed" })).exposureFactor).toBeNull();
  });
});
