import { beforeEach, describe, expect, it } from "vitest";
import { addGroupMember } from "../../../../src/contexts/split/application/add-group-member";
import { archiveGroup } from "../../../../src/contexts/split/application/archive-group";
import { createExpense, type CreateExpenseDeps } from "../../../../src/contexts/split/application/create-expense";
import { createGroup } from "../../../../src/contexts/split/application/create-group";
import { deleteExpense } from "../../../../src/contexts/split/application/delete-expense";
import type { CreateExpenseInput } from "../../../../src/contexts/split/application/expense-input";
import { getExpense } from "../../../../src/contexts/split/application/get-expense";
import { listExpenses } from "../../../../src/contexts/split/application/list-expenses";
import { updateExpense } from "../../../../src/contexts/split/application/update-expense";
import { ExpenseNotFound, InvalidSplitInput } from "../../../../src/contexts/split/domain/errors";
import type { CreateSplitExpenseInput, SplitExpense, UpdateSplitExpenseFields } from "../../../../src/contexts/split/domain/split-expense";
import type { ListExpensesFilter, SplitExpenseRepository } from "../../../../src/contexts/split/domain/split-expense-repository";
import { InMemoryExpenseGroupRepository, InMemoryFriendChecker, InMemorySplitExpenseRepository } from "../fakes";

const NOW = new Date("2026-08-01T00:00:00.000Z");
const A = "user-a";
const B = "user-b";
const C = "user-c";

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

describe("deleteExpense", () => {
  it("lets the creator delete", async () => {
    const expense = await createExpense(deps, groupless());

    await deleteExpense(expenses, A, expense.id);

    expect(await expenses.findById(expense.id)).toBeNull();
  });

  it("refuses a participant who is neither creator nor payer", async () => {
    const expense = await createExpense(deps, groupless());

    await expect(deleteExpense(expenses, B, expense.id)).rejects.toBeInstanceOf(ExpenseNotFound);
    expect(await expenses.findById(expense.id)).not.toBeNull();
  });
});

describe("getExpense", () => {
  it("is visible to a share holder who did not create it", async () => {
    const expense = await createExpense(deps, groupless());

    const found = await getExpense({ expenses, groups }, B, expense.id);

    expect(found.id).toBe(expense.id);
  });

  it("is hidden from a stranger", async () => {
    const expense = await createExpense(deps, groupless());

    await expect(getExpense({ expenses, groups }, "user-stranger", expense.id)).rejects.toBeInstanceOf(ExpenseNotFound);
  });

  it("is visible to a group member via membership, even without a share", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    await addGroupMember({ groups, friends }, A, group.id, C, NOW);
    const expense = await createExpense(deps, groupless({ groupId: group.id, split: { mode: "equal", participantUserIds: [A, B] } }));

    const found = await getExpense({ expenses, groups }, C, expense.id);

    expect(found.id).toBe(expense.id);
  });
});

describe("listExpenses", () => {
  it("lists everything the caller participates in when neither filter is given", async () => {
    const e1 = await createExpense(deps, groupless());
    const e2 = await createExpense(deps, groupless({ payerUserId: B, split: { mode: "equal", participantUserIds: [A, B] } }));

    const listed = await listExpenses({ expenses, groups }, A, {});

    expect(listed.map((e) => e.id).sort()).toEqual([e1.id, e2.id].sort());
  });

  it("excludes group expenses from a one-to-one 'with' list", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    const grouped = await createExpense(deps, groupless({ groupId: group.id, split: { mode: "equal", participantUserIds: [A, B] } }));
    const direct = await createExpense(deps, groupless({ split: { mode: "equal", participantUserIds: [A, B] } }));
    void grouped;

    const listed = await listExpenses({ expenses, groups }, A, { withUserId: B });

    expect(listed.map((e) => e.id)).toEqual([direct.id]);
  });

  it("rejects group_id and with given together", async () => {
    await expect(listExpenses({ expenses, groups }, A, { groupId: "g", withUserId: B })).rejects.toBeInstanceOf(InvalidSplitInput);
  });

  it("drops a row the repository returns that the caller does not actually participate in", async () => {
    const poisoned: SplitExpense = {
      id: "poisoned",
      groupId: null,
      payerUserId: B,
      createdByUserId: B,
      amount: 100,
      currency: "TWD",
      description: "not yours",
      day: "2026-08-01",
      splitMode: "equal",
      shares: [{ userId: C, amount: 100, displayName: "Carol" }],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const poisonedRepo: SplitExpenseRepository = {
      async create(_input: CreateSplitExpenseInput) {
        throw new Error("unused");
      },
      async findById() {
        return null;
      },
      async update(_id: string, _fields: UpdateSplitExpenseFields, _now: Date) {
        return null;
      },
      async delete() {
        return false;
      },
      async listForUser(_userId: string, _filter: ListExpensesFilter) {
        return [poisoned];
      },
    };

    const listed = await listExpenses({ expenses: poisonedRepo, groups }, A, {});

    expect(listed).toEqual([]);
  });

  it("includes a group expense the caller only sees through membership in the unfiltered listing", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    await addGroupMember({ groups, friends }, A, group.id, C, NOW);
    // C is a member but holds no share and did not pay.
    const grouped = await createExpense(deps, groupless({ groupId: group.id, split: { mode: "equal", participantUserIds: [A, B] } }));

    const listed = await listExpenses({ expenses, groups }, C, {});

    // The unfiltered listing must agree with `?group_id=` about what C can see.
    expect(listed.map((e) => e.id)).toEqual([grouped.id]);
    expect((await listExpenses({ expenses, groups }, C, { groupId: group.id })).map((e) => e.id)).toEqual([grouped.id]);
  });

  it("resolves group membership once per group, not once per listed row", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    await addGroupMember({ groups, friends }, A, group.id, C, NOW);
    for (const description of ["one", "two", "three"]) {
      await createExpense(deps, groupless({ groupId: group.id, description, split: { mode: "equal", participantUserIds: [A, B] } }));
    }

    groups.membersAmongCalls = 0;
    const listed = await listExpenses({ expenses, groups }, C, { groupId: group.id });

    expect(listed).toHaveLength(3);
    // One lookup for the filter's membership check, and none per row.
    expect(groups.membersAmongCalls).toBe(1);
  });

  it("counts group membership as participation, so a legitimate group expense is not dropped by the re-check", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    await addGroupMember({ groups, friends }, A, group.id, C, NOW);
    const expense = await createExpense(deps, groupless({ groupId: group.id, split: { mode: "equal", participantUserIds: [A, B] } }));

    const listed = await listExpenses({ expenses, groups }, C, { groupId: group.id });

    expect(listed.map((e) => e.id)).toEqual([expense.id]);
  });
});

describe("archived groups: existing expenses stay correctable, but new ones are blocked", () => {
  it("lets the payer/creator still edit an expense in an archived group", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    const expense = await createExpense(deps, groupless({ groupId: group.id, split: { mode: "equal", participantUserIds: [A, B] } }));
    await archiveGroup(groups, A, group.id, NOW);

    const updated = await updateExpense(deps, A, expense.id, {
      payerUserId: A,
      amount: 400,
      currency: "TWD",
      description: "corrected",
      day: "2026-08-01",
      split: { mode: "equal", participantUserIds: [A, B] },
    });

    expect(updated.amount).toBe(400);
  });

  it("lets the payer/creator still delete an expense in an archived group", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    const expense = await createExpense(deps, groupless({ groupId: group.id, split: { mode: "equal", participantUserIds: [A, B] } }));
    await archiveGroup(groups, A, group.id, NOW);

    await deleteExpense(expenses, A, expense.id);

    expect(await expenses.findById(expense.id)).toBeNull();
  });

  it("still shows an archived group's expenses to its members", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    const expense = await createExpense(deps, groupless({ groupId: group.id, split: { mode: "equal", participantUserIds: [A, B] } }));
    await archiveGroup(groups, A, group.id, NOW);

    const found = await getExpense({ expenses, groups }, B, expense.id);

    expect(found.id).toBe(expense.id);
  });
});
