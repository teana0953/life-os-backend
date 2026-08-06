import { beforeEach, describe, expect, it } from "vitest";
import { addGroupMember } from "../../../../src/contexts/split/application/add-group-member";
import { createExpense, type CreateExpenseDeps } from "../../../../src/contexts/split/application/create-expense";
import { createGroup } from "../../../../src/contexts/split/application/create-group";
import type { CreateExpenseInput } from "../../../../src/contexts/split/application/expense-input";
import { getBalances } from "../../../../src/contexts/split/application/get-balances";
import { createSettlement } from "../../../../src/contexts/split/application/create-settlement";
import { getGroupBalances } from "../../../../src/contexts/split/application/get-group-balances";
import { GroupNotFound } from "../../../../src/contexts/split/domain/errors";
import { InMemoryBalanceRepository, InMemoryExpenseGroupRepository, InMemoryFriendChecker, InMemorySettlementRepository, InMemorySplitExpenseRepository, noopSharesMirror, TestUserDirectory } from "../fakes";

const NOW = new Date("2026-08-01T00:00:00.000Z");
const A = "user-a";
const B = "user-b";
const C = "user-c";
const D = "user-d";

let groups: InMemoryExpenseGroupRepository;
let friends: InMemoryFriendChecker;
let expenses: InMemorySplitExpenseRepository;
let users: TestUserDirectory;
let balances: InMemoryBalanceRepository;
let settlements: InMemorySettlementRepository;
let deps: CreateExpenseDeps;

beforeEach(() => {
  groups = new InMemoryExpenseGroupRepository();
  friends = new InMemoryFriendChecker();
  expenses = new InMemorySplitExpenseRepository(groups);
  users = new TestUserDirectory();
  users.add(A, "Alice");
  users.add(B, "Bob");
  users.add(C, "Carol");
  users.add(D, "Dave");
  settlements = new InMemorySettlementRepository(groups, users);
  balances = new InMemoryBalanceRepository(expenses, groups, users, settlements);
  deps = { expenses, groups, friends, mirror: noopSharesMirror };
  friends.addFriendship(A, B);
  friends.addFriendship(A, C);
  friends.addFriendship(A, D);
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

describe("getBalances: per-currency, never converted", () => {
  it("keeps two currencies on separate lines with no combined total", async () => {
    await createExpense(deps, groupless({ split: { mode: "equal", participantUserIds: [A, B] } }));
    await createExpense(deps, groupless({ currency: "USD", amount: 100, split: { mode: "equal", participantUserIds: [A, B] } }));

    const result = await getBalances(balances, B);

    const withA = result.find((b) => b.userId === A)!;
    expect(withA.balances.sort((x, y) => x.currency.localeCompare(y.currency))).toEqual([
      { currency: "TWD", amount: -450 },
      { currency: "USD", amount: -50 },
    ]);
  });

  it("omits a currency once it nets to zero", async () => {
    await createExpense(deps, groupless({ amount: 100, split: { mode: "exact", shares: [{ userId: A, amount: 0 }, { userId: B, amount: 100 }] } }));
    await createExpense(deps, groupless({ payerUserId: B, amount: 100, split: { mode: "exact", shares: [{ userId: A, amount: 100 }, { userId: B, amount: 0 }] } }));

    const result = await getBalances(balances, A);

    expect(result.find((b) => b.userId === B)).toBeUndefined();
  });

  it("excludes the payer's own share from both sides", async () => {
    await createExpense(deps, groupless({ amount: 900, split: { mode: "equal", participantUserIds: [A, B, C] } }));

    const result = await getBalances(balances, A);

    // Nobody owes themselves.
    expect(result.find((b) => b.userId === A)).toBeUndefined();
    // A's own 300 share is not counted as owed to A.
    const withB = result.find((b) => b.userId === B)!;
    expect(withB.balances).toEqual([{ currency: "TWD", amount: 300 }]);
  });

  it("owes a pure advance in full", async () => {
    await createExpense(deps, groupless({ amount: 200, payerUserId: A, split: { mode: "exact", shares: [{ userId: B, amount: 200 }] } }));

    const result = await getBalances(balances, A);

    expect(result.find((b) => b.userId === B)?.balances).toEqual([{ currency: "TWD", amount: 200 }]);
  });
});

describe("getGroupBalances", () => {
  it("hides the group's balances from a non-member", async () => {
    const group = await createGroup(groups, "Trip", A);

    await expect(getGroupBalances({ balances, groups }, C, group.id)).rejects.toBeInstanceOf(GroupNotFound);
  });

  it("nets to zero per currency across every member — payer with no share, multiple currencies, an untouched member, and a subset of members participating", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    await addGroupMember({ groups, friends }, A, group.id, C, NOW);
    await addGroupMember({ groups, friends }, A, group.id, D, NOW); // D never appears in an expense.

    // A pays but holds no share (pure advance), only B and C split it — a strict subset of the group.
    await createExpense(
      deps,
      groupless({ groupId: group.id, amount: 900, payerUserId: A, split: { mode: "equal", participantUserIds: [B, C] } }),
    );
    // A different currency, different payer, different subset.
    await createExpense(
      deps,
      groupless({ groupId: group.id, currency: "USD", amount: 50, payerUserId: B, split: { mode: "equal", participantUserIds: [A, B] } }),
    );

    const result = await getGroupBalances({ balances, groups }, A, group.id);

    // Pin the shape first: summing an empty result to zero proves nothing,
    // and a sign flip on both union branches also nets to zero.
    expect(result.map((m) => m.userId).sort()).toEqual([A, B, C].sort());
    const figures = (userId: string) =>
      result
        .find((m) => m.userId === userId)!
        .balances.slice()
        .sort((x, y) => x.currency.localeCompare(y.currency));
    expect(figures(A)).toEqual([{ currency: "TWD", amount: 900 }, { currency: "USD", amount: -25 }]);
    expect(figures(B)).toEqual([{ currency: "TWD", amount: -450 }, { currency: "USD", amount: 25 }]);
    expect(figures(C)).toEqual([{ currency: "TWD", amount: -450 }]);

    const totalsByCurrency = new Map<string, number>();
    for (const member of result) {
      for (const balance of member.balances) {
        totalsByCurrency.set(balance.currency, (totalsByCurrency.get(balance.currency) ?? 0) + balance.amount);
      }
    }
    expect([...totalsByCurrency.keys()].sort()).toEqual(["TWD", "USD"]);
    for (const total of totalsByCurrency.values()) expect(total).toBe(0);

    // D genuinely never participated: no balances at all.
    const dEntry = result.find((m) => m.userId === D);
    expect(dEntry?.balances ?? []).toEqual([]);
  });

  // The group fold has its own sign convention (each row is keyed by the
  // member themselves, not by a counterpart), so the personal tests below do
  // not cover it. Assert a *named* member's signed figure: the sum-to-zero
  // property holds under either sign convention and proves nothing about
  // direction (design.md is explicit about this).
  it("a group repayment moves the payer up and the payee down by the same amount", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);

    // A pays 900 split equally with B: B owes A 450.
    await createExpense(deps, groupless({ groupId: group.id, amount: 900, payerUserId: A, split: { mode: "equal", participantUserIds: [A, B] } }));

    const before = await getGroupBalances({ balances, groups }, A, group.id);
    expect(before.find((m) => m.userId === A)?.balances).toEqual([{ currency: "TWD", amount: 450 }]);
    expect(before.find((m) => m.userId === B)?.balances).toEqual([{ currency: "TWD", amount: -450 }]);

    await createSettlement(
      { settlements, groups, friends },
      { callerUserId: B, groupId: group.id, fromUserId: B, toUserId: A, amount: 300, currency: "TWD", day: "2026-08-02", note: null },
    );

    // 450 owed, 300 repaid -> B is -150 and A is +150. The inverted sign would
    // give B -750 / A +750 and still sum to zero.
    const after = await getGroupBalances({ balances, groups }, A, group.id);
    expect(after.find((m) => m.userId === B)?.balances).toEqual([{ currency: "TWD", amount: -150 }]);
    expect(after.find((m) => m.userId === A)?.balances).toEqual([{ currency: "TWD", amount: 150 }]);
  });

  it("a settlement belonging to another scope leaves this group's figures untouched", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);
    const other = await createGroup(groups, "Ski", A);
    await addGroupMember({ groups, friends }, A, other.id, B, NOW);

    await createExpense(deps, groupless({ groupId: group.id, amount: 900, payerUserId: A, split: { mode: "equal", participantUserIds: [A, B] } }));

    // Same pair, same amount — but recorded against the other group, and once
    // with no group at all. Neither may touch "Trip".
    await createSettlement(
      { settlements, groups, friends },
      { callerUserId: B, groupId: other.id, fromUserId: B, toUserId: A, amount: 300, currency: "TWD", day: "2026-08-02", note: null },
    );
    await createSettlement(
      { settlements, groups, friends },
      { callerUserId: B, groupId: null, fromUserId: B, toUserId: A, amount: 300, currency: "TWD", day: "2026-08-02", note: null },
    );

    const result = await getGroupBalances({ balances, groups }, A, group.id);
    expect(result.find((m) => m.userId === A)?.balances).toEqual([{ currency: "TWD", amount: 450 }]);
    expect(result.find((m) => m.userId === B)?.balances).toEqual([{ currency: "TWD", amount: -450 }]);
  });

  // The signs live in two pure functions, but until now nothing exercised the
  // path from a recorded settlement to a reported balance — the use case, the
  // repository and the JSON in between were unverified. This does not prove
  // the real SQL (nothing in CI can), but it does prove that path carries a
  // settlement through, and in the right direction.
  it('a repayment reduces what is owed, and does not increase it', async () => {
    await createExpense(deps, {
      callerUserId: A,
      groupId: null,
      payerUserId: A,
      amount: 900,
      currency: 'TWD',
      description: 'Dinner',
      day: '2026-08-01',
      split: { mode: 'equal', participantUserIds: [A, B] },
    } as CreateExpenseInput);

    const before = await getBalances(balances, A);
    expect(before.find((entry) => entry.userId === B)?.balances).toEqual([{ currency: 'TWD', amount: 450 }]);

    await createSettlement(
      { settlements, groups, friends },
      { callerUserId: B, groupId: null, fromUserId: B, toUserId: A, amount: 300, currency: 'TWD', day: '2026-08-02', note: null },
    );

    // 450 owed, 300 repaid -> 150 owed. Not 750, which is what the inverted
    // sign would produce, silently.
    const afterA = await getBalances(balances, A);
    expect(afterA.find((entry) => entry.userId === B)?.balances).toEqual([{ currency: 'TWD', amount: 150 }]);

    // And the same fact from B's side, with the opposite sign.
    const afterB = await getBalances(balances, B);
    expect(afterB.find((entry) => entry.userId === A)?.balances).toEqual([{ currency: 'TWD', amount: -150 }]);
  });

  it('repaying in full settles the pair out of the listing entirely', async () => {
    await createExpense(deps, {
      callerUserId: A,
      groupId: null,
      payerUserId: A,
      amount: 900,
      currency: 'TWD',
      description: 'Dinner',
      day: '2026-08-01',
      split: { mode: 'equal', participantUserIds: [A, B] },
    } as CreateExpenseInput);
    await createSettlement(
      { settlements, groups, friends },
      { callerUserId: B, groupId: null, fromUserId: B, toUserId: A, amount: 450, currency: 'TWD', day: '2026-08-02', note: null },
    );

    expect((await getBalances(balances, A)).find((entry) => entry.userId === B)).toBeUndefined();
  });

  it('overpaying flips the balance rather than being refused', async () => {
    await createExpense(deps, {
      callerUserId: A,
      groupId: null,
      payerUserId: A,
      amount: 900,
      currency: 'TWD',
      description: 'Dinner',
      day: '2026-08-01',
      split: { mode: 'equal', participantUserIds: [A, B] },
    } as CreateExpenseInput);
    await createSettlement(
      { settlements, groups, friends },
      { callerUserId: B, groupId: null, fromUserId: B, toUserId: A, amount: 600, currency: 'TWD', day: '2026-08-02', note: null },
    );

    expect((await getBalances(balances, A)).find((entry) => entry.userId === B)?.balances).toEqual([
      { currency: 'TWD', amount: -150 },
    ]);
  });
});