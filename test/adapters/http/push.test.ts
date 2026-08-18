import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import { hashAckToken } from "../../../src/contexts/notifications/domain/ack-token";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { ChaodaysClient } from "../../../src/contexts/health/domain/chaodays-client";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { PushDeliveryRepository } from "../../../src/contexts/notifications/domain/push-delivery";
import type { PushMessage, PushSendResult, PushSender } from "../../../src/contexts/notifications/domain/push-sender";
import type { PushSubscription, PushSubscriptionRepository, PushSubscriptionKeys } from "../../../src/contexts/notifications/domain/push-subscription";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";
import { stubFriendInviteRepository, stubFriendshipRepository } from "./social-stubs";
import {
  stubExpenseGroupRepository,
  stubSettlementRepository,
  stubSplitActivityRepository,
  stubSplitBalanceRepository,
  stubSplitExpenseRepository,
  stubSplitFriendChecker,
  stubSplitSpendingRepository,
} from "./split-stubs";
import { stubModelClient } from "./assistant-stubs";

function notImplemented(): never {
  throw new Error("not implemented in this test's fakes");
}
const stubChaodaysClient: ChaodaysClient = {
  signIn: notImplemented,
  fetchWeightRecords: notImplemented,
  fetchDietRecords: notImplemented,
  fetchWaterRecords: notImplemented,
  fetchDefecationRecords: notImplemented,
  fetchDietMenus: notImplemented,
  fetchMenstruals: notImplemented,
};
const stubFoodDictionaryRepository: FoodDictionaryRepository = {
  search: notImplemented,
  findById: notImplemented,
  createCustom: notImplemented,
  favorite: notImplemented,
  unfavorite: notImplemented,
  listFavorites: notImplemented,
  findSharedById: notImplemented,
  createShared: notImplemented,
  updateSharedById: notImplemented,
};
const stubMealRepository: MealRepository = {
  upsertMealWithItems: notImplemented,
  createMeals: notImplemented,
  listMealsByDay: notImplemented,
  listMealsInRange: notImplemented,
  listLoggedDays: notImplemented,
  updateMealTime: notImplemented,
  deleteMeal: notImplemented,
  updateItem: notImplemented,
  deleteItem: notImplemented,
};
const stubDailyTargetRepository: DailyTargetRepository = {
  get: notImplemented,
  getLatestOnOrBefore: notImplemented,
  listInRange: notImplemented,
  set: notImplemented,
  setMany: notImplemented,
};
const stubBowelRepository: BowelRepository = {
  get: notImplemented,
  set: notImplemented,
  setMany: notImplemented,
  listRange: notImplemented,
};
const stubVitalsRepository: VitalsRepository = {
  get: notImplemented,
  set: notImplemented,
  setMany: notImplemented,
  getLatestWeight: notImplemented,
  getEarliestWeight: notImplemented,
  getWeightDayCount: notImplemented,
  listRange: notImplemented,
};
const stubExerciseRepository: ExerciseRepository = {
  addEntry: notImplemented,
  listByDay: notImplemented,
  deleteEntry: notImplemented,
};
const stubMenstrualRepository: MenstrualRepository = {
  add: notImplemented,
  listByUser: notImplemented,
  update: notImplemented,
  delete: notImplemented,
};
const stubBodyProfileRepository: BodyProfileRepository = {
  get: notImplemented,
  upsert: notImplemented,
};
const stubWaterRepository: WaterRepository = {
  getIntake: notImplemented,
  addIntake: notImplemented,
  addIntakeMany: notImplemented,
  listIntakeRange: notImplemented,
  getTarget: notImplemented,
  getLatestTargetOnOrBefore: notImplemented,
  listTargetRange: notImplemented,
  setTarget: notImplemented,
  setTargetMany: notImplemented,
};

const PROJECT_ID = "life-os-test";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KEY_ID = "test-key-1";

let signingKey: CryptoKey;
let jwks: JWTVerifyGetKey;

async function validToken(uid = "uid-1"): Promise<string> {
  return new SignJWT({ email: "alice@example.com", name: "Alice" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setSubject(uid)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(PROJECT_ID)
    .setExpirationTime("1h")
    .sign(signingKey);
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

class InMemoryUserRepository implements UserRepository {
  private usersByFirebaseUid = new Map<string, User>();
  private nextId = 1;

  async getOrCreate(input: GetOrCreateUserInput): Promise<User> {
    const existing = this.usersByFirebaseUid.get(input.firebaseUid);
    if (existing) return existing;
    const user: User = {
      id: `user-${this.nextId++}`,
      firebaseUid: input.firebaseUid,
      email: input.email,
      displayName: input.displayName,
      timezone: "Asia/Taipei",
      isAdmin: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    this.usersByFirebaseUid.set(input.firebaseUid, user);
    return user;
  }

  async updateTimezone(userId: string, timezone: string): Promise<void> {
    for (const user of this.usersByFirebaseUid.values()) {
      if (user.id === userId) {
        user.timezone = timezone;
        return;
      }
    }
  }

  async getById(userId: string): Promise<User | null> {
    for (const user of this.usersByFirebaseUid.values()) {
      if (user.id === userId) return user;
    }
    return null;
  }
}

class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private byEndpoint = new Map<string, PushSubscription>();

  async upsert(subscription: PushSubscriptionKeys): Promise<PushSubscription> {
    // The real repository upserts on `endpoint` and leaves the existing row's
    // `id` alone, so a re-subscribe from the same device keeps its identity.
    // Reusing a stored id here reproduces that; minting a fresh one every time
    // would make `push_delivery` rows look like they came from new devices.
    const stored = { id: this.byEndpoint.get(subscription.endpoint)?.id ?? `sub-${this.byEndpoint.size + 1}`, ...subscription };
    this.byEndpoint.set(subscription.endpoint, stored);
    return stored;
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    return [...this.byEndpoint.values()].filter((s) => s.userId === userId);
  }

  async deleteByEndpoint(userId: string, endpoint: string): Promise<void> {
    const existing = this.byEndpoint.get(endpoint);
    if (existing && existing.userId === userId) this.byEndpoint.delete(endpoint);
  }

  size(): number {
    return this.byEndpoint.size;
  }
}

class ScriptedPushSender implements PushSender {
  resultByEndpoint = new Map<string, PushSendResult>();

  async send(subscription: PushSubscriptionKeys, _message: PushMessage): Promise<PushSendResult> {
    return this.resultByEndpoint.get(subscription.endpoint) ?? { outcome: "sent" };
  }
}

class RecordingPushDeliveryRepository implements PushDeliveryRepository {
  ackedHashes: string[] = [];
  /** What `markAcked` reports back — the route must treat both alike. */
  result = true;

  async registerSent(): Promise<void> {
    throw new Error("not implemented in this test's fakes");
  }
  async markAcked(tokenHash: string): Promise<boolean> {
    this.ackedHashes.push(tokenHash);
    return this.result;
  }
}

function buildApp(vapidPublicKey = "test-vapid-public-key") {
  const pushSubscriptionRepository = new InMemoryPushSubscriptionRepository();
  const pushSender = new ScriptedPushSender();
  const pushDeliveryRepository = new RecordingPushDeliveryRepository();
  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: new InMemoryUserRepository(),
    foodDictionaryRepository: stubFoodDictionaryRepository,
    mealRepository: stubMealRepository,
    dailyTargetRepository: stubDailyTargetRepository,
    waterRepository: stubWaterRepository,
    bowelRepository: stubBowelRepository,
    vitalsRepository: stubVitalsRepository,
    exerciseRepository: stubExerciseRepository,
    menstrualRepository: stubMenstrualRepository,
    bodyProfileRepository: stubBodyProfileRepository,
    healthCalendarRepository: { listLoggedDays: async () => [] },
    chaodaysClient: stubChaodaysClient,
    pushSubscriptionRepository,
    pushSender,
    pushDeliveryRepository,
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
      findById: notImplemented,
      listByUserAndRange: notImplemented,
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
    installmentPlanRepository: {
      createWithInstallments: notImplemented,
      findById: notImplemented,
      listInstallments: notImplemented,
      rewriteUpcoming: notImplemented,
      settle: notImplemented,
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
    budgetAlertNotifier: {
      notify: notImplemented,
    },
    vapidPublicKey,
    friendshipRepository: stubFriendshipRepository,
    friendInviteRepository: stubFriendInviteRepository,
    expenseGroupRepository: stubExpenseGroupRepository,
    splitExpenseRepository: stubSplitExpenseRepository,
    splitBalanceRepository: stubSplitBalanceRepository,
    splitFriendChecker: stubSplitFriendChecker,
    splitSettlementRepository: stubSettlementRepository,
    splitActivityRepository: stubSplitActivityRepository,
    splitSpendingRepository: stubSplitSpendingRepository,
    modelClient: stubModelClient,
    ping: async () => {},
  });
  return { app, pushSubscriptionRepository, pushSender, pushDeliveryRepository };
}

const VALID_BODY = {
  endpoint: "https://push.example.com/subscription/abc123",
  p256dh: "p256dh-key-value",
  auth: "auth-secret-value",
};

describe("push HTTP routes", () => {
  it("requires auth for GET /api/push/vapid-public-key", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/push/vapid-public-key");

    expect(res.status).toBe(401);
  });

  it("requires auth for POST /api/push/subscribe", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(401);
  });

  it("requires auth for DELETE /api/push/subscribe", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: VALID_BODY.endpoint }),
    });

    expect(res.status).toBe(401);
  });

  it("requires auth for POST /api/push/test", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/push/test", { method: "POST" });

    expect(res.status).toBe(401);
  });

  it("returns the configured VAPID public key", async () => {
    const { app } = buildApp("configured-public-key");
    const token = await validToken();

    const res = await app.request("/api/push/vapid-public-key", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ public_key: "configured-public-key" });
  });

  it("subscribes and is idempotent on the same endpoint", async () => {
    const { app, pushSubscriptionRepository } = buildApp();
    const token = await validToken();

    const first = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    const second = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    expect(first.status).toBeLessThan(300);
    expect(second.status).toBeLessThan(300);
    expect(pushSubscriptionRepository.size()).toBe(1);
  });

  it("rejects a subscribe with a missing field, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: VALID_BODY.endpoint, p256dh: VALID_BODY.p256dh }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a subscribe with a non-https endpoint, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_BODY, endpoint: "http://push.example.com/subscription/abc123" }),
    });

    expect(res.status).toBe(400);
  });

  it("unsubscribes idempotently, whether or not the endpoint currently exists", async () => {
    const { app, pushSubscriptionRepository } = buildApp();
    const token = await validToken();
    await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    const first = await app.request("/api/push/subscribe", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: VALID_BODY.endpoint }),
    });
    const second = await app.request("/api/push/subscribe", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: VALID_BODY.endpoint }),
    });

    expect(first.status).toBeLessThan(300);
    expect(second.status).toBeLessThan(300);
    expect(pushSubscriptionRepository.size()).toBe(0);
  });

  it("sends a test push to each subscription and reports sent/failed, pruning an expired one", async () => {
    const { app, pushSubscriptionRepository, pushSender } = buildApp();
    const token = await validToken();
    await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    const goneEndpoint = "https://push.example.com/subscription/gone";
    await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_BODY, endpoint: goneEndpoint }),
    });
    pushSender.resultByEndpoint.set(goneEndpoint, { outcome: "expired", detail: "status_410" });

    const res = await app.request("/api/push/test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, failed: 1, errors: ["status_410"] });
    expect(pushSubscriptionRepository.size()).toBe(1);
  });
});

/**
 * `POST /api/push/ack` is the only route under `/api/` with no
 * `authMiddleware`, so these cases carry more weight than usual: they are the
 * whole of what stands between the internet and this table.
 *
 * What they CANNOT show, because everything here is in-process: that a real
 * service worker can issue this request at all while the app is closed, or
 * that a phone with the screen off still runs it. Until life-os's
 * `web/push_sw.js` ships and a real device is observed, no `acked_at` will
 * ever be written in production.
 */
describe("POST /api/push/ack", () => {
  const ACK_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE"; // 43 base64url chars.

  async function postAck(app: ReturnType<typeof buildApp>["app"], body: string, headers: Record<string, string> = {}) {
    return app.request("/api/push/ack", { method: "POST", body, headers });
  }

  it("accepts an ack with no Authorization header at all", async () => {
    // The entire point: a service worker in a `push` event has no Firebase ID
    // token to send. Putting `authMiddleware` on this route would make every
    // ack a 401 — and delivery data would silently stay empty forever.
    const { app, pushDeliveryRepository } = buildApp();

    const res = await postAck(app, JSON.stringify({ ack: ACK_TOKEN }));

    expect(res.status).toBe(204);
    expect(pushDeliveryRepository.ackedHashes).toHaveLength(1);
  });

  it("hands the repository the token's hash, never the token", async () => {
    const { app, pushDeliveryRepository } = buildApp();

    await postAck(app, JSON.stringify({ ack: ACK_TOKEN }));

    expect(pushDeliveryRepository.ackedHashes[0]).toBe(await hashAckToken(ACK_TOKEN));
  });

  it.each([
    ["a token that matched a row", true],
    ["a token that matched nothing", false],
  ])("answers 204 for %s", async (_label, result) => {
    // Identical answers are the guard: a status that varied with the
    // repository's verdict would turn this endpoint into a token oracle.
    const { app, pushDeliveryRepository } = buildApp();
    pushDeliveryRepository.result = result;

    const res = await postAck(app, JSON.stringify({ ack: ACK_TOKEN }));

    expect(res.status).toBe(204);
  });

  it.each([
    ["a malformed body", "not json at all"],
    ["a body with no ack field", JSON.stringify({ hello: "world" })],
    ["a wrong-shaped token", JSON.stringify({ ack: "too-short" })],
    ["an oversized body", JSON.stringify({ ack: ACK_TOKEN, padding: "x".repeat(2000) })],
  ])("answers 204 and touches no row for %s", async (_label, body) => {
    const { app, pushDeliveryRepository } = buildApp();

    const res = await postAck(app, body);

    expect(res.status).toBe(204);
    expect(pushDeliveryRepository.ackedHashes).toEqual([]);
  });

  it("discards a body whose declared Content-Length exceeds the cap, without parsing it", async () => {
    // The cap's whole purpose is that an unauthenticated caller cannot make
    // this route do work proportional to what it sends. Measuring only the
    // already-buffered string means the body has been read and UTF-16-decoded
    // before the cap is consulted. The body here is a perfectly valid ack, so
    // the only thing that can produce 0 recorded acks is the Content-Length
    // check running first.
    const { app, pushDeliveryRepository } = buildApp();

    const res = await postAck(app, JSON.stringify({ ack: ACK_TOKEN }), { "content-length": "2000" });

    expect(res.status).toBe(204);
    expect(pushDeliveryRepository.ackedHashes).toEqual([]);
  });

  it("still accepts an ack whose declared Content-Length is within the cap", async () => {
    // Pairs with the test above: a cap that rejected everything with a
    // Content-Length header would also pass it.
    const { app, pushDeliveryRepository } = buildApp();
    const body = JSON.stringify({ ack: ACK_TOKEN });

    const res = await postAck(app, body, { "content-length": String(body.length) });

    expect(res.status).toBe(204);
    expect(pushDeliveryRepository.ackedHashes).toHaveLength(1);
  });

  it("still refuses the other push routes without a token", async () => {
    // Regression fence around the exemption above: adding one unauthenticated
    // route must not have loosened its neighbours.
    const { app } = buildApp();

    expect((await app.request("/api/push/test", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/push/vapid-public-key")).status).toBe(401);
  });
});
