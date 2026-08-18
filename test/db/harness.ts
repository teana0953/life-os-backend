import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql, type SQL } from "drizzle-orm";
import * as schema from "../../src/shared/db/schema";
import type { Db } from "../../src/shared/db/client";

/**
 * A real PostgreSQL engine (PGlite, WASM — no container, no external service)
 * with this repo's own `drizzle/` migrations applied, handed to a repository as
 * the `Db` it expects. Tests built on it execute the repositories' actual SQL,
 * unlike the hand-written fake `Db` used elsewhere, whose `where()` discards
 * its argument.
 *
 * WHAT THIS DOES NOT PROVE — read before assuming coverage:
 *
 * 1. ~~**`drizzle-orm/pglite` has no `batch`.**~~ It does not, but that was
 *    never the same claim as "atomicity cannot be tested here" — PGlite is a
 *    single connection, so `withBatchShim` below supplies one. The atomic
 *    write paths do run here now. See boundary 4 for what the shim is and is
 *    not.
 *
 * 2. **PGlite is not Neon.** Same SQL dialect, different deployment. Anything
 *    at the connection layer — neon-http's lack of transactions, timeouts,
 *    pooling, driver-level error shapes — is out of scope. What is proven is
 *    **SQL semantics**, which is precisely the half that previously had no
 *    evidence at all.
 *
 * 3. **Some tests prove *which rows*, not *what is in them*.** The
 *    `listForUser` cases assert the set of expense ids and nothing else, so
 *    that query's share fan-out, its `namesFor` lookup and its row mapping
 *    are unproven here: returning every expense with empty shares, or with a
 *    wrong `payerDisplayName`, keeps this suite green. The balance tests do
 *    assert whole entries (see the comments in `balances.test.ts`), because
 *    a broken `JOIN users` there is otherwise invisible.
 *
 * 4. **The `batch` shim is not neon-http's `db.batch`.** Production sends the
 *    whole array as one non-interactive HTTP round trip; the shim sends
 *    `BEGIN`, then the statements one at a time over the local connection,
 *    then `COMMIT` (`ROLLBACK` on any failure). What that proves is the
 *    *semantics* the repositories rely on — all the statements land or none
 *    do, and a later statement sees an earlier one's effect, which is what
 *    makes a conditional `INSERT ... WHERE EXISTS` ordered *before* a `DELETE`
 *    behave differently from one ordered after it. It proves nothing about
 *    neon's wire protocol, its statement-count limits, or its error shapes.
 *    The shim's own rollback is pinned by `harness-batch.test.ts`; without
 *    that, every atomicity assertion built on it would pass with no
 *    transaction at all.
 *
 * Isolation strategy (one strategy, used everywhere — do not mix in another):
 * **one PGlite instance per test file** (`createTestDb()` in `beforeAll`,
 * ~1s including migrations), and `resetDb()` before each case. `resetDb`
 * truncates with `CASCADE` in a single statement so the foreign keys between
 * `users` / `expense_group` / `expense_group_member` / `split_expense` /
 * `split_share` / `split_settlement` cannot bite regardless of order.
 *
 * **Cases within a file must run sequentially** — Vitest's default, and a
 * requirement of this strategy, not a preference. All cases in a file share
 * the one instance, so a concurrent peer's `TRUNCATE ... CASCADE` in
 * `beforeEach` deletes the rows another running case is asserting on. Do not
 * enable `test.concurrent` or `sequence.concurrent` for the `db` project
 * (verified: `--sequence.concurrent` fails 12 of 16). Wanting concurrency
 * means moving to a PGlite instance per *case*, not loosening this. Shuffling
 * file or case order is fine — the suite is order-independent.
 */
export type TestDb = {
  /** The repositories' `Db` — pass straight into a `Drizzle*Repository`. */
  db: Db;
  /** Truncate every table these tests touch. Call in `beforeEach`. */
  resetDb: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * The one and only cast in this suite. `drizzle-orm/pglite`'s instance type is
 * nominally different from `drizzle-orm/neon-http`'s (`Db`), but the query
 * builder surface the repositories use (`select`/`insert`/`update`/`delete`/
 * `execute`) is identical. The single thing genuinely missing on the PGlite
 * side is `batch`, which `withBatchShim` adds. Keep this cast here; do not
 * repeat it in test files.
 */
function asDb(pgliteDb: unknown): Db {
  return pgliteDb as Db;
}

/**
 * Gives the PGlite instance the `batch` its driver lacks: `BEGIN`, the
 * statements in the order given, `COMMIT` — and `ROLLBACK` if any of them
 * throws. PGlite is a single connection, so the statements really do share one
 * transaction; nothing here is a simulation of atomicity, it *is* Postgres
 * atomicity.
 *
 * It is not, however, neon-http's `db.batch` — see boundary 4 above. Awaiting
 * a drizzle query builder is what executes it, so the pre-built statements the
 * repositories hand over run here exactly as written, one after another.
 *
 * The `ROLLBACK` is not optional politeness: PGlite would otherwise stay in
 * "current transaction is aborted" and fail every later statement in the file.
 */
function withBatchShim(pgliteDb: { execute: (query: SQL) => Promise<unknown> }): void {
  const target = pgliteDb as { execute: (query: SQL) => Promise<unknown>; batch?: unknown };
  target.batch = async (queries: PromiseLike<unknown>[]): Promise<unknown[]> => {
    await target.execute(sql.raw("BEGIN"));
    try {
      const results: unknown[] = [];
      for (const query of queries) results.push(await query);
      await target.execute(sql.raw("COMMIT"));
      return results;
    } catch (err) {
      await target.execute(sql.raw("ROLLBACK"));
      throw err;
    }
  };
}

// `finance_transaction` is here because a split expense writes the share
// holders' mirrors into it, in the same batch (design.md D15): the upsert, the
// dropped-holder delete, the partial unique index and the cascade all live in
// SQL, so nothing about them can be proven anywhere else. `finance_category`
// follows because a mirror's `category_id` points at it, and truncating one
// without the other would leave rows referencing categories that are gone.
const TABLES = [
  "split_activity",
  "split_settlement",
  "split_share",
  "finance_transaction",
  "finance_installment_plan",
  "split_expense",
  "finance_budget_alert",
  "finance_budget",
  "finance_category",
  // CASCADE also truncates finance_networth_snapshot (FK onDelete: cascade).
  "finance_networth_account",
  "expense_group_member",
  "expense_group",
  // push_delivery added for the delivery-ack test; it FKs both care_occurrence
  // and push_subscription, so both must be truncated with it.
  "push_delivery",
  "push_subscription",
  // care_occurrence/care_log added for replace-cron-with-workflows's claimAttempt
  // PGlite test; CASCADE also handles care_schedule -> care_item.
  "care_occurrence",
  "care_log",
  // care_day_instance_pointer added for fix/restart-instance-tracking's
  // setCurrentIfMatch CAS PGlite test.
  "care_day_instance_pointer",
  "care_schedule",
  "care_item",
  "users",
];

/** Seed helpers. Plain inserts, deliberately not `db.batch` — see limit 1 above. */
export async function insertUser(db: Db, id: string, email: string, displayName: string | null = null): Promise<string> {
  await db.insert(schema.users).values({ id, firebaseUid: `fb-${id}`, email, displayName });
  return id;
}

export async function insertGroup(db: Db, id: string, name: string, createdByUserId: string): Promise<string> {
  await db.insert(schema.expenseGroup).values({ id, name, createdByUserId });
  return id;
}

export async function insertMember(db: Db, groupId: string, userId: string): Promise<void> {
  await db.insert(schema.expenseGroupMember).values({ groupId, userId });
}

export async function insertExpense(
  db: Db,
  input: {
    id: string;
    groupId?: string | null;
    payerUserId: string;
    amount: number;
    currency?: string;
    description?: string;
    day?: string;
    shares: { userId: string; amount: number }[];
  },
): Promise<string> {
  await db.insert(schema.splitExpense).values({
    id: input.id,
    groupId: input.groupId ?? null,
    payerUserId: input.payerUserId,
    // Deliberately NOT the payer. `created_by_user_id` is who recorded the
    // expense and `payer_user_id` is who spent the money — production keeps
    // them apart (one person can record what another paid), but when the
    // fixtures set them equal, swapping one column for the other in any
    // query still returns a non-empty, wrong-person answer that every
    // assertion accepts. Seven such mutations survived until this line.
    createdByUserId: input.shares.find((share) => share.userId !== input.payerUserId)?.userId ?? input.payerUserId,
    amount: input.amount,
    currency: input.currency ?? "TWD",
    description: input.description ?? "test expense",
    day: input.day ?? "2026-03-10",
    splitMode: "exact",
  });
  if (input.shares.length > 0) {
    await db.insert(schema.splitShare).values(input.shares.map((share) => ({ expenseId: input.id, ...share })));
  }
  return input.id;
}

/**
 * A finance category for a share holder, so a mirror has somewhere to land.
 * The mirror tests build their `ShareMirrorRow`s by hand — the application
 * layer's category resolution is exercised at the HTTP layer, and repeating
 * it here would only prove the fixture agrees with itself.
 */
export async function insertCategory(
  db: Db,
  input: { id: string; userId: string; name: string; type?: "expense" | "income"; archived?: boolean },
): Promise<string> {
  await db.insert(schema.financeCategory).values({
    id: input.id,
    userId: input.userId,
    name: input.name,
    type: input.type ?? "expense",
    archived: input.archived ?? false,
  });
  return input.id;
}

export async function insertSettlement(
  db: Db,
  input: { id: string; groupId?: string | null; fromUserId: string; toUserId: string; amount: number; currency?: string; day?: string },
): Promise<string> {
  await db.insert(schema.splitSettlement).values({
    id: input.id,
    groupId: input.groupId ?? null,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    amount: input.amount,
    currency: input.currency ?? "TWD",
    day: input.day ?? "2026-03-11",
    // Same reason as `insertExpense`: recorded by the recipient, not the
    // payer, so the two columns cannot be confused for each other.
    createdByUserId: input.toUserId,
  });
  return input.id;
}

/**
 * `onQuery` observes every SQL statement the drizzle session sends
 * (`drizzle-orm/pglite` funnels through `client.query`). It exists for the
 * statement-count contracts of add-installments (design.md D3b): neon-http's
 * batch statement limit is unknowable, so "the statement count does not grow
 * with the instalment count" is an assertable property, and only here — the
 * in-memory fakes have no statements to count.
 */
export async function createTestDb(options?: { onQuery?: (sql: string) => void }): Promise<TestDb> {
  const client = new PGlite();
  if (options?.onQuery) {
    const onQuery = options.onQuery;
    const originalQuery = client.query.bind(client);
    (client as { query: typeof client.query }).query = async (...args: Parameters<typeof client.query>) => {
      onQuery(String(args[0]));
      return originalQuery(...args);
    };
  }
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  withBatchShim(pgliteDb);
  const db = asDb(pgliteDb);
  return {
    db,
    resetDb: async () => {
      await db.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} CASCADE`));
    },
    close: async () => {
      await client.close();
    },
  };
}
