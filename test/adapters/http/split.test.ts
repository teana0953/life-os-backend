import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { SplitActivity } from "../../../src/contexts/split/domain/split-activity";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";
import {
  InMemoryBalanceRepository,
  InMemoryExpenseGroupRepository,
  InMemoryFriendChecker,
  InMemorySettlementRepository,
  InMemorySplitActivityRepository,
  InMemorySplitExpenseRepository,
  TestUserDirectory,
} from "../../contexts/split/fakes";
import {
  FakeBudgetAlertNotifier,
  InMemoryFinanceBudgetRepository,
  InMemoryFinanceCategoryRepository,
  InMemoryFinanceTransactionRepository,
} from "../../contexts/finance/fakes";
import { stubFriendInviteRepository, stubFriendshipRepository } from "./social-stubs";

function notImplemented(): never {
  throw new Error("not implemented in this test's fakes");
}

const PROJECT_ID = "life-os-test";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KEY_ID = "test-key-1";

let signingKey: CryptoKey;
let jwks: JWTVerifyGetKey;

interface Identity {
  uid: string;
  email: string;
  name: string;
}

const ALICE: Identity = { uid: "uid-a", email: "alice@example.com", name: "Alice" };
const BOB: Identity = { uid: "uid-b", email: "bob@example.com", name: "Bob" };
const CAROL: Identity = { uid: "uid-c", email: "carol@example.com", name: "Carol" };

async function authHeader(identity: Identity): Promise<Record<string, string>> {
  const token = await new SignJWT({ email: identity.email, name: identity.name })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setSubject(identity.uid)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(PROJECT_ID)
    .setExpirationTime("1h")
    .sign(signingKey);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  signingKey = privateKey;
  const jwk = await exportJWK(publicKey);
  jwk.kid = KEY_ID;
  jwk.alg = "RS256";
  jwk.use = "sig";
  const keySet: JSONWebKeySet = { keys: [jwk] };
  jwks = createLocalJWKSet(keySet);
});

/** Mints real lowercase canonical UUIDs, since the routes reject anything else as a 404/400. */
class InMemoryUserRepository implements UserRepository {
  private usersByFirebaseUid = new Map<string, User>();

  constructor(private readonly directory: TestUserDirectory) {}

  async getOrCreate(input: GetOrCreateUserInput): Promise<User> {
    const existing = this.usersByFirebaseUid.get(input.firebaseUid);
    if (existing) return existing;
    const user: User = {
      id: crypto.randomUUID(),
      firebaseUid: input.firebaseUid,
      email: input.email,
      displayName: input.displayName,
      timezone: "Asia/Taipei",
      isAdmin: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    this.usersByFirebaseUid.set(input.firebaseUid, user);
    this.directory.add(user.id, user.displayName ?? user.email);
    return user;
  }

  async updateTimezone(): Promise<void> {
    notImplemented();
  }

  async getById(userId: string): Promise<User | null> {
    for (const user of this.usersByFirebaseUid.values()) {
      if (user.id === userId) return user;
    }
    return null;
  }
}

let userRepository: InMemoryUserRepository;
let groups: InMemoryExpenseGroupRepository;
let expenses: InMemorySplitExpenseRepository;
let friends: InMemoryFriendChecker;
let balances: InMemoryBalanceRepository;
let settlements: InMemorySettlementRepository;
let activity: InMemorySplitActivityRepository;
let financeCategories: InMemoryFinanceCategoryRepository;
let financeTransactions: InMemoryFinanceTransactionRepository;
let app: ReturnType<typeof createApp>;

/** Resolves `identity`'s internal uuid by calling a cheap authenticated endpoint. */
async function idOf(identity: Identity): Promise<string> {
  const res = await app.request("/api/me", { headers: await authHeader(identity) });
  const body = await res.json<{ id: string }>();
  return body.id;
}

beforeEach(() => {
  const directory = new TestUserDirectory();
  userRepository = new InMemoryUserRepository(directory);
  groups = new InMemoryExpenseGroupRepository(directory);
  // Real in-memory finance fakes, not throwing stubs: `createApp` composes a
  // `FinanceSharesMirror` out of them, so every expense written here resolves
  // a category and writes a mirror for real.
  financeCategories = new InMemoryFinanceCategoryRepository();
  financeTransactions = new InMemoryFinanceTransactionRepository();
  expenses = new InMemorySplitExpenseRepository(groups, directory, financeTransactions);
  friends = new InMemoryFriendChecker();
  settlements = new InMemorySettlementRepository(groups, directory);
  activity = new InMemorySplitActivityRepository(groups);
  balances = new InMemoryBalanceRepository(expenses, groups, directory, settlements);

  app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository,
    foodDictionaryRepository: {
      search: notImplemented,
      findById: notImplemented,
      createCustom: notImplemented,
      favorite: notImplemented,
      unfavorite: notImplemented,
      listFavorites: notImplemented,
      findSharedById: notImplemented,
      createShared: notImplemented,
      updateSharedById: notImplemented,
    },
    mealRepository: {
      upsertMealWithItems: notImplemented,
      createMeals: notImplemented,
      listMealsByDay: notImplemented,
      listMealsInRange: notImplemented,
      listLoggedDays: notImplemented,
      updateMealTime: notImplemented,
      deleteMeal: notImplemented,
      updateItem: notImplemented,
      deleteItem: notImplemented,
    },
    dailyTargetRepository: {
      get: notImplemented,
      getLatestOnOrBefore: notImplemented,
      listInRange: notImplemented,
      set: notImplemented,
      setMany: notImplemented,
    },
    waterRepository: {
      getIntake: notImplemented,
      addIntake: notImplemented,
      addIntakeMany: notImplemented,
      listIntakeRange: notImplemented,
      getTarget: notImplemented,
      getLatestTargetOnOrBefore: notImplemented,
      listTargetRange: notImplemented,
      setTarget: notImplemented,
      setTargetMany: notImplemented,
    },
    bowelRepository: { get: notImplemented, set: notImplemented, setMany: notImplemented, listRange: notImplemented },
    vitalsRepository: {
      get: notImplemented,
      set: notImplemented,
      setMany: notImplemented,
      getLatestWeight: notImplemented,
      getEarliestWeight: notImplemented,
      getWeightDayCount: notImplemented,
      listRange: notImplemented,
    },
    exerciseRepository: { addEntry: notImplemented, listByDay: notImplemented, deleteEntry: notImplemented },
    menstrualRepository: { add: notImplemented, listByUser: notImplemented, update: notImplemented, delete: notImplemented },
    bodyProfileRepository: { get: notImplemented, upsert: notImplemented },
    healthCalendarRepository: { listLoggedDays: notImplemented },
    chaodaysClient: {
      signIn: notImplemented,
      fetchWeightRecords: notImplemented,
      fetchDietRecords: notImplemented,
      fetchWaterRecords: notImplemented,
      fetchDefecationRecords: notImplemented,
      fetchDietMenus: notImplemented,
      fetchMenstruals: notImplemented,
    },
    pushSubscriptionRepository: { upsert: notImplemented, listByUser: notImplemented, deleteByEndpoint: notImplemented },
    pushSender: { send: notImplemented },
    vapidPublicKey: "",
    careItemRepository: {
      create: notImplemented,
      listByUser: notImplemented,
      get: notImplemented,
      getByScheduleId: notImplemented,
      update: notImplemented,
      delete: notImplemented,
      listActiveSchedules: notImplemented,
      listActiveSchedulesForUserOn: notImplemented,
      decrementStock: notImplemented,
      incrementStock: notImplemented,
    },
    careLogRepository: {
      upsertIfAbsent: notImplemented,
      getBySlot: notImplemented,
      listByUserAndDate: notImplemented,
      listByUserAndDateRange: notImplemented,
      upsert: notImplemented,
    },
    financeCategoryRepository: financeCategories,
    financeTransactionRepository: financeTransactions,
    financeBudgetRepository: new InMemoryFinanceBudgetRepository(financeTransactions),
    financeNetWorthRepository: {
      listAccounts: notImplemented,
      findAccountById: notImplemented,
      findAccountByUserKindName: notImplemented,
      createAccount: notImplemented,
      updateAccount: notImplemented,
      reorderAccounts: notImplemented,
      insertDefaultAccountsIfMissing: notImplemented,
      upsertSnapshot: notImplemented,
      listMonthValues: notImplemented,
      getMonthlyTotals: notImplemented,
      findPreviousSnapshotMonth: notImplemented,
      getTrend: notImplemented,
    },
    installmentPlanRepository: {
      createWithInstallments: notImplemented,
      findById: notImplemented,
      listInstallments: notImplemented,
      rewriteUpcoming: notImplemented,
      settle: notImplemented,
    },
    budgetAlertNotifier: new FakeBudgetAlertNotifier(),
    friendshipRepository: stubFriendshipRepository,
    friendInviteRepository: stubFriendInviteRepository,
    expenseGroupRepository: groups,
    splitExpenseRepository: expenses,
    splitBalanceRepository: balances,
    splitFriendChecker: friends,
    splitSettlementRepository: settlements,
    splitActivityRepository: activity,
    splitSpendingRepository: expenses,
    ping: async () => {},
  });
});

async function makeFriends(a: Identity, b: Identity): Promise<void> {
  friends.addFriendship(await idOf(a), await idOf(b));
}

async function createGroupAs(identity: Identity, name = "Trip"): Promise<{ id: string }> {
  const res = await app.request("/api/split/groups", { method: "POST", headers: await authHeader(identity), body: JSON.stringify({ name }) });
  expect(res.status).toBe(201);
  return res.json<{ id: string }>();
}

interface ExpenseSpec {
  groupId?: string | null;
  payerUserId: string;
  amount: number;
  currency?: string;
  description?: string;
  day?: string;
  /** Sent only when the key is present, so "no `category_name` at all" stays testable — `undefined` would be indistinguishable from `null` after `JSON.stringify`. */
  categoryName?: unknown;
  split: { mode: "equal"; participant_user_ids: string[] } | { mode: "exact"; shares: { user_id: string; amount: number }[] };
}

async function createExpenseAs(identity: Identity, spec: ExpenseSpec): Promise<Response> {
  const body: Record<string, unknown> = {
    group_id: spec.groupId ?? null,
    payer_user_id: spec.payerUserId,
    amount: spec.amount,
    currency: spec.currency ?? "TWD",
    description: spec.description ?? "dinner",
    day: spec.day ?? "2026-08-01",
    split: spec.split,
  };
  if ("categoryName" in spec) body.category_name = spec.categoryName;
  return app.request("/api/split/expenses", {
    method: "POST",
    headers: await authHeader(identity),
    body: JSON.stringify(body),
  });
}

describe("split routes: authentication", () => {
  it("rejects every endpoint without a token", async () => {
    const zeroId = "00000000-0000-4000-8000-000000000000";
    const calls: Array<[string, string]> = [
      ["GET", "/api/split/groups"],
      ["POST", "/api/split/groups"],
      ["GET", `/api/split/groups/${zeroId}`],
      ["POST", `/api/split/groups/${zeroId}/members`],
      ["DELETE", `/api/split/groups/${zeroId}`],
      ["GET", `/api/split/groups/${zeroId}/balances`],
      ["GET", "/api/split/expenses"],
      ["POST", "/api/split/expenses"],
      ["GET", `/api/split/expenses/${zeroId}`],
      ["PATCH", `/api/split/expenses/${zeroId}`],
      ["DELETE", `/api/split/expenses/${zeroId}`],
      ["GET", "/api/split/balances"],
      ["GET", "/api/split/settlements"],
      ["POST", "/api/split/settlements"],
      ["DELETE", `/api/split/settlements/${zeroId}`],
    ];
    for (const [method, path] of calls) {
      const res = await app.request(path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });
});

describe("groups", () => {
  it("makes the creator a member, visible to them but 404 to a stranger", async () => {
    const group = await createGroupAs(ALICE);

    const asAlice = await app.request(`/api/split/groups/${group.id}`, { headers: await authHeader(ALICE) });
    expect(asAlice.status).toBe(200);
    const body = await asAlice.json<{ members: Array<{ user_id: string }> }>();
    expect(body.members).toHaveLength(1);

    const asCarol = await app.request(`/api/split/groups/${group.id}`, { headers: await authHeader(CAROL) });
    expect(asCarol.status).toBe(404);
    expect(await asCarol.json()).toEqual({ error: "not_found" });
  });

  it("names every member, so a settled member is not a bare uuid on screen", async () => {
    // `balances` is the only other endpoint carrying names and it omits anyone
    // netting to zero, so without this a settled group member has no name the
    // client can render.
    const group = await createGroupAs(ALICE);
    await makeFriends(ALICE, BOB);
    const bobId = await idOf(BOB);
    await app.request(`/api/split/groups/${group.id}/members`, {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({ user_id: bobId }),
    });

    const detail = await app.request(`/api/split/groups/${group.id}`, { headers: await authHeader(ALICE) });
    const detailBody = await detail.json<{ members: Array<{ user_id: string; display_name: string }> }>();
    expect(detailBody.members.map((m) => m.display_name).sort()).toEqual(["Alice", "Bob"]);

    // And the listing carries them too, so rendering a grouped expense does
    // not need one request per group.
    const list = await app.request("/api/split/groups", { headers: await authHeader(ALICE) });
    const listBody = await list.json<{ groups: Array<{ members: Array<{ display_name: string }> }> }>();
    expect(listBody.groups[0].members.map((m) => m.display_name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("lets a member add a friend, but not a stranger", async () => {
    const group = await createGroupAs(ALICE);
    await makeFriends(ALICE, BOB);
    const bobId = await idOf(BOB);
    const carolId = await idOf(CAROL);

    const strangerRes = await app.request(`/api/split/groups/${group.id}/members`, {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({ user_id: carolId }),
    });
    expect(strangerRes.status).toBe(400);
    expect(await strangerRes.json()).toEqual({ error: "not_friends" });

    const friendRes = await app.request(`/api/split/groups/${group.id}/members`, {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({ user_id: bobId }),
    });
    expect(friendRes.status).toBe(201);
  });

  it("rejects re-adding an existing member with a readable 400", async () => {
    const group = await createGroupAs(ALICE);
    await makeFriends(ALICE, BOB);
    const bobId = await idOf(BOB);
    const add = async () =>
      app.request(`/api/split/groups/${group.id}/members`, {
        method: "POST",
        headers: await authHeader(ALICE),
        body: JSON.stringify({ user_id: bobId }),
      });

    expect((await add()).status).toBe(201);
    const again = await add();
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "already_a_group_member" });
  });

  it("archives for the creator, 404s for anyone else, and keeps history readable after", async () => {
    const group = await createGroupAs(ALICE);
    await makeFriends(ALICE, BOB);
    const bobId = await idOf(BOB);
    await app.request(`/api/split/groups/${group.id}/members`, { method: "POST", headers: await authHeader(ALICE), body: JSON.stringify({ user_id: bobId }) });

    const byBob = await app.request(`/api/split/groups/${group.id}`, { method: "DELETE", headers: await authHeader(BOB) });
    expect(byBob.status).toBe(404);

    const byAlice = await app.request(`/api/split/groups/${group.id}`, { method: "DELETE", headers: await authHeader(ALICE) });
    expect(byAlice.status).toBe(200);

    const stillReadable = await app.request(`/api/split/groups/${group.id}`, { headers: await authHeader(BOB) });
    expect(stillReadable.status).toBe(200);
  });

  it("answers 404 for a malformed group id", async () => {
    const res = await app.request("/api/split/groups/not-a-uuid", { headers: await authHeader(ALICE) });
    expect(res.status).toBe(404);
  });
});

describe("expenses: creation and visibility", () => {
  it("names the payer even when they hold no share", async () => {
    // A payer who merely fronted the money holds no share, so their name
    // cannot be derived from the shares — and a co-participant reading the
    // expense has no other source for it.
    await makeFriends(ALICE, BOB);
    await makeFriends(ALICE, CAROL);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);
    const carolId = await idOf(CAROL);

    const createRes = await createExpenseAs(ALICE, {
      payerUserId: aliceId,
      amount: 900,
      split: { mode: "exact", shares: [{ user_id: bobId, amount: 450 }, { user_id: carolId, amount: 450 }] },
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json<{ payer_display_name: string; id: string }>();
    expect(created.payer_display_name).toBe("Alice");

    const asBob = await app.request(`/api/split/expenses/${created.id}`, { headers: await authHeader(BOB) });
    const body = await asBob.json<{ payer_display_name: string; shares: Array<{ display_name: string }> }>();
    expect(body.payer_display_name).toBe("Alice");
    // Alice is not among the shares, so this is the only place her name appears.
    expect(body.shares.map((s) => s.display_name).sort()).toEqual(["Bob", "Carol"]);
  });

  it("names every share holder, including a co-participant the reader does not know", async () => {
    // The friendship rule is checked against the *writer* only, while every
    // share holder can read the expense — so Bob sees Carol, who is neither
    // his friend nor in any group with him. Nothing else on the client could
    // resolve her name, and the three-way one-off split is the commonest
    // case there is.
    await makeFriends(ALICE, BOB);
    await makeFriends(ALICE, CAROL);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);
    const carolId = await idOf(CAROL);

    const createRes = await createExpenseAs(ALICE, {
      payerUserId: aliceId,
      amount: 900,
      split: { mode: "equal", participant_user_ids: [aliceId, bobId, carolId] },
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json<{ id: string }>();

    const asBob = await app.request(`/api/split/expenses/${created.id}`, { headers: await authHeader(BOB) });
    expect(asBob.status).toBe(200);
    const body = await asBob.json<{ shares: Array<{ user_id: string; display_name: string }> }>();
    expect(body.shares.map((share) => share.display_name).sort()).toEqual(["Alice", "Bob", "Carol"]);
  });


  it("creates a groupless expense between friends, visible to the payer and share holders, 404 to a stranger", async () => {
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);

    const created = await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 900, split: { mode: "equal", participant_user_ids: [aliceId, bobId] } });
    expect(created.status).toBe(201);
    const expense = await created.json<{ id: string; shares: Array<{ user_id: string; amount: number }> }>();
    expect(expense.shares.reduce((sum, s) => sum + s.amount, 0)).toBe(900);

    const asBob = await app.request(`/api/split/expenses/${expense.id}`, { headers: await authHeader(BOB) });
    expect(asBob.status).toBe(200);

    const asCarol = await app.request(`/api/split/expenses/${expense.id}`, { headers: await authHeader(CAROL) });
    expect(asCarol.status).toBe(404);
  });

  it("rejects a debt fabricated between two other people (caller not in the expense)", async () => {
    await makeFriends(ALICE, BOB);
    await makeFriends(ALICE, CAROL);
    const bobId = await idOf(BOB);
    const carolId = await idOf(CAROL);

    const res = await createExpenseAs(ALICE, { payerUserId: bobId, amount: 500, split: { mode: "exact", shares: [{ user_id: carolId, amount: 500 }] } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_a_participant" });
  });

  it("rejects shares that do not sum to the amount, with a message stating the discrepancy", async () => {
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);

    const res = await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 900, split: { mode: "exact", shares: [{ user_id: bobId, amount: 800 }] } });
    expect(res.status).toBe(400);
    expect(await res.json<{ error: string }>()).toMatchObject({ error: "shares_do_not_sum_to_amount" });
  });

  it("rejects a numeric string amount instead of coercing it", async () => {
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);

    const stringAmount = await app.request("/api/split/expenses", {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({
        group_id: null,
        payer_user_id: aliceId,
        amount: "100",
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "equal", participant_user_ids: [aliceId, bobId] },
      }),
    });
    expect(stringAmount.status).toBe(400);

    const stringShareAmount = await app.request("/api/split/expenses", {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({
        group_id: null,
        payer_user_id: aliceId,
        amount: 100,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "exact", shares: [{ user_id: bobId, amount: "100" }] },
      }),
    });
    expect(stringShareAmount.status).toBe(400);
  });

  it("stores a category name verbatim, treats an empty one as none, and defaults to none", async () => {
    // The name is what every participant's mirror resolves against, and it is
    // stored exactly as typed: trimming it would contradict "reading them back
    // returns the name that was given" and finance category names are
    // themselves stored as the user typed them.
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);
    const split = { mode: "equal" as const, participant_user_ids: [aliceId, bobId] };

    const named = await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 900, categoryName: " 餐飲 ", split });
    expect(named.status).toBe(201);
    expect(await named.json<{ category_name: string | null }>()).toMatchObject({ category_name: " 餐飲 " });

    const empty = await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 900, categoryName: "", split });
    expect(empty.status).toBe(201);
    expect(await empty.json<{ category_name: string | null }>()).toMatchObject({ category_name: null });

    const absent = await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 900, split });
    expect(absent.status).toBe(201);
    const created = await absent.json<{ id: string; category_name: string | null }>();
    expect(created.category_name).toBeNull();

    // And it survives the read path, not just the write's echo.
    const read = await app.request(`/api/split/expenses/${created.id}`, { headers: await authHeader(BOB) });
    expect(await read.json<{ category_name: string | null }>()).toMatchObject({ category_name: null });
  });

  it("rejects a category name that is not a string or is longer than the cap", async () => {
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);
    const split = { mode: "equal" as const, participant_user_ids: [aliceId, bobId] };

    const notAString = await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 900, categoryName: 7, split });
    expect(notAString.status).toBe(400);

    const atCap = await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 900, categoryName: "餐".repeat(100), split });
    expect(atCap.status).toBe(201);

    const overCap = await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 900, categoryName: "餐".repeat(101), split });
    expect(overCap.status).toBe(400);
  });

  it("hands every schedule to the client in snake_case, one entry per expense", async () => {
    // The wire contract, which no other test here reaches: the repository's
    // schedule progress is a list (two things split with the same friend in
    // the same currency are two schedules), and the transcription to JSON is
    // the only place those keys get their snake_case names. Stubbing the
    // repository rather than driving it through a fake is deliberate — the
    // in-memory fake does not compute progress, so making it do so would be
    // testing the fake's agreement with itself.
    const bobId = await idOf(BOB);
    balances.balancesForUser = async () => [
      {
        userId: bobId,
        displayName: "Bob",
        balances: [
          {
            currency: "TWD",
            amount: 11400,
            schedules: [
              { expenseId: "e1", nextPeriod: 3, totalPeriods: 12, periodAmount: 500 },
              { expenseId: "e2", nextPeriod: 1, totalPeriods: 6, periodAmount: 900 },
            ],
          },
        ],
      },
    ];

    const res = await app.request("/api/split/balances", { headers: await authHeader(ALICE) });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { balances: unknown[] }).balances).toEqual([
      {
        user_id: bobId,
        display_name: "Bob",
        balances: [
          {
            currency: "TWD",
            amount: 11400,
            schedules: [
              { expense_id: "e1", next_period: 3, total_periods: 12, period_amount: 500 },
              { expense_id: "e2", next_period: 1, total_periods: 6, period_amount: 900 },
            ],
          },
        ],
      },
    ]);
  });

  it("gives a scheduled share back in the same spelling it accepts", async () => {
    // The round trip is the point: an edit sends the whole share list, so a
    // schedule the client cannot read is a schedule the next edit deletes.
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);

    const created = await app.request("/api/split/expenses", {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({
        group_id: null,
        payer_user_id: aliceId,
        amount: 3000,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "exact", shares: [{ user_id: bobId, amount: 3000, schedule: { periods: 6, per_period_amount: 500 } }] },
      }),
    });
    expect(created.status).toBe(201);
    const { id } = await created.json<{ id: string }>();

    const read = await app.request(`/api/split/expenses/${id}`, { headers: await authHeader(ALICE) });
    const body = await read.json<{ shares: Array<Record<string, unknown>> }>();

    expect(body.shares[0]).toEqual({
      user_id: bobId,
      display_name: expect.any(String),
      amount: 3000,
      schedule: { periods: 6, per_period_amount: 500 },
    });
  });

  it("rejects a repayment schedule when periods * per_period_amount does not equal the share amount", async () => {
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);

    // Valid schedule: 6 periods × 500 = 3000
    const validRes = await app.request("/api/split/expenses", {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({
        group_id: null,
        payer_user_id: aliceId,
        amount: 3000,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "exact", shares: [{ user_id: bobId, amount: 3000, schedule: { periods: 6, per_period_amount: 500 } }] },
      }),
    });
    expect(validRes.status).toBe(201);

    // Invalid: 6 periods × 500 = 3000, but share amount is 3100
    const invalidTooHigh = await app.request("/api/split/expenses", {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({
        group_id: null,
        payer_user_id: aliceId,
        amount: 3100,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "exact", shares: [{ user_id: bobId, amount: 3100, schedule: { periods: 6, per_period_amount: 500 } }] },
      }),
    });
    expect(invalidTooHigh.status).toBe(400);

    // Invalid: 12 periods × 500 = 6000, but share amount is 5000
    const invalidTooLow = await app.request("/api/split/expenses", {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({
        group_id: null,
        payer_user_id: aliceId,
        amount: 5000,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "exact", shares: [{ user_id: bobId, amount: 5000, schedule: { periods: 12, per_period_amount: 500 } }] },
      }),
    });
    expect(invalidTooLow.status).toBe(400);
  });

  it("answers 404 for a malformed expense id and 400 for a malformed share id in the body", async () => {
    const aliceId = await idOf(ALICE);

    const getRes = await app.request("/api/split/expenses/not-a-uuid", { headers: await authHeader(ALICE) });
    expect(getRes.status).toBe(404);

    const createRes = await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 100, split: { mode: "exact", shares: [{ user_id: "not-a-uuid", amount: 100 }] } });
    expect(createRes.status).toBe(400);
  });
});

describe("expenses: editing and deleting", () => {
  it("lets the creator and payer edit or delete, but 404s a non-owner participant", async () => {
    await makeFriends(ALICE, BOB);
    await makeFriends(ALICE, CAROL);
    await makeFriends(BOB, CAROL);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);
    const carolId = await idOf(CAROL);

    const created = await createExpenseAs(ALICE, {
      payerUserId: bobId,
      amount: 1000,
      split: { mode: "exact", shares: [{ user_id: aliceId, amount: 500 }, { user_id: carolId, amount: 500 }] },
    });
    expect(created.status).toBe(201);
    const expense = await created.json<{ id: string }>();

    const byCarol = await app.request(`/api/split/expenses/${expense.id}`, {
      method: "PATCH",
      headers: await authHeader(CAROL),
      body: JSON.stringify({ payer_user_id: bobId, amount: 1000, currency: "TWD", description: "dinner", day: "2026-08-01", split: { mode: "exact", shares: [{ user_id: carolId, amount: 1000 }] } }),
    });
    expect(byCarol.status).toBe(404);

    const byPayer = await app.request(`/api/split/expenses/${expense.id}`, {
      method: "PATCH",
      headers: await authHeader(BOB),
      body: JSON.stringify({ payer_user_id: bobId, amount: 1200, currency: "TWD", description: "dinner", day: "2026-08-01", split: { mode: "exact", shares: [{ user_id: aliceId, amount: 600 }, { user_id: carolId, amount: 600 }] } }),
    });
    expect(byPayer.status).toBe(200);

    const deleted = await app.request(`/api/split/expenses/${expense.id}`, { method: "DELETE", headers: await authHeader(BOB) });
    expect(deleted.status).toBe(200);
  });

  it("edits the category name through PATCH, including clearing it with an empty string", async () => {
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);

    const created = await createExpenseAs(ALICE, {
      payerUserId: aliceId,
      amount: 900,
      categoryName: "餐飲",
      split: { mode: "equal", participant_user_ids: [aliceId, bobId] },
    });
    const expense = await created.json<{ id: string }>();

    const patch = async (categoryName: unknown) =>
      app.request(`/api/split/expenses/${expense.id}`, {
        method: "PATCH",
        headers: await authHeader(ALICE),
        body: JSON.stringify({
          payer_user_id: aliceId,
          amount: 900,
          currency: "TWD",
          description: "dinner",
          day: "2026-08-01",
          category_name: categoryName,
          split: { mode: "equal", participant_user_ids: [aliceId, bobId] },
        }),
      });

    const changed = await patch("娛樂");
    expect(changed.status).toBe(200);
    expect(await changed.json<{ category_name: string | null }>()).toMatchObject({ category_name: "娛樂" });

    const cleared = await patch("");
    expect(cleared.status).toBe(200);
    expect(await cleared.json<{ category_name: string | null }>()).toMatchObject({ category_name: null });

    expect((await patch("餐".repeat(101))).status).toBe(400);
  });

  it("clears the category name when a PATCH omits it, like every other field it omits", async () => {
    // `PATCH` here is a full replacement, not a partial one: it already
    // requires payer, amount, currency, description, day and split on every
    // call, and an omitted one is not "keep what was there". `category_name`
    // follows that rule rather than being the single sticky field, so a
    // client that leaves it out clears it — and every share holder's mirror
    // moves to their 其他 with it. Written down because it is the kind of
    // thing a frontend discovers by losing data.
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);

    const created = await createExpenseAs(ALICE, {
      payerUserId: aliceId,
      amount: 900,
      categoryName: "餐飲",
      split: { mode: "equal", participant_user_ids: [aliceId, bobId] },
    });
    const expense = await created.json<{ id: string }>();

    const res = await app.request(`/api/split/expenses/${expense.id}`, {
      method: "PATCH",
      headers: await authHeader(ALICE),
      body: JSON.stringify({
        payer_user_id: aliceId,
        amount: 900,
        currency: "TWD",
        description: "dinner",
        day: "2026-08-01",
        split: { mode: "equal", participant_user_ids: [aliceId, bobId] },
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json<{ category_name: string | null }>()).toMatchObject({ category_name: null });
    const read = await app.request(`/api/split/expenses/${expense.id}`, { headers: await authHeader(BOB) });
    expect(await read.json<{ category_name: string | null }>()).toMatchObject({ category_name: null });
  });
});

describe("GET /api/split/expenses filters", () => {
  it("400s a malformed 'with' id and 404s a malformed group_id", async () => {
    const badWith = await app.request("/api/split/expenses?with=not-a-uuid", { headers: await authHeader(ALICE) });
    expect(badWith.status).toBe(400);

    const badGroup = await app.request("/api/split/expenses?group_id=not-a-uuid", { headers: await authHeader(ALICE) });
    expect(badGroup.status).toBe(404);
  });

  it("rejects group_id and with given together", async () => {
    const group = await createGroupAs(ALICE);
    const bobId = await idOf(BOB);
    const res = await app.request(`/api/split/expenses?group_id=${group.id}&with=${bobId}`, { headers: await authHeader(ALICE) });
    expect(res.status).toBe(400);
  });
});

describe("balances", () => {
  it("nets a two-currency pair on separate lines, and answers empty when nothing is shared", async () => {
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);

    await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 900, currency: "TWD", split: { mode: "equal", participant_user_ids: [aliceId, bobId] } });
    await createExpenseAs(ALICE, { payerUserId: aliceId, amount: 100, currency: "USD", split: { mode: "equal", participant_user_ids: [aliceId, bobId] } });

    const res = await app.request("/api/split/balances", { headers: await authHeader(ALICE) });
    expect(res.status).toBe(200);
    const body = await res.json<{ balances: Array<{ user_id: string; balances: Array<{ currency: string; amount: number }> }> }>();
    expect(body.balances).toHaveLength(1);
    expect(body.balances[0].user_id).toBe(bobId);
    expect(body.balances[0].balances.map((b) => b.currency).sort()).toEqual(["TWD", "USD"]);

    const carolRes = await app.request("/api/split/balances", { headers: await authHeader(CAROL) });
    expect(await carolRes.json()).toEqual({ balances: [] });
  });

  it("group balances nets to zero across members and answers 404 to a non-member", async () => {
    const group = await createGroupAs(ALICE);
    await makeFriends(ALICE, BOB);
    const bobId = await idOf(BOB);
    await app.request(`/api/split/groups/${group.id}/members`, { method: "POST", headers: await authHeader(ALICE), body: JSON.stringify({ user_id: bobId }) });
    const aliceId = await idOf(ALICE);

    await createExpenseAs(ALICE, { groupId: group.id, payerUserId: aliceId, amount: 900, split: { mode: "equal", participant_user_ids: [aliceId, bobId] } });

    const res = await app.request(`/api/split/groups/${group.id}/balances`, { headers: await authHeader(ALICE) });
    expect(res.status).toBe(200);
    const body = await res.json<{ balances: Array<{ user_id: string; balances: Array<{ currency: string; amount: number }> }> }>();
    // Assert the members are actually there first — an empty list also sums to zero.
    expect(body.balances.map((b) => b.user_id).sort()).toEqual([aliceId, bobId].sort());
    expect(body.balances.find((b) => b.user_id === aliceId)?.balances).toEqual([{ currency: "TWD", amount: 450 }]);
    expect(body.balances.find((b) => b.user_id === bobId)?.balances).toEqual([{ currency: "TWD", amount: -450 }]);
    const total = body.balances.flatMap((b) => b.balances).reduce((sum, b) => sum + b.amount, 0);
    expect(total).toBe(0);

    const carolRes = await app.request(`/api/split/groups/${group.id}/balances`, { headers: await authHeader(CAROL) });
    expect(carolRes.status).toBe(404);
  });
});

describe("settlements", () => {
  it("records a repayment naming both people, visible to the payer and payee, 404 to a stranger", async () => {
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);

    const created = await app.request("/api/split/settlements", {
      method: "POST",
      headers: await authHeader(BOB),
      body: JSON.stringify({ group_id: null, from_user_id: bobId, to_user_id: aliceId, amount: 450, currency: "TWD", day: "2026-08-01", note: null }),
    });
    expect(created.status).toBe(201);
    const settlement = await created.json<{ id: string; from_user_id: string; to_user_id: string; amount: number }>();
    expect(settlement).toMatchObject({ from_user_id: bobId, to_user_id: aliceId, amount: 450 });

    const asAlice = await app.request(`/api/split/settlements?with=${bobId}`, { headers: await authHeader(ALICE) });
    expect(asAlice.status).toBe(200);
    const aliceBody = await asAlice.json<{ settlements: Array<{ id: string }> }>();
    expect(aliceBody.settlements.map((s) => s.id)).toEqual([settlement.id]);

    const asCarol = await app.request("/api/split/settlements", { headers: await authHeader(CAROL) });
    expect(await asCarol.json()).toEqual({ settlements: [] });
  });

  it("rejects a settlement fabricated between two other people (caller not in it)", async () => {
    await makeFriends(ALICE, BOB);
    await makeFriends(ALICE, CAROL);
    const bobId = await idOf(BOB);
    const carolId = await idOf(CAROL);

    const res = await app.request("/api/split/settlements", {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({ group_id: null, from_user_id: bobId, to_user_id: carolId, amount: 100, currency: "TWD", day: "2026-08-01", note: null }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_a_participant" });
  });

  it("rejects paying yourself with a typed 400", async () => {
    const aliceId = await idOf(ALICE);
    const res = await app.request("/api/split/settlements", {
      method: "POST",
      headers: await authHeader(ALICE),
      body: JSON.stringify({ group_id: null, from_user_id: aliceId, to_user_id: aliceId, amount: 100, currency: "TWD", day: "2026-08-01", note: null }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "cannot_settle_with_self" });
  });

  it("lets the payer delete, 404s a payee who neither created it nor paid it, and answers 404 for a malformed id", async () => {
    await makeFriends(ALICE, BOB);
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);

    const created = await app.request("/api/split/settlements", {
      method: "POST",
      headers: await authHeader(BOB),
      body: JSON.stringify({ group_id: null, from_user_id: bobId, to_user_id: aliceId, amount: 450, currency: "TWD", day: "2026-08-01", note: null }),
    });
    const settlement = await created.json<{ id: string }>();

    const byPayee = await app.request(`/api/split/settlements/${settlement.id}`, { method: "DELETE", headers: await authHeader(ALICE) });
    expect(byPayee.status).toBe(404);

    const malformed = await app.request("/api/split/settlements/not-a-uuid", { method: "DELETE", headers: await authHeader(BOB) });
    expect(malformed.status).toBe(404);

    const byPayer = await app.request(`/api/split/settlements/${settlement.id}`, { method: "DELETE", headers: await authHeader(BOB) });
    expect(byPayer.status).toBe(200);
  });

  it("a grouped settlement is visible to a fellow group member and moves both balance screens", async () => {
    // `InMemoryBalanceRepository` is constructed with the settlement
    // repository here, and folds settlements in through the same pure
    // functions the real CTEs were transcribed from — so the route -> use
    // case -> repository -> JSON path can be asserted end to end. That is the
    // fake, not the SQL: design.md is explicit that nothing in this repo's CI
    // can verify `DrizzleBalanceRepository`'s query (no Postgres path in
    // either Vitest project), so the real proof is still exercising both
    // balance screens on real accounts.
    const group = await createGroupAs(ALICE);
    await makeFriends(ALICE, BOB);
    await makeFriends(ALICE, CAROL);
    const bobId = await idOf(BOB);
    const aliceId = await idOf(ALICE);
    await app.request(`/api/split/groups/${group.id}/members`, { method: "POST", headers: await authHeader(ALICE), body: JSON.stringify({ user_id: bobId }) });
    const carolId = await idOf(CAROL);
    await app.request(`/api/split/groups/${group.id}/members`, { method: "POST", headers: await authHeader(ALICE), body: JSON.stringify({ user_id: carolId }) });

    // Alice pays 900 for the group, split with Bob: Bob owes her 450.
    await createExpenseAs(ALICE, { groupId: group.id, payerUserId: aliceId, amount: 900, split: { mode: "equal", participant_user_ids: [aliceId, bobId] } });

    const created = await app.request("/api/split/settlements", {
      method: "POST",
      headers: await authHeader(BOB),
      body: JSON.stringify({ group_id: group.id, from_user_id: bobId, to_user_id: aliceId, amount: 300, currency: "TWD", day: "2026-08-02", note: null }),
    });
    const settlement = await created.json<{ id: string }>();

    // Carol is neither the payer nor the payee, only a fellow group member.
    const asCarol = await app.request(`/api/split/settlements?group_id=${group.id}`, { headers: await authHeader(CAROL) });
    expect(asCarol.status).toBe(200);
    const carolBody = await asCarol.json<{ settlements: Array<{ id: string }> }>();
    expect(carolBody.settlements.map((s) => s.id)).toEqual([settlement.id]);

    // 450 owed, 300 repaid -> 150. Named and signed on both screens: the
    // zero-sum alone would survive an inverted fold.
    type BalancesBody = { balances: Array<{ user_id: string; balances: Array<{ currency: string; amount: number }> }> };
    const personal = await (await app.request("/api/split/balances", { headers: await authHeader(ALICE) })).json<BalancesBody>();
    expect(personal.balances.find((b) => b.user_id === bobId)?.balances).toEqual([{ currency: "TWD", amount: 150 }]);

    const groupBalances = await (await app.request(`/api/split/groups/${group.id}/balances`, { headers: await authHeader(ALICE) })).json<BalancesBody>();
    expect(groupBalances.balances.find((b) => b.user_id === aliceId)?.balances).toEqual([{ currency: "TWD", amount: 150 }]);
    expect(groupBalances.balances.find((b) => b.user_id === bobId)?.balances).toEqual([{ currency: "TWD", amount: -150 }]);
  });
});

/**
 * `GET /api/split/activity`. What is proven here is the route: auth, query
 * parsing, paging and the JSON shape. **Not** who may see an entry — the fake
 * repository mirrors that rule but does not execute the SQL that enforces it,
 * which is proven in `test/db/split-activity-visibility.test.ts` against a real
 * Postgres.
 */
describe("GET /api/split/activity", () => {
  function seed(id: string, createdAt: string, audience: string[] | null, groupId: string | null = null, overrides: Partial<SplitActivity> = {}) {
    activity.record({
      id,
      type: "expense_deleted",
      actorUserId: audience?.[0] ?? "11111111-1111-1111-1111-111111111111",
      actorDisplayName: "Alice",
      groupId,
      groupName: null,
      subjectId: "e1111111-1111-1111-1111-111111111111",
      counterpartUserId: null,
      counterpartDisplayName: null,
      amount: 300,
      previousAmount: null,
      changedFields: null,
      addedDisplayNames: null,
      removedDisplayNames: null,
      actorIsPayer: null,
      currency: "TWD",
      description: "Dinner",
      createdAt: new Date(createdAt),
      audienceUserIds: audience,
      ...overrides,
    });
  }

  it("rejects an unauthenticated request", async () => {
    const res = await app.request("/api/split/activity");
    expect(res.status).toBe(401);
  });

  it("hands the edit detail to the client, absent-not-empty on non-edits", async () => {
    // The wire contract for issue #74. `[]` and `null` say different things
    // here — "an edit that changed nothing" versus "not an edit" — so a
    // mapper that collapsed either into the other would be a lie the client
    // cannot see through.
    const me = await idOf(ALICE);
    seed("a1111111-1111-1111-1111-111111111111", "2026-04-01T10:00:00.000Z", [me], null, {
      type: "expense_updated",
      changedFields: ["shares", "amount"],
      addedDisplayNames: ["Cid"],
      removedDisplayNames: ["Ben"],
    });
    seed("a2222222-2222-2222-2222-222222222222", "2026-04-01T09:00:00.000Z", [me]);
    // An edit that changed nothing: the empty list has to survive the wire as
    // an empty list. Collapsing it to null turns "this edit did nothing" into
    // "this was never an edit", and only a fixture that is actually empty can
    // catch that.
    seed("a0000000-0000-0000-0000-000000000000", "2026-04-01T08:00:00.000Z", [me], null, {
      type: "expense_updated",
      changedFields: [],
      addedDisplayNames: [],
      removedDisplayNames: [],
    });

    const res = await app.request("/api/split/activity", { headers: await authHeader(ALICE) });
    const body = await res.json<{ activity: Array<Record<string, unknown>> }>();

    expect(body.activity[0]).toMatchObject({
      changed_fields: ["shares", "amount"],
      added_display_names: ["Cid"],
      removed_display_names: ["Ben"],
    });
    expect(body.activity[1]).toMatchObject({
      changed_fields: null,
      added_display_names: null,
      removed_display_names: null,
    });
    expect(body.activity[2]).toMatchObject({
      changed_fields: [],
      added_display_names: [],
      removed_display_names: [],
    });
  });

  it("returns the caller's entries with everything needed to render them", async () => {
    const aliceId = await idOf(ALICE);
    seed("aaaaaaaa-0000-0000-0000-000000000001", "2026-04-01T10:00:00.000Z", [aliceId]);

    const res = await app.request("/api/split/activity", { headers: await authHeader(ALICE) });
    expect(res.status).toBe(200);
    const body = await res.json<{ activity: Array<Record<string, unknown>>; next_cursor: string | null }>();
    expect(body.activity).toHaveLength(1);
    expect(body.activity[0]).toMatchObject({
      type: "expense_deleted",
      // The reader compares this against their own id to render "you" instead
      // of a name, so no second request is needed to find out who they are.
      actor_user_id: aliceId,
      actor_display_name: "Alice",
      amount: 300,
      currency: "TWD",
      description: "Dinner",
      previous_amount: null,
      group_id: null,
    });
    expect(body.next_cursor).toBeNull();
  });

  it("hands the client a repayment's direction, so it can say who paid whom", async () => {
    const aliceId = await idOf(ALICE);
    const bobId = await idOf(BOB);
    // Bob paid Alice, recorded by Alice: without a direction on the wire this
    // entry is indistinguishable from Alice having paid Bob.
    seed("aaaaaaaa-0000-0000-0000-000000000001", "2026-04-01T10:00:00.000Z", [aliceId, bobId], null, {
      type: "settlement_created",
      counterpartUserId: bobId,
      counterpartDisplayName: "Bob",
      actorIsPayer: false,
    });

    const res = await app.request("/api/split/activity", { headers: await authHeader(ALICE) });
    const body = await res.json<{ activity: Array<Record<string, unknown>> }>();
    expect(body.activity[0]).toMatchObject({ type: "settlement_created", counterpart_user_id: bobId, actor_is_payer: false });
  });

  it("omits an entry the caller is not in the audience of", async () => {
    const bobId = await idOf(BOB);
    await idOf(ALICE);
    seed("aaaaaaaa-0000-0000-0000-000000000001", "2026-04-01T10:00:00.000Z", [bobId]);

    const res = await app.request("/api/split/activity", { headers: await authHeader(ALICE) });
    const body = await res.json<{ activity: unknown[] }>();
    expect(body.activity).toEqual([]);
  });

  it("pages with the cursor it hands back", async () => {
    const aliceId = await idOf(ALICE);
    seed("aaaaaaaa-0000-0000-0000-000000000001", "2026-04-01T10:00:00.000Z", [aliceId]);
    seed("aaaaaaaa-0000-0000-0000-000000000002", "2026-04-01T09:00:00.000Z", [aliceId]);

    const first = await (await app.request("/api/split/activity?limit=1", { headers: await authHeader(ALICE) })).json<{
      activity: Array<{ id: string }>;
      next_cursor: string | null;
    }>();
    expect(first.activity.map((entry) => entry.id)).toEqual(["aaaaaaaa-0000-0000-0000-000000000001"]);
    expect(first.next_cursor).not.toBeNull();

    const second = await (
      await app.request(`/api/split/activity?limit=1&cursor=${encodeURIComponent(first.next_cursor!)}`, { headers: await authHeader(ALICE) })
    ).json<{ activity: Array<{ id: string }> }>();
    expect(second.activity.map((entry) => entry.id)).toEqual(["aaaaaaaa-0000-0000-0000-000000000002"]);
  });

  it("rejects a malformed limit or cursor rather than quietly starting from the top", async () => {
    const headers = await authHeader(ALICE);
    expect((await app.request("/api/split/activity?limit=0", { headers })).status).toBe(400);
    expect((await app.request("/api/split/activity?limit=abc", { headers })).status).toBe(400);
    expect((await app.request("/api/split/activity?cursor=nonsense", { headers })).status).toBe(400);
    // Well-shaped but with a non-uuid id half: this one reaches the keyset
    // comparison's `::uuid` cast and used to come back as `500 internal` — a
    // client's mistake reported as a server fault, against this route's own
    // documented promise of a 400.
    expect((await app.request("/api/split/activity?cursor=2026-04-01T09:00:00.000Z%7Cnot-a-uuid", { headers })).status).toBe(400);
  });
});
