import { beforeEach, describe, expect, it } from "vitest";
import { addGroupMember } from "../../../../src/contexts/split/application/add-group-member";
import { archiveGroup } from "../../../../src/contexts/split/application/archive-group";
import { createExpense, type CreateExpenseDeps } from "../../../../src/contexts/split/application/create-expense";
import { createGroup } from "../../../../src/contexts/split/application/create-group";
import type { CreateExpenseInput } from "../../../../src/contexts/split/application/expense-input";
import { DuplicateParticipant, GroupArchived, GroupNotFound, InvalidSplitInput, NotAGroupMember, NotAParticipant, NotFriends, SharesDoNotSumToAmount, SplitTooSmall } from "../../../../src/contexts/split/domain/errors";
import { InMemoryExpenseGroupRepository, InMemoryFriendChecker, InMemorySplitExpenseRepository } from "../fakes";

const A = "user-a";
const B = "user-b";
const C = "user-c";
const D = "user-d";

let groups: InMemoryExpenseGroupRepository;
let friends: InMemoryFriendChecker;
let expenses: InMemorySplitExpenseRepository;
let deps: CreateExpenseDeps;

beforeEach(() => {
  groups = new InMemoryExpenseGroupRepository();
  friends = new InMemoryFriendChecker();
  expenses = new InMemorySplitExpenseRepository(groups);
  deps = { expenses, groups, friends };
  friends.addFriendship(A, B);
  friends.addFriendship(A, C);
});

function groupless(overrides: Partial<CreateExpenseInput> = {}): CreateExpenseInput {
  return {
    callerUserId: A,
    groupId: null,
    payerUserId: A,
    amount: 900,
    currency: "TWD",
    description: "dinner",
    day: "2026-08-01",
    split: { mode: "equal", participantUserIds: [A, B, C] },
    ...overrides,
  };
}

describe("createExpense: field validation", () => {
  it("creates an expense with shares summing to the amount", async () => {
    const expense = await createExpense(deps, groupless());

    expect(expense.shares.reduce((sum, s) => sum + s.amount, 0)).toBe(900);
    expect(expense.shares.map((s) => s.userId).sort()).toEqual([A, B, C].sort());
  });

  it("rejects an amount of zero or less", async () => {
    await expect(createExpense(deps, groupless({ amount: 0 }))).rejects.toBeInstanceOf(InvalidSplitInput);
    await expect(createExpense(deps, groupless({ amount: -5 }))).rejects.toBeInstanceOf(InvalidSplitInput);
  });

  it("rejects a malformed currency", async () => {
    await expect(createExpense(deps, groupless({ currency: "twd" }))).rejects.toBeInstanceOf(InvalidSplitInput);
    await expect(createExpense(deps, groupless({ currency: "TW" }))).rejects.toBeInstanceOf(InvalidSplitInput);
  });

  it("rejects a malformed day", async () => {
    await expect(createExpense(deps, groupless({ day: "2026/08/01" }))).rejects.toBeInstanceOf(InvalidSplitInput);
    await expect(createExpense(deps, groupless({ day: "2026-02-30" }))).rejects.toBeInstanceOf(InvalidSplitInput);
  });

  it("rejects shares that do not sum to the amount", async () => {
    await expect(
      createExpense(
        deps,
        groupless({ split: { mode: "exact", shares: [{ userId: A, amount: 400 }, { userId: B, amount: 400 }] } }),
      ),
    ).rejects.toBeInstanceOf(SharesDoNotSumToAmount);
  });

  it("rejects a duplicated participant", async () => {
    await expect(createExpense(deps, groupless({ split: { mode: "equal", participantUserIds: [A, B, B] } }))).rejects.toBeInstanceOf(
      DuplicateParticipant,
    );
  });

  it("rejects a one-person split", async () => {
    await expect(createExpense(deps, groupless({ split: { mode: "equal", participantUserIds: [A] } }))).rejects.toBeInstanceOf(SplitTooSmall);
  });
});

describe("createExpense: caller must be a participant (anti-fabrication)", () => {
  it("rejects a debt fabricated between two other people, with the caller nowhere in it", async () => {
    // A is B and C's common friend, but names neither themself as payer nor as a share holder.
    await expect(
      createExpense(
        deps,
        groupless({ payerUserId: B, split: { mode: "exact", shares: [{ userId: C, amount: 900 }] } }),
      ),
    ).rejects.toBeInstanceOf(NotAParticipant);
    expect(expenses.rows).toHaveLength(0);
  });

  it("rejects a debt between two other people with the caller present but holding a zero share", async () => {
    // A names themself, but for 0 — no stake at all. The stored expense would
    // be "C owes B 900" with A economically nowhere in it.
    await expect(
      createExpense(
        deps,
        groupless({ payerUserId: B, split: { mode: "exact", shares: [{ userId: A, amount: 0 }, { userId: C, amount: 900 }] } }),
      ),
    ).rejects.toBeInstanceOf(NotAParticipant);
    expect(expenses.rows).toHaveLength(0);
  });

  it("rejects an equal split too small to go round, whoever is asking", async () => {
    // The check must not live inside the caller-stake branch: there it fired
    // only when the caller happened to be the one who got the 0, so the same
    // payload succeeded or failed depending on who asked and on how the uuids
    // sorted — and the successful path stored 0 shares.
    const participantUserIds = [A, B, C].sort();
    for (const caller of participantUserIds) {
      await expect(
        createExpense(deps, {
          ...groupless({ payerUserId: participantUserIds[0], split: { mode: "equal", participantUserIds } }),
          callerUserId: caller,
          amount: 2,
        }),
      ).rejects.toBeInstanceOf(InvalidSplitInput);
    }
    expect(expenses.rows).toHaveLength(0);
  });

  it("says the amount is too small rather than blaming the caller for being absent", async () => {
    // An equal split of 2 between three people gives the tail of the
    // canonical-uuid order a 0 share. If that tail is the caller, the stake
    // rule fires — but `not_a_participant` would tell them they are missing
    // from an expense they explicitly listed themself in, sending them to
    // look in the wrong place.
    const participantUserIds = [A, B, C].sort();
    const caller = participantUserIds[participantUserIds.length - 1];
    await expect(
      createExpense(deps, {
        ...groupless({ payerUserId: participantUserIds[0], split: { mode: "equal", participantUserIds } }),
        callerUserId: caller,
        amount: 2,
      }),
    ).rejects.toBeInstanceOf(InvalidSplitInput);
    expect(expenses.rows).toHaveLength(0);
  });

  it("rejects an amount above what the integer column can hold, as a bad request", async () => {
    // `split_expense.amount` is a Postgres `integer`. Without this bound the
    // value passes every application check and Postgres answers 22003, which
    // reaches the client as a 500 — a bad request reported as a server fault.
    await expect(
      createExpense(deps, groupless({ amount: 2147483648, split: { mode: "equal", participantUserIds: [A, B] } })),
    ).rejects.toBeInstanceOf(InvalidSplitInput);
    expect(expenses.rows).toHaveLength(0);
  });

  it("accepts the caller with the smallest real stake, and a zero share for someone else", async () => {
    // One minor unit is a stake: the rule requires the caller to be in the
    // expense for real, not that their share be large. C owing nothing on a
    // bill they were part of is a legitimate split.
    const expense = await createExpense(
      deps,
      groupless({ payerUserId: B, amount: 900, split: { mode: "exact", shares: [{ userId: A, amount: 1 }, { userId: C, amount: 899 }] } }),
    );
    expect(expense.shares.find((s) => s.userId === A)?.amount).toBe(1);

    const withZeroForOther = await createExpense(
      deps,
      groupless({ payerUserId: B, amount: 900, split: { mode: "exact", shares: [{ userId: A, amount: 900 }, { userId: C, amount: 0 }] } }),
    );
    expect(withZeroForOther.shares.find((s) => s.userId === C)?.amount).toBe(0);
  });

  it("allows the caller to be only the payer, holding no share (a pure advance)", async () => {
    const expense = await createExpense(
      deps,
      groupless({ payerUserId: A, split: { mode: "exact", shares: [{ userId: B, amount: 500 }, { userId: C, amount: 400 }] } }),
    );

    expect(expense.payerUserId).toBe(A);
    expect(expense.shares.map((s) => s.userId).sort()).toEqual([B, C].sort());
  });
});

describe("createExpense: payer must be a named user, validated like anyone else", () => {
  it("rejects a payer who is not the caller, a friend, nor a group member", async () => {
    await expect(createExpense(deps, groupless({ payerUserId: D, split: { mode: "equal", participantUserIds: [A, D] } }))).rejects.toBeInstanceOf(
      NotFriends,
    );
    expect(expenses.rows).toHaveLength(0);
  });
});

describe("createExpense: groupless splits require friendship", () => {
  it("rejects a share belonging to a non-friend", async () => {
    await expect(createExpense(deps, groupless({ split: { mode: "equal", participantUserIds: [A, D] } }))).rejects.toBeInstanceOf(NotFriends);
    expect(expenses.rows).toHaveLength(0);
  });
});

describe("createExpense: grouped expenses require group membership, not friendship", () => {
  it("requires the group to exist and the caller to be a member", async () => {
    await expect(createExpense(deps, groupless({ groupId: "no-such-group" }))).rejects.toBeInstanceOf(GroupNotFound);
  });

  it("requires the payer to be a group member — a friend of the caller is not enough", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, new Date());
    // C is A's friend but not a member of this group.
    await expect(
      createExpense(deps, groupless({ groupId: group.id, payerUserId: C, split: { mode: "equal", participantUserIds: [A, C] } })),
    ).rejects.toBeInstanceOf(NotAGroupMember);
  });

  it("rejects a share holder who is not a group member, even if they are a friend of the caller", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, new Date());

    await expect(
      createExpense(deps, groupless({ groupId: group.id, payerUserId: A, split: { mode: "equal", participantUserIds: [A, B, C] } })),
    ).rejects.toBeInstanceOf(NotAGroupMember);
  });

  it("creates a grouped expense when payer and all share holders are members", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, new Date());

    const expense = await createExpense(deps, groupless({ groupId: group.id, split: { mode: "equal", participantUserIds: [A, B] } }));

    expect(expense.groupId).toBe(group.id);
  });

  it("rejects a new expense on an archived group", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, new Date());
    await archiveGroup(groups, A, group.id, new Date());

    await expect(
      createExpense(deps, groupless({ groupId: group.id, split: { mode: "equal", participantUserIds: [A, B] } })),
    ).rejects.toBeInstanceOf(GroupArchived);
  });
});
