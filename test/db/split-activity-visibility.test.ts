import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleExpenseGroupRepository } from "../../src/contexts/split/adapters/drizzle-expense-group-repository";
import { DrizzleSettlementRepository } from "../../src/contexts/split/adapters/drizzle-settlement-repository";
import { DrizzleSplitActivityRepository } from "../../src/contexts/split/adapters/drizzle-split-activity-repository";
import { DrizzleSplitExpenseRepository } from "../../src/contexts/split/adapters/drizzle-split-expense-repository";
import { createTestDb, insertUser, type TestDb } from "./harness";

/**
 * Who may see which activity entry, executed against a real Postgres.
 *
 * **A wrong answer here hands one person another person's amounts and
 * descriptions.** That is worse than a wrong balance: a wrong number is wrong,
 * a wrong audience is a leak. So the world below is built deliberately against
 * the mutations that survived in this repo's earlier balance tests, where every
 * fixture had one group and one currency:
 *
 *   - **Two groups with different members.** C belongs to G1 only, D to G2
 *     only, A to both. A predicate that widened from "this group" to "any group
 *     the viewer belongs to" would hand C the G2 entries.
 *   - **Two currencies** (TWD, JPY), so nothing can be pinned to one.
 *   - **Four people in different roles**: actor, payer, share holder and
 *     stake-free group member are different people in different entries, so
 *     swapping one column for another still gives a wrong answer somewhere.
 *   - **Someone edited out of an expense** (B) and **someone edited into it**
 *     (C), so the pre-and-post union equals neither side on its own.
 *
 * The world is built by calling the real repositories rather than inserting
 * activity rows by hand: hand-written fixtures would prove the SELECT against
 * rows the INSERTs never actually produce.
 *
 * World (rebuilt before each case):
 *   users A, B, C, D
 *   G1 "Trip" created by A; B then C added by A               -> A, B, C
 *   G2 "Duo"  created by D; A added by D                      -> D, A
 *   EG  in G1, payer B, 900 TWD, shares A/B/C 300, recorded by C
 *   SG  in G2, A pays D 500 JPY, recorded by D
 *   EP  groupless, payer A, 300 TWD, share B 300, recorded by A
 *         then edited by A: the share becomes C's instead of B's
 *   EQ  groupless, payer B, 400 TWD, share C 400, recorded by B
 *         then deleted by B
 *   SP  groupless, C pays D 200 JPY, recorded by C
 *         then deleted by C
 *   G2 archived by D
 */
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const D = "44444444-4444-4444-4444-444444444444";
const EG = "e0000000-0000-0000-0000-00000000000e";
const EP = "e1111111-1111-1111-1111-111111111111";
const EQ = "e2222222-2222-2222-2222-222222222222";
const SG = "50000000-0000-0000-0000-000000000005";
const SP = "51111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-04-01T10:00:00.000Z");

describe("DrizzleSplitActivityRepository.listForUser visibility (real Postgres)", () => {
  let harness: TestDb;
  let activity: DrizzleSplitActivityRepository;
  let groupIds: { g1: string; g2: string };

  beforeAll(async () => {
    harness = await createTestDb();
    activity = new DrizzleSplitActivityRepository(() => harness.db);
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * What `userId` sees, as sorted `<type>:<subject>` labels. The subject is
   * named, not just counted: "sees an entry of the right kind about the wrong
   * expense" must not pass.
   */
  async function seenBy(userId: string): Promise<string[]> {
    const names = new Map([
      [groupIds.g1, "G1"],
      [groupIds.g2, "G2"],
      [EG, "EG"],
      [EP, "EP"],
      [EQ, "EQ"],
      [SG, "SG"],
      [SP, "SP"],
    ]);
    const entries = await activity.listForUser(userId, { limit: 100 });
    return entries.map((entry) => `${entry.type}:${names.get(entry.subjectId ?? "") ?? entry.subjectId}`).sort();
  }

  beforeEach(async () => {
    await harness.resetDb();
    const db = harness.db;
    const expenses = new DrizzleSplitExpenseRepository(() => db);
    const settlements = new DrizzleSettlementRepository(() => db);
    const groups = new DrizzleExpenseGroupRepository(() => db);

    await insertUser(db, A, "a@example.com", "Ann");
    await insertUser(db, B, "b@example.com", "Ben");
    await insertUser(db, C, "c@example.com", "Cid");
    // No display name: `splitDisplayName` falls back to the email, and the
    // name columns are asserted below, so a join that returns the wrong user
    // cannot hide behind everyone having a name.
    await insertUser(db, D, "dee@example.com", null);

    const g1 = await groups.create({ name: "Trip", createdByUserId: A });
    const g2 = await groups.create({ name: "Duo", createdByUserId: D });
    groupIds = { g1: g1.id, g2: g2.id };

    await groups.addMember(g1.id, B, NOW, A);
    await groups.addMember(g1.id, C, NOW, A);
    await groups.addMember(g2.id, A, NOW, D);

    await expenses.create({
      id: EG,
      groupId: g1.id,
      payerUserId: B,
      createdByUserId: C,
      amount: 900,
      currency: "TWD",
      description: "Hotel",
      day: "2026-03-10",
      splitMode: "exact",
      categoryName: null,
      shares: [
        { userId: A, amount: 300 },
        { userId: B, amount: 300 },
        { userId: C, amount: 300 },
      ],
    }, []);
    await settlements.create({ id: SG, groupId: g2.id, fromUserId: A, toUserId: D, amount: 500, currency: "JPY", day: "2026-03-11", note: null, createdByUserId: D });

    await expenses.create({
      id: EP,
      groupId: null,
      payerUserId: A,
      createdByUserId: A,
      amount: 300,
      currency: "TWD",
      description: "Dinner",
      day: "2026-03-12",
      splitMode: "exact",
      categoryName: null,
      shares: [{ userId: B, amount: 300 }],
    }, []);
    await expenses.update(
      EP,
      { payerUserId: A, amount: 300, currency: "TWD", description: "Dinner", day: "2026-03-12", splitMode: "exact", categoryName: null, shares: [{ userId: C, amount: 300 }] },
      [],
      NOW,
      A,
    );

    await expenses.create({
      id: EQ,
      groupId: null,
      payerUserId: B,
      createdByUserId: B,
      amount: 400,
      currency: "TWD",
      description: "Taxi",
      day: "2026-03-13",
      splitMode: "exact",
      categoryName: null,
      shares: [{ userId: C, amount: 400 }],
    }, []);
    await expenses.delete(EQ, B, NOW);

    await settlements.create({ id: SP, groupId: null, fromUserId: C, toUserId: D, amount: 200, currency: "JPY", day: "2026-03-14", note: null, createdByUserId: C });
    await settlements.delete(SP, C, NOW);

    await groups.archive(g2.id, NOW, D);
  });

  it("shows a group's members its expenses and settlements, and nothing from the other group", async () => {
    // B is in G1 only. Every G2 label absent is the load-bearing half: a
    // predicate that checked "is a member of some group" instead of "is a
    // member of *this* group" returns a non-empty, wrong answer here.
    expect(await seenBy(B)).toEqual(
      [
        "group_created:G1",
        "group_member_added:G1",
        "group_member_added:G1",
        "expense_created:EG",
        "expense_created:EP",
        "expense_updated:EP",
        "expense_created:EQ",
        "expense_deleted:EQ",
      ].sort(),
    );
  });

  it("shows a member who joined later the group's earlier activity", async () => {
    // A was added to G2 *after* D created it, and still sees its creation —
    // the same way A can already see expenses recorded in G2 before joining.
    // This is what the live-membership half of the rule buys, and freezing a
    // group audience at write time would take it away.
    const seen = await seenBy(A);
    expect(seen).toContain("group_created:G2");
    expect(seen).toContain("group_member_added:G2");
    expect(seen).toContain("settlement_created:SG");
    expect(seen).toContain("group_archived:G2");
  });

  it("keeps a groupless expense between its participants", async () => {
    // EP was recorded between A and B. C was not in it at the time and D never
    // was, so neither may see its creation — even though C was edited into it
    // afterwards, and even though A and C share G1.
    expect(await seenBy(C)).not.toContain("expense_created:EP");
    expect(await seenBy(D)).not.toContain("expense_created:EP");
    expect(await seenBy(A)).toContain("expense_created:EP");
    expect(await seenBy(B)).toContain("expense_created:EP");
  });

  it("tells both the person edited out of an expense and the one edited in", async () => {
    // B lost their share and C gained one. B is the case that matters: their
    // balance changed, they are no longer anywhere in the expense, and the
    // frozen pre-and-post union is the only thing that can still reach them.
    const seenByB = await seenBy(B);
    const seenByC = await seenBy(C);
    expect(seenByB).toContain("expense_updated:EP");
    expect(seenByC).toContain("expense_updated:EP");
    expect(await seenBy(D)).not.toContain("expense_updated:EP");
  });

  it("still reaches the participants of a deleted groupless expense", async () => {
    // EQ and its shares are gone; nothing live says B and C were in it. If the
    // audience had not been frozen at write time this entry would be
    // unreachable — which is the case the whole feature exists for.
    expect(await seenBy(B)).toContain("expense_deleted:EQ");
    expect(await seenBy(C)).toContain("expense_deleted:EQ");
    expect(await seenBy(A)).not.toContain("expense_deleted:EQ");
    expect(await seenBy(D)).not.toContain("expense_deleted:EQ");
  });

  it("still reaches both parties to a deleted groupless settlement", async () => {
    expect(await seenBy(C)).toContain("settlement_deleted:SP");
    expect(await seenBy(D)).toContain("settlement_deleted:SP");
    expect(await seenBy(A)).not.toContain("settlement_deleted:SP");
    expect(await seenBy(B)).not.toContain("settlement_deleted:SP");
  });

  it("shows a non-participant nothing about any of it", async () => {
    // D shares no group with B or C and is in none of their expenses. This is
    // the leak guard: it is not a feature test, and it is the one case that
    // must fail loudly if any predicate is widened.
    expect(await seenBy(D)).toEqual(
      ["group_created:G2", "group_member_added:G2", "settlement_created:SG", "group_archived:G2", "settlement_created:SP", "settlement_deleted:SP"].sort(),
    );
  });

  it("gives every one of the four people a different, exact set", async () => {
    // All eight event types appear across these four sets, and no two sets are
    // equal — so a predicate collapsed to a constant, to "everyone", or to
    // "nobody" cannot satisfy them all.
    expect(await seenBy(A)).toEqual(
      [
        "group_created:G1",
        "group_member_added:G1",
        "group_member_added:G1",
        "group_created:G2",
        "group_member_added:G2",
        "expense_created:EG",
        "settlement_created:SG",
        "expense_created:EP",
        "expense_updated:EP",
        "group_archived:G2",
      ].sort(),
    );
    expect(await seenBy(C)).toEqual(
      [
        "group_created:G1",
        "group_member_added:G1",
        "group_member_added:G1",
        "expense_created:EG",
        "expense_updated:EP",
        "expense_created:EQ",
        "expense_deleted:EQ",
        "settlement_created:SP",
        "settlement_deleted:SP",
      ].sort(),
    );
  });

  it("renders each entry with the names its own row points at", async () => {
    // Boundary 3 of the harness: asserting only *which* entries come back
    // would leave the three joins unproven, and a swapped one shows a real
    // person under someone else's name.
    const entries = await activity.listForUser(D, { limit: 100 });
    const memberAdded = entries.find((entry) => entry.type === "group_member_added");
    expect(memberAdded).toMatchObject({
      actorUserId: D,
      // D has no display name, so  falls back to the
      // email's local part.
      actorDisplayName: "dee",
      groupName: "Duo",
      counterpartUserId: A,
      counterpartDisplayName: "Ann",
    });

    const settlementDeleted = entries.find((entry) => entry.type === "settlement_deleted");
    expect(settlementDeleted).toMatchObject({
      actorUserId: C,
      actorDisplayName: "Cid",
      // Groupless: no group to name.
      groupId: null,
      groupName: null,
      counterpartUserId: D,
      amount: 200,
      currency: "JPY",
    });
  });

  it("returns entries newest first and pages with the cursor", async () => {
    const first = await activity.listForUser(A, { limit: 3 });
    expect(first).toHaveLength(3);
    for (let i = 1; i < first.length; i += 1) {
      const previous = first[i - 1]!;
      const current = first[i]!;
      expect(previous.createdAt.getTime()).toBeGreaterThanOrEqual(current.createdAt.getTime());
    }

    const last = first[first.length - 1]!;
    const second = await activity.listForUser(A, { limit: 100, before: { createdAt: last.createdAt, id: last.id } });
    const firstIds = new Set(first.map((entry) => entry.id));
    // No overlap and nothing dropped: the two pages together are exactly what
    // an unpaged read returns. Entries written in the same batch share a
    // timestamp, so a cursor on the timestamp alone would either repeat them
    // or skip them.
    expect(second.some((entry) => firstIds.has(entry.id))).toBe(false);
    const all = await activity.listForUser(A, { limit: 100 });
    expect([...firstIds, ...second.map((entry) => entry.id)].sort()).toEqual(all.map((entry) => entry.id).sort());
  });
});
