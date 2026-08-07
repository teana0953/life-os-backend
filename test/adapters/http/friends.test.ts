import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";
import { FakeUserDirectory, InMemoryFriendInviteRepository, InMemoryFriendshipRepository } from "../../contexts/social/fakes";
import {
  stubExpenseGroupRepository,
  stubSettlementRepository,
  stubSplitActivityRepository,
  stubSplitBalanceRepository,
  stubSplitExpenseRepository,
  stubSplitFriendChecker,
  stubSplitSpendingRepository,
} from "./split-stubs";

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
  name?: string;
}

const ALICE: Identity = { uid: "uid-a", email: "alice@example.com", name: "Alice" };
const BOB: Identity = { uid: "uid-b", email: "bob@example.com" };
const CAROL: Identity = { uid: "uid-c", email: "carol@example.com", name: "Carol" };

async function authHeader(identity: Identity): Promise<Record<string, string>> {
  const token = await new SignJWT(identity.name === undefined ? { email: identity.email } : { email: identity.email, name: identity.name })
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

/** Mints real lowercase canonical UUIDs, since the routes reject anything else as a 404. */
class InMemoryUserRepository implements UserRepository {
  private usersByFirebaseUid = new Map<string, User>();

  constructor(private readonly directory: FakeUserDirectory) {}

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
    this.directory.add(user.id, { displayName: user.displayName ?? null, email: user.email });
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

let friendships: InMemoryFriendshipRepository;
let invites: InMemoryFriendInviteRepository;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const directory = new FakeUserDirectory();
  friendships = new InMemoryFriendshipRepository(directory);
  invites = new InMemoryFriendInviteRepository(directory, friendships);
  app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: new InMemoryUserRepository(directory),
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
      reorderAccounts: notImplemented,
      insertDefaultAccountsIfMissing: notImplemented,
      upsertSnapshot: notImplemented,
      listMonthValues: notImplemented,
      getMonthlyTotals: notImplemented,
      findPreviousSnapshotMonth: notImplemented,
      getTrend: notImplemented,
    },
    budgetAlertNotifier: { notify: notImplemented },
    friendshipRepository: friendships,
    friendInviteRepository: invites,
    expenseGroupRepository: stubExpenseGroupRepository,
    splitExpenseRepository: stubSplitExpenseRepository,
    splitBalanceRepository: stubSplitBalanceRepository,
    splitFriendChecker: stubSplitFriendChecker,
    splitSettlementRepository: stubSettlementRepository,
    splitActivityRepository: stubSplitActivityRepository,
    splitSpendingRepository: stubSplitSpendingRepository,
    ping: async () => {},
  });
});

async function createInviteAs(identity: Identity): Promise<string> {
  const res = await app.request("/api/friends/invites", { method: "POST", headers: await authHeader(identity) });
  expect(res.status).toBe(200);
  const body = await res.json<{ token: string; expires_at: string }>();
  return body.token;
}

async function acceptAs(identity: Identity, token: string): Promise<Response> {
  return app.request("/api/friends/invites/accept", {
    method: "POST",
    headers: await authHeader(identity),
    body: JSON.stringify({ token }),
  });
}

async function listFriendsAs(identity: Identity): Promise<Array<{ user_id: string; display_name: string }>> {
  const res = await app.request("/api/friends", { headers: await authHeader(identity) });
  expect(res.status).toBe(200);
  return (await res.json<{ friends: Array<{ user_id: string; display_name: string }> }>()).friends;
}

describe("friends routes: authentication", () => {
  it("rejects every endpoint without a token", async () => {
    const calls: Array<[string, string]> = [
      ["GET", "/api/friends"],
      ["DELETE", "/api/friends/00000000-0000-4000-8000-000000000000"],
      ["POST", "/api/friends/invites"],
      ["GET", "/api/friends/invites"],
      ["DELETE", "/api/friends/invites/00000000-0000-4000-8000-000000000000"],
      ["POST", "/api/friends/invites/preview"],
      ["POST", "/api/friends/invites/accept"],
    ];
    for (const [method, path] of calls) {
      const res = await app.request(path, { method, body: method === "POST" ? JSON.stringify({ token: "x" }) : undefined });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });
});

describe("invite, preview and accept", () => {
  it("creates a friendship both sides can see, exposing names and no email", async () => {
    const token = await createInviteAs(ALICE);

    const preview = await app.request("/api/friends/invites/preview", {
      method: "POST",
      headers: await authHeader(BOB),
      body: JSON.stringify({ token }),
    });
    expect(preview.status).toBe(200);
    const previewBody = await preview.text();
    expect(JSON.parse(previewBody)).toEqual({ inviter_display_name: "Alice", already_friends: false });
    expect(previewBody).not.toContain("@");

    const accepted = await acceptAs(BOB, token);
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.text();
    expect(JSON.parse(acceptedBody).friend.display_name).toBe("Alice");
    expect(acceptedBody).not.toContain("@");

    // Bob has no display name, so he is shown as his email's local part only.
    const aliceFriends = await listFriendsAs(ALICE);
    expect(aliceFriends.map((f) => f.display_name)).toEqual(["bob"]);
    expect(JSON.stringify(aliceFriends)).not.toContain("@");
    expect((await listFriendsAs(BOB)).map((f) => f.display_name)).toEqual(["Alice"]);
    expect(friendships.rows).toHaveLength(1);
  });

  it("is idempotent when an existing friend re-opens a link, consuming no further invite", async () => {
    const first = await createInviteAs(ALICE);
    await acceptAs(BOB, first);
    const second = await createInviteAs(ALICE);

    const res = await acceptAs(BOB, second);

    expect(res.status).toBe(200);
    expect(await res.json<{ already_friends: boolean }>()).toMatchObject({ already_friends: true });
    expect(friendships.rows).toHaveLength(1);
    // The second invite is still listed as usable, i.e. it was not consumed.
    const listed = await app.request("/api/friends/invites", { headers: await authHeader(ALICE) });
    expect((await listed.json<{ invites: unknown[] }>()).invites).toHaveLength(1);
  });

  it("refuses a second, different acceptor and keeps the first friendship", async () => {
    const token = await createInviteAs(ALICE);
    await acceptAs(BOB, token);

    const res = await acceptAs(CAROL, token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invite_already_used" });
    expect(friendships.rows).toHaveLength(1);
    expect(await listFriendsAs(CAROL)).toEqual([]);
  });

  it("refuses accepting your own invite", async () => {
    const token = await createInviteAs(ALICE);

    const res = await acceptAs(ALICE, token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "cannot_friend_self" });
    expect(friendships.rows).toHaveLength(0);
  });

  it("answers an unknown token with 404 on both preview and accept", async () => {
    const accept = await acceptAs(BOB, "not-a-real-token");
    expect(accept.status).toBe(404);
    expect(await accept.json()).toEqual({ error: "not_found" });

    const preview = await app.request("/api/friends/invites/preview", {
      method: "POST",
      headers: await authHeader(BOB),
      body: JSON.stringify({ token: "not-a-real-token" }),
    });
    expect(preview.status).toBe(404);
  });

  it("rejects a request with no token in the body", async () => {
    const res = await app.request("/api/friends/invites/accept", { method: "POST", headers: await authHeader(BOB), body: "{}" });
    expect(res.status).toBe(400);
    expect(await res.json<{ error: string }>()).toMatchObject({ error: "bad_request" });
  });
});

describe("invites belong to their creator", () => {
  it("does not show one user's invites to another", async () => {
    await createInviteAs(ALICE);

    const res = await app.request("/api/friends/invites", { headers: await authHeader(BOB) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ invites: [] });
  });

  it("refuses to revoke another user's invite, indistinguishably from a missing one", async () => {
    await createInviteAs(ALICE);
    const inviteId = invites.rows[0].id;

    const res = await app.request(`/api/friends/invites/${inviteId}`, { method: "DELETE", headers: await authHeader(BOB) });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(invites.rows[0].revokedAt).toBeNull();
  });

  it("revokes its owner's invite and then reports the link as revoked", async () => {
    const token = await createInviteAs(ALICE);
    const inviteId = invites.rows[0].id;

    const revoked = await app.request(`/api/friends/invites/${inviteId}`, { method: "DELETE", headers: await authHeader(ALICE) });
    expect(revoked.status).toBe(200);

    const res = await acceptAs(BOB, token);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invite_revoked" });
  });
});

describe("DELETE /api/friends/:friendUserId", () => {
  it("removes the friendship for both sides, from either side", async () => {
    const token = await createInviteAs(ALICE);
    await acceptAs(BOB, token);
    const [alice] = await listFriendsAs(BOB);

    const res = await app.request(`/api/friends/${alice.user_id}`, { method: "DELETE", headers: await authHeader(BOB) });

    expect(res.status).toBe(200);
    expect(await listFriendsAs(ALICE)).toEqual([]);
    expect(await listFriendsAs(BOB)).toEqual([]);
  });

  it("answers 404 for a non-friend, an unknown user and a malformed id alike", async () => {
    await createInviteAs(CAROL); // make sure Carol exists
    const headers = await authHeader(ALICE);

    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const res = await app.request(`/api/friends/${id}`, { method: "DELETE", headers });
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });
});
