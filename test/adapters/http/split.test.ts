import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";
import {
  InMemoryBalanceRepository,
  InMemoryExpenseGroupRepository,
  InMemoryFriendChecker,
  InMemorySplitExpenseRepository,
  TestUserDirectory,
} from "../../contexts/split/fakes";
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
  expenses = new InMemorySplitExpenseRepository(groups, directory);
  friends = new InMemoryFriendChecker();
  balances = new InMemoryBalanceRepository(expenses, groups, directory);

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
    financeCategoryRepository: {
      listByUser: notImplemented,
      findById: notImplemented,
      findByUserTypeName: notImplemented,
      create: notImplemented,
      update: notImplemented,
      insertDefaultsIfMissing: notImplemented,
    },
    financeTransactionRepository: {
      create: notImplemented,
      listByUserAndRange: notImplemented,
      findById: notImplemented,
      update: notImplemented,
      delete: notImplemented,
      getMonthlySummaryRaw: notImplemented,
    },
    financeBudgetRepository: {
      upsert: notImplemented,
      findByUserAndCategory: notImplemented,
      delete: notImplemented,
      listWithSpent: notImplemented,
      getSpent: notImplemented,
      tryRecordAlert: notImplemented,
    },
    financeNetWorthRepository: {
      listAccounts: notImplemented,
      findAccountById: notImplemented,
      findAccountByUserKindName: notImplemented,
      createAccount: notImplemented,
      updateAccount: notImplemented,
      insertDefaultAccountsIfMissing: notImplemented,
      upsertSnapshot: notImplemented,
      listMonthValues: notImplemented,
      getMonthlyTotals: notImplemented,
      findPreviousSnapshotMonth: notImplemented,
      getTrend: notImplemented,
    },
    budgetAlertNotifier: { notify: notImplemented },
    friendshipRepository: stubFriendshipRepository,
    friendInviteRepository: stubFriendInviteRepository,
    expenseGroupRepository: groups,
    splitExpenseRepository: expenses,
    splitBalanceRepository: balances,
    splitFriendChecker: friends,
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
  split: { mode: "equal"; participant_user_ids: string[] } | { mode: "exact"; shares: { user_id: string; amount: number }[] };
}

async function createExpenseAs(identity: Identity, spec: ExpenseSpec): Promise<Response> {
  return app.request("/api/split/expenses", {
    method: "POST",
    headers: await authHeader(identity),
    body: JSON.stringify({
      group_id: spec.groupId ?? null,
      payer_user_id: spec.payerUserId,
      amount: spec.amount,
      currency: spec.currency ?? "TWD",
      description: spec.description ?? "dinner",
      day: spec.day ?? "2026-08-01",
      split: spec.split,
    }),
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
