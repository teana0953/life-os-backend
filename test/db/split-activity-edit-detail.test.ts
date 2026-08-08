import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleSplitActivityRepository } from "../../src/contexts/split/adapters/drizzle-split-activity-repository";
import { DrizzleSplitExpenseRepository } from "../../src/contexts/split/adapters/drizzle-split-expense-repository";
import type { UpdateSplitExpenseFields } from "../../src/contexts/split/domain/split-expense";
import { splitActivity } from "../../src/shared/db/schema";
import { createTestDb, insertUser, type TestDb } from "./harness";

/**
 * What an `expense_updated` entry says an edit did (issue #74).
 *
 * The entry used to carry the amount before and after and nothing else, so
 * every edit that moved anything else — the description, the date, the payer,
 * or **the split itself** — rendered as "someone modified this" with the two
 * amounts identical. That reads as nothing having happened, and it is exactly
 * backwards: a change to the split changes what somebody owes, which is the
 * one thing this timeline exists to surface.
 *
 * Against a real Postgres, because the diff is computed from what the rows
 * held *before* the batch replaced them — a fake would be asked to remember
 * the same thing the code under test is being tested for remembering.
 */
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const E1 = "e1111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-04-01T10:00:00.000Z");

describe("what an expense_updated entry says the edit did (real Postgres)", () => {
  let harness: TestDb;
  let expenses: DrizzleSplitExpenseRepository;

  const baseFields: UpdateSplitExpenseFields = {
    payerUserId: A,
    amount: 900,
    currency: "TWD",
    description: "Hotel",
    day: "2026-03-10",
    splitMode: "exact",
    categoryName: null,
    shares: [
      { userId: A, amount: 300 },
      { userId: B, amount: 600 },
    ],
  };

  beforeAll(async () => {
    harness = await createTestDb();
    expenses = new DrizzleSplitExpenseRepository(() => harness.db);
    // Constructed so the repository is exercised, not just the table.
    void new DrizzleSplitActivityRepository(() => harness.db);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.resetDb();
    await insertUser(harness.db, A, "a@example.com", "Ann");
    await insertUser(harness.db, B, "b@example.com", "Ben");
    await insertUser(harness.db, C, "c@example.com", "Cid");
    await expenses.create(
      {
        id: E1,
        groupId: null,
        payerUserId: A,
        createdByUserId: A,
        amount: 900,
        currency: "TWD",
        description: "Hotel",
        day: "2026-03-10",
        splitMode: "exact",
        categoryName: null,
        shares: [
          { userId: A, amount: 300 },
          { userId: B, amount: 600 },
        ],
      },
      [],
    );
  });

  /** The one `expense_updated` row the edit under test wrote. */
  async function editEntry() {
    const rows = await harness.db.select().from(splitActivity).where(eq(splitActivity.type, "expense_updated"));
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function edit(overrides: Partial<UpdateSplitExpenseFields>) {
    await expenses.update(E1, { ...baseFields, ...overrides }, [], NOW, A);
  }

  it("names the participant dropped from the split, by the name they had", async () => {
    // The person an edit can hurt most: their balance just moved and nobody
    // told them. They are already in the audience (PR #72); what was missing
    // was any content saying what happened to them.
    await edit({ shares: [{ userId: A, amount: 900 }] });

    const entry = await editEntry();
    expect(entry.removedDisplayNames).toEqual(["Ben"]);
    expect(entry.addedDisplayNames).toEqual([]);
    expect(entry.changedFields).toEqual(["shares"]);
  });

  it("names the participant added to the split", async () => {
    await edit({
      shares: [
        { userId: A, amount: 300 },
        { userId: B, amount: 300 },
        { userId: C, amount: 300 },
      ],
    });

    const entry = await editEntry();
    expect(entry.addedDisplayNames).toEqual(["Cid"]);
    expect(entry.removedDisplayNames).toEqual([]);
  });

  it("reports a reshuffle between the same people, which moves balances too", async () => {
    // Nobody joined and nobody left, and the total is unchanged — but A now
    // owes 600 where they owed 300. Reading the participant sets alone, this
    // edit is invisible.
    await edit({
      shares: [
        { userId: A, amount: 600 },
        { userId: B, amount: 300 },
      ],
    });

    const entry = await editEntry();
    expect(entry.changedFields).toEqual(["shares"]);
    expect(entry.addedDisplayNames).toEqual([]);
    expect(entry.removedDisplayNames).toEqual([]);
  });

  it("reports the plain fields, each on its own", async () => {
    // One at a time, because a diff that reports "something changed" for any
    // edit is the entry this issue is about. Each case must name its own
    // field and no other.
    const cases: Array<[string, Partial<UpdateSplitExpenseFields>]> = [
      ["description", { description: "Hotel, two nights" }],
      ["day", { day: "2026-03-11" }],
      ["payer", { payerUserId: B }],
      ["currency", { currency: "JPY" }],
    ];
    for (const [field, override] of cases) {
      await harness.db.delete(splitActivity).where(eq(splitActivity.type, "expense_updated"));
      await edit(override);
      expect((await editEntry()).changedFields, field).toEqual([field]);
      // Put it back, so the next case is a diff against the original.
      await harness.db.delete(splitActivity).where(eq(splitActivity.type, "expense_updated"));
      await edit({});
      await harness.db.delete(splitActivity).where(eq(splitActivity.type, "expense_updated"));
    }
  });

  it("reports the amount alongside the split it came from", async () => {
    await edit({
      amount: 1000,
      shares: [
        { userId: A, amount: 400 },
        { userId: B, amount: 600 },
      ],
    });

    const entry = await editEntry();
    expect([...entry.changedFields!].sort()).toEqual(["amount", "shares"]);
    // The pair the reader compares stays what it was.
    expect(entry.previousAmount).toBe(900);
    expect(entry.amount).toBe(1000);
  });

  it("says an edit changed nothing, rather than leaving it unsaid", async () => {
    // A client re-sending the same values is an ordinary event (`PUT` is a
    // whole replace). An empty list is a real answer; null would mean "not an
    // edit entry" and no answer at all is how this issue started.
    await edit({});

    const entry = await editEntry();
    expect(entry.changedFields).toEqual([]);
  });

  it("carries no edit detail on entries that are not edits", async () => {
    const rows = await harness.db.select().from(splitActivity).where(eq(splitActivity.type, "expense_created"));

    expect(rows[0]?.changedFields).toBeNull();
    expect(rows[0]?.addedDisplayNames).toBeNull();
    expect(rows[0]?.removedDisplayNames).toBeNull();
  });

  it("the database refuses a field name outside the vocabulary", async () => {
    // A typo'd field name is a change the reader is never told about: it
    // writes happily and renders as a blank line.
    await expect(
      harness.db.insert(splitActivity).values({
        type: "expense_updated",
        actorUserId: A,
        subjectId: E1,
        audienceUserIds: [A],
        changedFields: ["descriptoin"],
        createdAt: NOW,
      }),
    ).rejects.toThrow();
  });

  it("the database refuses edit detail on a settlement entry", async () => {
    await expect(
      harness.db.insert(splitActivity).values({
        type: "settlement_created",
        actorUserId: A,
        subjectId: E1,
        audienceUserIds: [A],
        actorIsPayer: true,
        changedFields: ["amount"],
        createdAt: NOW,
      }),
    ).rejects.toThrow();
  });

  it("works the same for a grouped expense, whose previous shares nobody used to read", async () => {
    // The previous-share read was skipped for grouped expenses, because only
    // a groupless entry freezes an audience. A split diff needs it either
    // way, and "it happened to be a groupless fixture" is how that would have
    // gone unnoticed.
    const groupId = "9a000000-0000-0000-0000-00000000000a";
    const E2 = "e2222222-2222-2222-2222-222222222222";
    // A group row with A as its creator; membership is not what this asserts.
    await harness.db.execute(sql`
      INSERT INTO expense_group (id, name, created_by_user_id) VALUES (${groupId}::uuid, 'Trip', ${A}::uuid)
    `);
    await expenses.create(
      {
        id: E2,
        groupId,
        payerUserId: A,
        createdByUserId: A,
        amount: 900,
        currency: "TWD",
        description: "Hotel",
        day: "2026-03-10",
        splitMode: "exact",
        categoryName: null,
        shares: [
          { userId: A, amount: 300 },
          { userId: B, amount: 600 },
        ],
      },
      [],
    );
    await expenses.update(
      E2,
      { ...baseFields, shares: [{ userId: A, amount: 900 }] },
      [],
      NOW,
      A,
    );

    const rows = await harness.db.select().from(splitActivity).where(eq(splitActivity.subjectId, E2));
    const entry = rows.find((row) => row.type === "expense_updated");
    expect(entry?.removedDisplayNames).toEqual(["Ben"]);
    expect(entry?.changedFields).toEqual(["shares"]);
  });
});
