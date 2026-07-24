import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
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
import type { PushMessage, PushSendResult, PushSender } from "../../../src/contexts/notifications/domain/push-sender";
import type { PushSubscription, PushSubscriptionRepository } from "../../../src/contexts/notifications/domain/push-subscription";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";

function notImplemented(): never {
  throw new Error("not implemented in this test's fakes");
}
const stubChaodaysClient: ChaodaysClient = {
  signIn: notImplemented,
  fetchWeightRecords: notImplemented,
  fetchDietRecords: notImplemented,
  fetchWaterRecords: notImplemented,
  fetchDefecationRecords: notImplemented,
};
const stubFoodDictionaryRepository: FoodDictionaryRepository = {
  search: notImplemented,
  findById: notImplemented,
  createCustom: notImplemented,
  favorite: notImplemented,
  unfavorite: notImplemented,
  listFavorites: notImplemented,
};
const stubMealRepository: MealRepository = {
  upsertMealWithItems: notImplemented,
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
};
const stubBowelRepository: BowelRepository = {
  get: notImplemented,
  set: notImplemented,
};
const stubVitalsRepository: VitalsRepository = {
  get: notImplemented,
  set: notImplemented,
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
  getTarget: notImplemented,
  getLatestTargetOnOrBefore: notImplemented,
  setTarget: notImplemented,
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
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    this.usersByFirebaseUid.set(input.firebaseUid, user);
    return user;
  }
}

class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private byEndpoint = new Map<string, PushSubscription>();

  async upsert(subscription: PushSubscription): Promise<PushSubscription> {
    this.byEndpoint.set(subscription.endpoint, subscription);
    return subscription;
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

/** Scriptable fake: returns results from `resultByEndpoint`, defaulting to "sent". */
class ScriptedPushSender implements PushSender {
  resultByEndpoint = new Map<string, PushSendResult>();

  async send(subscription: PushSubscription, _message: PushMessage): Promise<PushSendResult> {
    return this.resultByEndpoint.get(subscription.endpoint) ?? "sent";
  }
}

function buildApp(vapidPublicKey = "test-vapid-public-key") {
  const pushSubscriptionRepository = new InMemoryPushSubscriptionRepository();
  const pushSender = new ScriptedPushSender();
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
    vapidPublicKey,
    ping: async () => {},
  });
  return { app, pushSubscriptionRepository, pushSender };
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
    pushSender.resultByEndpoint.set(goneEndpoint, "expired");

    const res = await app.request("/api/push/test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, failed: 1 });
    expect(pushSubscriptionRepository.size()).toBe(1);
  });
});
