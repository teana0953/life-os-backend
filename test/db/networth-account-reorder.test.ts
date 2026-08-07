import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, sql } from "drizzle-orm";
import { financeNetworthAccount } from "../../src/shared/db/schema";
import { DrizzleNetWorthRepository } from "../../src/contexts/finance/adapters/drizzle-networth-repository";
import type { NetWorthKind } from "../../src/contexts/finance/domain/networth-account";
import { createTestDb, insertUser, type TestDb } from "./harness";

/**
 * Batch reorder of net-worth accounts (issue #80): `reorderAccounts` must be
 * ONE atomic write. This repo's `drizzle-orm/neon-http` has no `transaction()`;
 * `db.batch` is the only atomic unit, and the harness's `withBatchShim`
 * supplies it here (its rollback is pinned by `harness-batch.test.ts` — see
 * that file before trusting any atomicity assertion below).
 *
 * Failure is injected with a temporary CHECK constraint (`sort_order <> 2`):
 * the reorder writes 0..n-1, so the account handed position 2 — deliberately
 * the LAST id in the list — fails after the earlier statements have already
 * run. A sequential (non-batch) implementation leaves the first two accounts
 * with their new sortOrder; the assertion that every row still holds its
 * original value is what catches it. The constraint is dropped in `finally`
 * so it cannot leak into other cases sharing this PGlite instance.
 */
const U = "11111111-1111-1111-1111-111111111111";
const A1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const A2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const A3 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";

/** Red-phase view of the port: optional until `reorderAccounts` exists. */
type ReorderCapable = {
  reorderAccounts?: (userId: string, kind: NetWorthKind, orderedIds: string[]) => Promise<void>;
};

describe("DrizzleNetWorthRepository.reorderAccounts (atomicity)", () => {
  let harness: TestDb;

  beforeAll(async () => {
    harness = await createTestDb();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.resetDb();
    await insertUser(harness.db, U, "u@example.com", "Uma");
    // Original sortOrders 10/20/30 are disjoint from the new 0..2, so "kept
    // its old value" and "got a new value" can never be confused. A2 is
    // archived: archived accounts live in the same ordering space, so the
    // batch must include it too.
    await harness.db.insert(financeNetworthAccount).values([
      { id: A1, userId: U, kind: "asset", name: "股票", sortOrder: 10 },
      { id: A2, userId: U, kind: "asset", name: "現金", sortOrder: 20, archived: true },
      { id: A3, userId: U, kind: "asset", name: "外幣", sortOrder: 30 },
    ]);
  });

  it("批次中一筆寫入失敗時,沒有任何一筆留下新的 sortOrder", async () => {
    const repo = new DrizzleNetWorthRepository(() => harness.db) as DrizzleNetWorthRepository & ReorderCapable;

    await harness.db.execute(
      sql.raw("ALTER TABLE finance_networth_account ADD CONSTRAINT reorder_atomicity_guard CHECK (sort_order <> 2)"),
    );
    try {
      expect(repo.reorderAccounts, "DrizzleNetWorthRepository.reorderAccounts 尚未實作").toBeTypeOf("function");

      // ids order [A3, A1, A2] → sortOrder 0, 1, 2; A2 (position 2) violates
      // the CHECK, so the last statement in the batch is the one that fails.
      await expect(repo.reorderAccounts!(U, "asset", [A3, A1, A2])).rejects.toThrow();

      const rows = await harness.db
        .select({ id: financeNetworthAccount.id, sortOrder: financeNetworthAccount.sortOrder })
        .from(financeNetworthAccount)
        .orderBy(asc(financeNetworthAccount.id));
      expect(Object.fromEntries(rows.map((r) => [r.id, r.sortOrder]))).toEqual({
        [A1]: 10,
        [A2]: 20,
        [A3]: 30,
      });
    } finally {
      await harness.db.execute(sql.raw("ALTER TABLE finance_networth_account DROP CONSTRAINT reorder_atomicity_guard"));
    }
  });
});
