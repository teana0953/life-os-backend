import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { DrizzleFinanceTransactionRepository } from "../../src/contexts/finance/adapters/drizzle-finance-transaction-repository";
import { DrizzleSplitExpenseRepository } from "../../src/contexts/split/adapters/drizzle-split-expense-repository";
import type { ShareMirrorRow } from "../../src/contexts/split/domain/shares-mirror";
import type { CreateSplitExpenseInput, UpdateSplitExpenseFields } from "../../src/contexts/split/domain/split-expense";
import { financeTransaction, splitActivity, splitExpense, splitShare } from "../../src/shared/db/schema";
import { createTestDb, insertCategory, insertGroup, insertMember, insertUser, type TestDb } from "./harness";

/**
 * The writes that keep a share holder's mirrored transaction in step with the
 * split, against a real Postgres. Every one of them lives in SQL — the
 * `ON CONFLICT ... DO UPDATE` with a `CASE` in its SET list, the set-based
 * delete of a dropped participant, the partial unique index, the foreign key's
 * cascade — so a test driven through `InMemorySplitExpenseRepository` would
 * only ever prove that fake agrees with itself (design.md D5/D6, tasks 4.3).
 *
 * **The mirror rows here are built by hand, not by `FinanceSharesMirror`.**
 * Which category a mirror lands on is an application-layer decision guarded at
 * the HTTP layer against the real resolver; what is under test here is what
 * the SQL does with the rows once it has them.
 *
 * **The injectable failure point is `MISSING_CATEGORY`** (tasks 11.3): a
 * planned mirror pointing at a category id that does not exist makes exactly
 * one statement of the batch fail on a foreign key, and nothing else. Without
 * it the atomicity cases could not be written at all — the resolution runs
 * before the batch and against real rows, and PGlite's single connection
 * leaves nothing that could delete a category mid-write.
 */
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const G = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const E1 = "e1111111-1111-1111-1111-111111111111";
const E2 = "e2222222-2222-2222-2222-222222222222";
const FOOD_A = "ca000001-0000-0000-0000-000000000000";
const FOOD_B = "cb000001-0000-0000-0000-000000000000";
const FUN_B = "cb000002-0000-0000-0000-000000000000";
const FOOD_C = "cc000001-0000-0000-0000-000000000000";
const MISSING_CATEGORY = "c0000000-dead-4000-8000-000000000000";
const DAY = "2026-04-10";
const NOW = new Date("2026-04-10T10:00:00.000Z");

/**
 * `note` is a parameter, and the cases that care about it pass a *different*
 * one on the second write. With every planned note equal to the stored one,
 * adding `note: excluded.note` to the upsert's SET list would be invisible —
 * the two rows would be indistinguishable and the D18 guard unfalsifiable.
 */
function mirror(userId: string, categoryId: string, amount: number, splitExpenseId = E1, note = "dinner"): ShareMirrorRow {
  return { userId, splitExpenseId, amount, currency: "TWD", categoryId, day: DAY, note };
}

function createInput(overrides: Partial<CreateSplitExpenseInput> = {}): CreateSplitExpenseInput {
  return {
    id: E1,
    groupId: null,
    payerUserId: A,
    createdByUserId: A,
    amount: 1800,
    currency: "TWD",
    description: "dinner",
    day: DAY,
    splitMode: "equal",
    categoryName: "餐飲",
    shares: [
      { userId: A, amount: 900 },
      { userId: B, amount: 900 },
    ],
    ...overrides,
  };
}

function updateFields(overrides: Partial<UpdateSplitExpenseFields> = {}): UpdateSplitExpenseFields {
  return {
    payerUserId: A,
    amount: 1800,
    currency: "TWD",
    description: "dinner",
    day: DAY,
    splitMode: "equal",
    categoryName: "餐飲",
    shares: [
      { userId: A, amount: 900 },
      { userId: B, amount: 900 },
    ],
    ...overrides,
  };
}

describe("split expense mirrors (real Postgres)", () => {
  let harness: TestDb;
  let expenses: DrizzleSplitExpenseRepository;

  beforeAll(async () => {
    harness = await createTestDb();
    expenses = new DrizzleSplitExpenseRepository(() => harness.db);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.resetDb();
    await insertUser(harness.db, A, "a@example.com", "Ann");
    await insertUser(harness.db, B, "b@example.com", "Ben");
    await insertUser(harness.db, C, "c@example.com", "Cid");
    await insertCategory(harness.db, { id: FOOD_A, userId: A, name: "餐飲" });
    await insertCategory(harness.db, { id: FOOD_B, userId: B, name: "餐飲" });
    await insertCategory(harness.db, { id: FUN_B, userId: B, name: "娛樂" });
    await insertCategory(harness.db, { id: FOOD_C, userId: C, name: "餐飲" });
  });

  const mirrorsOf = (userId: string) =>
    harness.db.select().from(financeTransaction).where(eq(financeTransaction.userId, userId));

  async function mirrorFor(userId: string, splitExpenseId: string) {
    const [row] = await harness.db
      .select()
      .from(financeTransaction)
      .where(and(eq(financeTransaction.userId, userId), eq(financeTransaction.splitExpenseId, splitExpenseId)));
    return row;
  }

  describe("an edit updates a mirror in place", () => {
    it("keeps a category the holder chose while the amount follows the split (4.4)", async () => {
      await expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)]);

      // The holder recategorises their own copy. Written straight to the
      // column here on purpose: what the finance `PUT` handler does with
      // `category_source` is its own guard at the HTTP layer, and driving it
      // from here would make this case depend on a route it is not about.
      await harness.db
        .update(financeTransaction)
        .set({ categoryId: FUN_B, categorySource: "manual" })
        .where(and(eq(financeTransaction.userId, B), eq(financeTransaction.splitExpenseId, E1)));

      await expenses.update(
        E1,
        updateFields({ amount: 2400, shares: [{ userId: A, amount: 1200 }, { userId: B, amount: 1200 }] }),
        [mirror(A, FOOD_A, 1200), mirror(B, FOOD_B, 1200)],
        NOW,
        A,
      );

      const row = await mirrorFor(B, E1);
      // Both halves are load-bearing. Without the amount, "update nothing at
      // all" passes; without the category, overwriting it unconditionally does.
      expect(row?.categoryId).toBe(FUN_B);
      expect(row?.amount).toBe(1200);
    });

    it("keeps that category through a second edit, not just the first", async () => {
      // `ON CONFLICT DO UPDATE` evaluates every SET expression against the
      // *old* row, so a SET list that also wrote `category_source = 'mirror'`
      // would still keep the category on this edit — the `CASE` reads the
      // stored `'manual'` — and only lose it on the next one. Every other case
      // here edits once, so that mutation survives all of them: the second
      // edit is the whole point of this fixture.
      await expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)]);
      await harness.db
        .update(financeTransaction)
        .set({ categoryId: FUN_B, categorySource: "manual" })
        .where(and(eq(financeTransaction.userId, B), eq(financeTransaction.splitExpenseId, E1)));

      await expenses.update(
        E1,
        updateFields({ amount: 2400, shares: [{ userId: A, amount: 1200 }, { userId: B, amount: 1200 }] }),
        [mirror(A, FOOD_A, 1200), mirror(B, FOOD_B, 1200)],
        NOW,
        A,
      );
      await expenses.update(
        E1,
        updateFields({ amount: 3000, shares: [{ userId: A, amount: 1500 }, { userId: B, amount: 1500 }] }),
        [mirror(A, FOOD_A, 1500), mirror(B, FOOD_B, 1500)],
        NOW,
        A,
      );

      const row = await mirrorFor(B, E1);
      expect(row?.categoryId).toBe(FUN_B);
      // The flag itself has to survive too, or the row is only one more edit
      // away from losing the category anyway.
      expect(row?.categorySource).toBe("manual");
      // Same reason as the single-edit case: without this, "update nothing"
      // would pass.
      expect(row?.amount).toBe(1500);
    });

    it("leaves a note the holder wrote alone while the split's description moves on", async () => {
      // D18: `note` is written once at creation and belongs to the owner
      // afterwards, which is what makes it absent from the upsert's SET list.
      // The planned note here is deliberately *not* the stored one — with the
      // two equal, `note: excluded.note` would be a no-op and the rule would
      // have no guard at all.
      await expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)]);
      await harness.db
        .update(financeTransaction)
        .set({ note: "my half of Ben's birthday" })
        .where(and(eq(financeTransaction.userId, B), eq(financeTransaction.splitExpenseId, E1)));

      await expenses.update(
        E1,
        updateFields({ amount: 2400, description: "brunch", shares: [{ userId: A, amount: 1200 }, { userId: B, amount: 1200 }] }),
        [mirror(A, FOOD_A, 1200, E1, "brunch"), mirror(B, FOOD_B, 1200, E1, "brunch")],
        NOW,
        A,
      );

      const row = await mirrorFor(B, E1);
      expect(row?.note).toBe("my half of Ben's birthday");
      // The rest of the row still follows the split — the note is frozen, not
      // the row.
      expect(row?.amount).toBe(1200);
    });

    it("hands back the stored category, not the planned one", async () => {
      // What the caller runs the share holders' budget-alert checks on. The
      // planned row says 餐飲 and the stored row is in 娛樂, so a `create`/
      // `update` that echoed its argument back would have the check look at a
      // budget the money is not in, and never at the one it is (D6/D19). Only
      // the statement's own `RETURNING` can tell the two apart.
      await expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)]);
      await harness.db
        .update(financeTransaction)
        .set({ categoryId: FUN_B, categorySource: "manual" })
        .where(and(eq(financeTransaction.userId, B), eq(financeTransaction.splitExpenseId, E1)));

      const written = await expenses.update(
        E1,
        updateFields({ amount: 2400, shares: [{ userId: A, amount: 1200 }, { userId: B, amount: 1200 }] }),
        [mirror(A, FOOD_A, 1200), mirror(B, FOOD_B, 1200)],
        NOW,
        A,
      );

      const forB = written?.mirrors.find((row) => row.userId === B);
      expect(forB).toEqual({ userId: B, splitExpenseId: E1, amount: 1200, currency: "TWD", categoryId: FUN_B, day: DAY, note: "dinner" });
      // A never touched theirs, so for them the two agree — which is what
      // makes B's row above the difference and not a blanket mismatch.
      expect(written?.mirrors.find((row) => row.userId === A)?.categoryId).toBe(FOOD_A);
    });

    it("keeps exactly one mirror per holder when the same expense is edited twice", async () => {
      // The partial unique index is what stops a second row appearing, and the
      // upsert is what makes it enforceable: written as a plain insert the
      // second write collides instead of updating. Narrowing the index and the
      // `ON CONFLICT` target together is *not* the mutation for this case —
      // one row per (user, split) survives it — that one is caught by "leaves
      // the other split's mirror alone" above.
      await expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)]);

      await expenses.update(
        E1,
        updateFields({ amount: 2400, shares: [{ userId: A, amount: 1200 }, { userId: B, amount: 1200 }] }),
        [mirror(A, FOOD_A, 1200), mirror(B, FOOD_B, 1200)],
        NOW,
        A,
      );
      await expenses.update(
        E1,
        updateFields({ amount: 3000, shares: [{ userId: A, amount: 1500 }, { userId: B, amount: 1500 }] }),
        [mirror(A, FOOD_A, 1500), mirror(B, FOOD_B, 1500)],
        NOW,
        A,
      );

      expect(await mirrorsOf(A)).toHaveLength(1);
      expect(await mirrorsOf(B)).toHaveLength(1);
      // The surviving row is the updated one, not a stale first write.
      expect((await mirrorFor(B, E1))?.amount).toBe(1500);
    });

    it("removes the mirror of a participant who no longer holds a share, with no group (5.5)", async () => {
      // The groupless twin of the grouped case below. Here the adapter *does*
      // load the previous share holders (for the activity audience), so this
      // one would still pass if the delete were driven off that list — which
      // is why the grouped fixture exists too, and why neither replaces the
      // other.
      await expenses.create(
        createInput({ shares: [{ userId: A, amount: 600 }, { userId: B, amount: 600 }, { userId: C, amount: 600 }] }),
        [mirror(A, FOOD_A, 600), mirror(B, FOOD_B, 600), mirror(C, FOOD_C, 600)],
      );

      await expenses.update(
        E1,
        updateFields({ shares: [{ userId: A, amount: 900 }, { userId: B, amount: 900 }] }),
        [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)],
        NOW,
        A,
      );

      expect(await mirrorsOf(C)).toHaveLength(0);
      expect(await mirrorsOf(A)).toHaveLength(1);
      expect(await mirrorsOf(B)).toHaveLength(1);
    });

    it("moves an untouched mirror onto the split's new category (4.6)", async () => {
      // The other direction of the same rule: the mirror write must really
      // set `category_source = 'mirror'`. Left to the column's `'manual'`
      // default the `CASE` would never fire again, and every "a hand-picked
      // category survives" assertion would keep passing while no mirror
      // followed its split any more.
      await expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)]);

      await expenses.update(E1, updateFields({ categoryName: "娛樂" }), [mirror(A, FOOD_A, 900), mirror(B, FUN_B, 900)], NOW, A);

      expect((await mirrorFor(B, E1))?.categoryId).toBe(FUN_B);
    });

    it("leaves the other split's mirror alone (5.3)", async () => {
      // Narrowing the unique index and the `ON CONFLICT` target together to
      // `(user_id)` is the mutation this exists for: B's second mirror would
      // then collide with their first, and an edit would update the wrong
      // split's row. Two separate expenses in the same month is the smallest
      // fixture where that is visible.
      await expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)]);
      await expenses.create(createInput({ id: E2, amount: 600, shares: [{ userId: A, amount: 300 }, { userId: B, amount: 300 }] }), [
        mirror(A, FOOD_A, 300, E2),
        mirror(B, FOOD_B, 300, E2),
      ]);

      await expenses.update(
        E1,
        updateFields({ amount: 2400, shares: [{ userId: A, amount: 1200 }, { userId: B, amount: 1200 }] }),
        [mirror(A, FOOD_A, 1200), mirror(B, FOOD_B, 1200)],
        NOW,
        A,
      );

      expect(await mirrorsOf(B)).toHaveLength(2);
      expect((await mirrorFor(B, E1))?.amount).toBe(1200);
      expect((await mirrorFor(B, E2))?.amount).toBe(300);
    });

    it("removes the mirror of a participant who no longer holds a share, in a group (5.5)", async () => {
      // Grouped on purpose: the adapter deliberately never reads a grouped
      // expense's previous share holders, so the delete has to be set-based.
      // A groupless fixture would pass even if it were written from the
      // "before" list that only a groupless expense loads.
      await insertGroup(harness.db, G, "Trip", A);
      await insertMember(harness.db, G, A);
      await insertMember(harness.db, G, B);
      await insertMember(harness.db, G, C);
      await expenses.create(
        createInput({ groupId: G, shares: [{ userId: A, amount: 600 }, { userId: B, amount: 600 }, { userId: C, amount: 600 }] }),
        [mirror(A, FOOD_A, 600), mirror(B, FOOD_B, 600), mirror(C, FOOD_C, 600)],
      );

      await expenses.update(
        E1,
        updateFields({ shares: [{ userId: A, amount: 900 }, { userId: B, amount: 900 }] }),
        [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)],
        NOW,
        A,
      );

      expect(await mirrorsOf(C)).toHaveLength(0);
      expect(await mirrorsOf(A)).toHaveLength(1);
      expect(await mirrorsOf(B)).toHaveLength(1);
    });
  });

  describe("a guarded update of a mirror", () => {
    // The SQL half of D7's race guard. The in-memory repository the HTTP and
    // application cases run on applies the same condition in JavaScript, so it
    // can only ever agree with itself; whether the predicate is really in the
    // statement's WHERE is a question only a database answers.
    const transactions = () => new DrizzleFinanceTransactionRepository(() => harness.db);

    async function seedMirrorRow() {
      await expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)]);
      const row = await mirrorFor(B, E1);
      if (!row) throw new Error("no mirror for B");
      return row;
    }

    it("writes nothing when the split has already moved past the values the caller compared", async () => {
      const row = await seedMirrorRow();
      // The payer's edit commits: B's share is 1200 now, not the 900 the
      // caller read a moment ago.
      await expenses.update(
        E1,
        updateFields({ amount: 2400, shares: [{ userId: A, amount: 1200 }, { userId: B, amount: 1200 }] }),
        [mirror(A, FOOD_A, 1200), mirror(B, FOOD_B, 1200)],
        NOW,
        A,
      );

      const written = await transactions().update(
        B,
        row.id,
        { type: "expense", amount: 900, currency: "TWD", categoryId: FUN_B, date: DAY, categorySource: "manual" },
        { type: "expense", amount: 900, currency: "TWD", date: DAY },
      );

      expect(written).toBeNull();
      const after = await mirrorFor(B, E1);
      expect(after?.amount).toBe(1200);
      expect(after?.categoryId).toBe(FOOD_B);
    });

    it("writes when the row still holds those values", async () => {
      // Without this, a predicate that never matches would pass the case
      // above and recategorising a mirror would be impossible.
      const row = await seedMirrorRow();

      const written = await transactions().update(
        B,
        row.id,
        { type: "expense", amount: 900, currency: "TWD", categoryId: FUN_B, date: DAY, categorySource: "manual" },
        { type: "expense", amount: 900, currency: "TWD", date: DAY },
      );

      expect(written).toMatchObject({ amount: 900, categoryId: FUN_B, categorySource: "manual" });
    });
  });

  describe("the mirrors share the expense's fate", () => {
    it("leaves no expense, share or activity row behind when a mirror fails (11.4)", async () => {
      await expect(expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, MISSING_CATEGORY, 900)])).rejects.toThrow();

      // The mutation this is for is "write the mirrors after the batch with a
      // second await": the batch would commit, the mirror insert would fail on
      // its own, and the expense below would still be here — a split whose
      // mirrors disagree with it, permanently, with nothing to detect it.
      expect(await harness.db.select().from(splitExpense)).toHaveLength(0);
      expect(await harness.db.select().from(splitShare)).toHaveLength(0);
      expect(await harness.db.select().from(splitActivity)).toHaveLength(0);
      expect(await harness.db.select().from(financeTransaction)).toHaveLength(0);
    });

    it("leaves the expense at its old amount when an edit's mirror fails", async () => {
      await expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)]);

      await expect(
        expenses.update(
          E1,
          updateFields({ amount: 2400, shares: [{ userId: A, amount: 1200 }, { userId: B, amount: 1200 }] }),
          [mirror(A, FOOD_A, 1200), mirror(B, MISSING_CATEGORY, 1200)],
          NOW,
          A,
        ),
      ).rejects.toThrow();

      const [row] = await harness.db.select().from(splitExpense).where(eq(splitExpense.id, E1));
      expect(row?.amount).toBe(1800);
      expect((await mirrorFor(A, E1))?.amount).toBe(900);
    });

    it("takes the mirrors with the expense and touches nothing else of the holder's", async () => {
      await expenses.create(createInput(), [mirror(A, FOOD_A, 900), mirror(B, FOOD_B, 900)]);
      // An ordinary transaction of B's, in the same month and category: the
      // cascade is scoped by `split_expense_id`, not by owner.
      await harness.db.insert(financeTransaction).values({ userId: B, type: "expense", amount: 50, currency: "TWD", categoryId: FOOD_B, day: DAY });

      expect(await expenses.delete(E1, A, NOW)).toBe(true);

      const remaining = await mirrorsOf(B);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.splitExpenseId).toBeNull();
    });
  });
});
