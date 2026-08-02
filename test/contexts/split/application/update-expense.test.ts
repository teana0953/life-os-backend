import { beforeEach, describe, expect, it } from "vitest";
import { addGroupMember } from "../../../../src/contexts/split/application/add-group-member";
import { createExpense, type CreateExpenseDeps } from "../../../../src/contexts/split/application/create-expense";
import { createGroup } from "../../../../src/contexts/split/application/create-group";
import type { CreateExpenseInput } from "../../../../src/contexts/split/application/expense-input";
import { updateExpense } from "../../../../src/contexts/split/application/update-expense";
import { ExpenseNotFound, InvalidSplitInput, NotAParticipant, NotFriends, SharesDoNotSumToAmount } from "../../../../src/contexts/split/domain/errors";
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
  friends.addFriendship(B, C);
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

describe("updateExpense: authorization", () => {
  it("lets the creator edit", async () => {
    const expense = await createExpense(deps, groupless());

    const updated = await updateExpense(deps, A, expense.id, {
      payerUserId: A,
      amount: 600,
      currency: "TWD",
      description: "dinner",
      day: "2026-08-01",
      split: { mode: "equal", participantUserIds: [A, B] },
    });

    expect(updated.amount).toBe(600);
  });

  it("lets the payer edit an expense someone else created", async () => {
    const expense = await createExpense(deps, groupless({ callerUserId: A, payerUserId: B, split: { mode: "equal", participantUserIds: [A, B] } }));

    const updated = await updateExpense(deps, B, expense.id, {
      payerUserId: B,
      amount: 600,
      currency: "TWD",
      description: "dinner",
      day: "2026-08-01",
      split: { mode: "equal", participantUserIds: [A, B] },
    });

    expect(updated.amount).toBe(600);
  });

  it("refuses a participant who is neither creator nor payer, leaving the expense unchanged", async () => {
    const expense = await createExpense(deps, groupless());

    await expect(
      updateExpense(deps, B, expense.id, {
        payerUserId: A,
        amount: 100,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "equal", participantUserIds: [A, B, C] },
      }),
    ).rejects.toBeInstanceOf(ExpenseNotFound);
    expect((await expenses.findById(expense.id))?.amount).toBe(900);
  });
});

describe("updateExpense: reruns every creation rule", () => {
  it("rejects a share that no longer sums to the amount, leaving the stored expense unchanged", async () => {
    const expense = await createExpense(deps, groupless());

    await expect(
      updateExpense(deps, A, expense.id, {
        payerUserId: A,
        amount: 900,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "exact", shares: [{ userId: A, amount: 100 }, { userId: B, amount: 100 }] },
      }),
    ).rejects.toBeInstanceOf(SharesDoNotSumToAmount);
    expect((await expenses.findById(expense.id))?.shares).toEqual(expense.shares);
  });

  it("rejects a share naming a non-friend", async () => {
    const expense = await createExpense(deps, groupless());

    await expect(
      updateExpense(deps, A, expense.id, {
        payerUserId: A,
        amount: 900,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "equal", participantUserIds: [A, D] },
      }),
    ).rejects.toBeInstanceOf(NotFriends);
  });

  it("closes the fabrication bypass: editing the caller out of the expense is rejected, not merely re-checked afterward", async () => {
    // A (a common friend of B and C) legitimately creates payer=B, shares={A:500, C:500}.
    const expense = await createExpense(
      deps,
      groupless({ callerUserId: A, payerUserId: B, amount: 1000, split: { mode: "exact", shares: [{ userId: A, amount: 500 }, { userId: C, amount: 500 }] } }),
    );

    // A then tries to PATCH the shares down to {C: 1000} — conjuring "C owes B 1000" with A nowhere in it.
    await expect(
      updateExpense(deps, A, expense.id, {
        payerUserId: B,
        amount: 1000,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "exact", shares: [{ userId: C, amount: 1000 }] },
      }),
    ).rejects.toBeInstanceOf(NotAParticipant);

    // The original expense — with A still in it — is untouched.
    const stillStored = await expenses.findById(expense.id);
    expect(stillStored?.shares.map((s) => s.userId).sort()).toEqual([A, C].sort());
    expect(stillStored?.amount).toBe(1000);
  });

  it("closes the same bypass taken by zeroing the caller's own share instead of removing it", async () => {
    const expense = await createExpense(
      deps,
      groupless({ callerUserId: A, payerUserId: B, amount: 1000, split: { mode: "exact", shares: [{ userId: A, amount: 500 }, { userId: C, amount: 500 }] } }),
    );

    await expect(
      updateExpense(deps, A, expense.id, {
        payerUserId: B,
        amount: 1000,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "exact", shares: [{ userId: A, amount: 0 }, { userId: C, amount: 1000 }] },
      }),
    ).rejects.toBeInstanceOf(NotAParticipant);

    const stillStored = await expenses.findById(expense.id);
    expect(stillStored?.shares.find((s) => s.userId === A)?.amount).toBe(500);
  });

  it("rejects an attempt to move the expense to a different group", async () => {
    const expense = await createExpense(deps, groupless());

    await expect(
      updateExpense(deps, A, expense.id, {
        payerUserId: A,
        amount: 900,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "equal", participantUserIds: [A, B, C] },
        groupId: "some-other-group",
      }),
    ).rejects.toBeInstanceOf(InvalidSplitInput);
  });

  it("accepts the unchanged group id echoed back in uppercase", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, new Date());
    const expense = await createExpense(deps, groupless({ groupId: group.id, split: { mode: "equal", participantUserIds: [A, B] } }));

    const updated = await updateExpense(deps, A, expense.id, {
      payerUserId: A,
      amount: 600,
      currency: "TWD",
      description: "dinner",
      day: "2026-08-01",
      split: { mode: "equal", participantUserIds: [A, B] },
      groupId: group.id.toUpperCase(),
    });

    expect(updated.amount).toBe(600);
    expect(updated.groupId).toBe(group.id);
  });
});

describe("updateExpense: removing a participant clears what they owed", () => {
  it("drops a former participant's share while the rest still sums to the amount", async () => {
    const expense = await createExpense(deps, groupless());

    const updated = await updateExpense(deps, A, expense.id, {
      payerUserId: A,
      amount: 600,
      currency: "TWD",
      description: "dinner",
      day: "2026-08-01",
      split: { mode: "equal", participantUserIds: [A, B] },
    });

    expect(updated.shares.some((s) => s.userId === C)).toBe(false);
    expect(updated.shares.reduce((sum, s) => sum + s.amount, 0)).toBe(600);
  });
});
