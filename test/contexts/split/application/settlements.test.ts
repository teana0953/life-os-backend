import { beforeEach, describe, expect, it } from "vitest";
import { addGroupMember } from "../../../../src/contexts/split/application/add-group-member";
import { archiveGroup } from "../../../../src/contexts/split/application/archive-group";
import { createGroup } from "../../../../src/contexts/split/application/create-group";
import { createSettlement, type CreateSettlementDeps } from "../../../../src/contexts/split/application/create-settlement";
import { deleteSettlement } from "../../../../src/contexts/split/application/delete-settlement";
import { getSplitSpending } from "../../../../src/contexts/split/application/get-split-spending";
import { listSettlements } from "../../../../src/contexts/split/application/list-settlements";
import type { CreateSettlementInput } from "../../../../src/contexts/split/application/settlement-input";
import type { CreateSettlementInput as CreateSettlementRow, Settlement } from "../../../../src/contexts/split/domain/settlement";
import type { ListSettlementsFilter, SettlementRepository } from "../../../../src/contexts/split/domain/settlement-repository";
import { CannotSettleWithSelf, GroupArchived, GroupNotFound, InvalidSplitInput, NotAGroupMember, NotAParticipant, NotFriends, SettlementNotFound } from "../../../../src/contexts/split/domain/errors";
import { MAX_MINOR_UNITS } from "../../../../src/contexts/split/application/validate-expense-fields";
import { InMemoryExpenseGroupRepository, InMemoryFriendChecker, InMemorySettlementRepository, InMemorySplitExpenseRepository } from "../fakes";

const NOW = new Date("2026-08-01T00:00:00.000Z");
const A = "user-a";
const B = "user-b";
const C = "user-c";
const D = "user-d";

let groups: InMemoryExpenseGroupRepository;
let friends: InMemoryFriendChecker;
let settlements: InMemorySettlementRepository;
let deps: CreateSettlementDeps;

beforeEach(() => {
  groups = new InMemoryExpenseGroupRepository();
  friends = new InMemoryFriendChecker();
  settlements = new InMemorySettlementRepository(groups);
  deps = { settlements, groups, friends };
  friends.addFriendship(A, B);
  friends.addFriendship(A, C);
});

function groupless(overrides: Partial<CreateSettlementInput> = {}): CreateSettlementInput {
  return {
    callerUserId: A,
    groupId: null,
    fromUserId: B,
    toUserId: A,
    amount: 450,
    currency: "TWD",
    day: "2026-08-01",
    note: null,
    ...overrides,
  };
}

describe("createSettlement: field validation", () => {
  it("records a repayment naming both people, the amount, the currency and the day", async () => {
    const settlement = await createSettlement(deps, groupless());

    expect(settlement.fromUserId).toBe(B);
    expect(settlement.toUserId).toBe(A);
    expect(settlement.amount).toBe(450);
    expect(settlement.currency).toBe("TWD");
    expect(settlement.day).toBe("2026-08-01");
  });

  it("rejects an amount of zero or less", async () => {
    await expect(createSettlement(deps, groupless({ amount: 0 }))).rejects.toBeInstanceOf(InvalidSplitInput);
    await expect(createSettlement(deps, groupless({ amount: -5 }))).rejects.toBeInstanceOf(InvalidSplitInput);
  });

  it("rejects an amount above what the integer column can hold, as a bad request", async () => {
    await expect(createSettlement(deps, groupless({ amount: MAX_MINOR_UNITS + 1 }))).rejects.toBeInstanceOf(InvalidSplitInput);
    expect(settlements.rows).toHaveLength(0);
  });

  it("rejects a malformed currency", async () => {
    await expect(createSettlement(deps, groupless({ currency: "twd" }))).rejects.toBeInstanceOf(InvalidSplitInput);
    await expect(createSettlement(deps, groupless({ currency: "TW" }))).rejects.toBeInstanceOf(InvalidSplitInput);
  });

  it("rejects a malformed day", async () => {
    await expect(createSettlement(deps, groupless({ day: "2026/08/01" }))).rejects.toBeInstanceOf(InvalidSplitInput);
    await expect(createSettlement(deps, groupless({ day: "2026-02-30" }))).rejects.toBeInstanceOf(InvalidSplitInput);
  });

  it("rejects paying yourself", async () => {
    await expect(createSettlement(deps, groupless({ fromUserId: A, toUserId: A }))).rejects.toBeInstanceOf(CannotSettleWithSelf);
  });

  it("allows overpaying — that is a real situation, not an error", async () => {
    const settlement = await createSettlement(deps, groupless({ amount: 600 }));
    expect(settlement.amount).toBe(600);
  });
});

describe("createSettlement: caller must be payer or payee (anti-fabrication)", () => {
  it("rejects a settlement between two other people, with the caller nowhere in it", async () => {
    friends.addFriendship(B, C);
    await expect(createSettlement(deps, groupless({ callerUserId: A, fromUserId: B, toUserId: C }))).rejects.toBeInstanceOf(NotAParticipant);
    expect(settlements.rows).toHaveLength(0);
  });

  it("accepts the caller as either the payer or the payee", async () => {
    await expect(createSettlement(deps, groupless({ callerUserId: B, fromUserId: B, toUserId: A }))).resolves.toBeDefined();
    await expect(createSettlement(deps, groupless({ callerUserId: A, fromUserId: B, toUserId: A }))).resolves.toBeDefined();
  });
});

describe("createSettlement: groupless settlements require friendship", () => {
  it("rejects a counterpart who is not a friend", async () => {
    await expect(createSettlement(deps, groupless({ fromUserId: D, toUserId: A }))).rejects.toBeInstanceOf(NotFriends);
    expect(settlements.rows).toHaveLength(0);
  });
});

describe("createSettlement: grouped settlements require group membership, not friendship", () => {
  it("requires the group to exist and the caller to be a member", async () => {
    await expect(createSettlement(deps, groupless({ groupId: "no-such-group" }))).rejects.toBeInstanceOf(GroupNotFound);
  });

  it("hides a group the caller is not a member of behind 404, even though the caller is a party to the settlement itself", async () => {
    const group = await createGroup(groups, "Trip", C);
    // Neither A nor B belongs to "Trip" — only C does.
    await expect(createSettlement(deps, groupless({ callerUserId: A, groupId: group.id, fromUserId: A, toUserId: B }))).rejects.toBeInstanceOf(
      GroupNotFound,
    );
  });

  it("rejects a settlement party who is not a group member, even if they are a friend of the caller", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    // C is A's friend but not a member of this group.
    await expect(createSettlement(deps, groupless({ groupId: group.id, fromUserId: C, toUserId: A }))).rejects.toBeInstanceOf(NotAGroupMember);
  });

  it("creates a grouped settlement when both parties are members", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);

    const settlement = await createSettlement(deps, groupless({ groupId: group.id }));

    expect(settlement.groupId).toBe(group.id);
  });

  it("rejects a new settlement on an archived group", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    await archiveGroup(groups, A, group.id, NOW);

    await expect(createSettlement(deps, groupless({ groupId: group.id }))).rejects.toBeInstanceOf(GroupArchived);
  });
});

describe("deleteSettlement", () => {
  it("lets the creator delete", async () => {
    const settlement = await createSettlement(deps, groupless());

    await deleteSettlement(settlements, A, settlement.id);

    expect(await settlements.findById(settlement.id)).toBeNull();
  });

  it("lets the payer (from_user_id) delete, even if they did not create it", async () => {
    const settlement = await createSettlement(deps, groupless({ callerUserId: A, fromUserId: B, toUserId: A }));

    await deleteSettlement(settlements, B, settlement.id);

    expect(await settlements.findById(settlement.id)).toBeNull();
  });

  it("refuses a payee who neither created it nor paid it", async () => {
    // B pays A, B creates it (caller=B): payee A did not create and did not pay.
    const settlement = await createSettlement(deps, groupless({ callerUserId: B, fromUserId: B, toUserId: A }));

    await expect(deleteSettlement(settlements, A, settlement.id)).rejects.toBeInstanceOf(SettlementNotFound);
    expect(await settlements.findById(settlement.id)).not.toBeNull();
  });

  it("404s a stranger, and the settlement is unchanged", async () => {
    const settlement = await createSettlement(deps, groupless());

    await expect(deleteSettlement(settlements, "user-stranger", settlement.id)).rejects.toBeInstanceOf(SettlementNotFound);
    expect(await settlements.findById(settlement.id)).not.toBeNull();
  });

  it("lets the payer still delete a settlement in an archived group", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    const settlement = await createSettlement(deps, groupless({ groupId: group.id }));
    await archiveGroup(groups, A, group.id, NOW);

    await deleteSettlement(settlements, A, settlement.id);

    expect(await settlements.findById(settlement.id)).toBeNull();
  });
});

describe("listSettlements", () => {
  it("lists everything the caller is a party to when neither filter is given", async () => {
    const s1 = await createSettlement(deps, groupless({ callerUserId: A, fromUserId: B, toUserId: A }));
    const s2 = await createSettlement(deps, groupless({ callerUserId: A, fromUserId: A, toUserId: C }));

    const listed = await listSettlements({ settlements, groups }, A, {});

    expect(listed.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  });

  it("excludes grouped settlements from a one-to-one 'with' list", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    const grouped = await createSettlement(deps, groupless({ groupId: group.id, fromUserId: B, toUserId: A }));
    const direct = await createSettlement(deps, groupless({ fromUserId: B, toUserId: A }));
    void grouped;

    const listed = await listSettlements({ settlements, groups }, A, { withUserId: B });

    expect(listed.map((s) => s.id)).toEqual([direct.id]);
  });

  it("rejects group_id and with given together", async () => {
    await expect(listSettlements({ settlements, groups }, A, { groupId: "g", withUserId: B })).rejects.toBeInstanceOf(InvalidSplitInput);
  });

  it("404s a group filter for a group the caller does not belong to", async () => {
    const group = await createGroup(groups, "Trip", A);

    await expect(listSettlements({ settlements, groups }, C, { groupId: group.id })).rejects.toBeInstanceOf(GroupNotFound);
  });

  it("never surfaces a settlement to a stranger, unfiltered or via a group they don't belong to", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    await createSettlement(deps, groupless({ groupId: group.id, fromUserId: B, toUserId: A }));

    const stranger = "user-stranger";
    const listed = await listSettlements({ settlements, groups }, stranger, {});

    expect(listed).toEqual([]);
  });

  // The test above passes because `InMemorySettlementRepository` filters the
  // row out itself, so it never reaches the use case's own re-assertion. This
  // one hands the use case a deliberately over-permissive repository — the
  // only thing in CI that fails if the guard is deleted, and the SQL it backs
  // up cannot be run here at all. Mirrors the `listExpenses` poison-row test.
  it("drops a row the repository returns that the caller does not actually participate in", async () => {
    const poisoned: Settlement = {
      id: "poisoned",
      groupId: "group-the-caller-is-not-in",
      fromUserId: B,
      fromDisplayName: "Bob",
      toUserId: C,
      toDisplayName: "Carol",
      createdByUserId: B,
      amount: 100,
      currency: "TWD",
      day: "2026-08-01",
      note: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const poisonedRepo: SettlementRepository = {
      async create(_input: CreateSettlementRow) {
        throw new Error("unused");
      },
      async findById() {
        return null;
      },
      async delete() {
        return false;
      },
      async listForUser(_userId: string, _filter: ListSettlementsFilter) {
        return [poisoned];
      },
    };

    const listed = await listSettlements({ settlements: poisonedRepo, groups }, A, {});

    expect(listed).toEqual([]);
  });

  it("includes a grouped settlement the caller only sees through membership, matching the group filter", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    await addGroupMember({ groups, friends }, A, group.id, C, NOW);
    // C is a member but is neither party to this settlement.
    const grouped = await createSettlement(deps, groupless({ groupId: group.id, fromUserId: B, toUserId: A }));

    const listed = await listSettlements({ settlements, groups }, C, {});

    expect(listed.map((s) => s.id)).toEqual([grouped.id]);
    expect((await listSettlements({ settlements, groups }, C, { groupId: group.id })).map((s) => s.id)).toEqual([grouped.id]);
  });
});

describe("getSplitSpending", () => {
  let expenses: InMemorySplitExpenseRepository;

  beforeEach(() => {
    expenses = new InMemorySplitExpenseRepository(groups);
  });

  it("sums the user's own shares per currency for the given month, as separate rows", async () => {
    await expenses.create({
      id: "e1",
      groupId: null,
      payerUserId: A,
      createdByUserId: A,
      amount: 900,
      currency: "TWD",
      description: "dinner",
      day: "2026-08-01",
      splitMode: "equal",
      shares: [{ userId: A, amount: 300 }, { userId: B, amount: 600 }],
    });
    await expenses.create({
      id: "e2",
      groupId: null,
      payerUserId: B,
      createdByUserId: B,
      amount: 1000,
      currency: "USD",
      description: "hotel",
      day: "2026-08-15",
      splitMode: "equal",
      shares: [{ userId: A, amount: 1000 }],
    });

    const spending = await getSplitSpending(expenses, A, "2026-08");

    expect(spending.sort((x, y) => x.currency.localeCompare(y.currency))).toEqual([
      { currency: "TWD", amount: 300 },
      { currency: "USD", amount: 1000 },
    ]);
  });

  it("counts the payer's own share as their spending", async () => {
    await expenses.create({
      id: "e1",
      groupId: null,
      payerUserId: A,
      createdByUserId: A,
      amount: 900,
      currency: "TWD",
      description: "dinner",
      day: "2026-08-01",
      splitMode: "equal",
      shares: [{ userId: A, amount: 300 }, { userId: B, amount: 600 }],
    });

    const spending = await getSplitSpending(expenses, A, "2026-08");

    expect(spending).toEqual([{ currency: "TWD", amount: 300 }]);
  });

  it("excludes a month with no split shares — no zero row", async () => {
    const spending = await getSplitSpending(expenses, A, "2026-09");
    expect(spending).toEqual([]);
  });

  // "A repayment is not spending" cannot be tested here: `getSplitSpending`
  // takes only a `SplitSpendingRepository`, so a settlement created in this
  // file's `settlements` fake has no way of reaching it whatever the
  // production code does. The HTTP test in finance.test.ts
  // ("a recorded settlement does not move the split-spending figure") runs
  // both through one app instance and is the one that can fail.
});
