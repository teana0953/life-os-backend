import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { ChaodaysClient } from "../../../src/contexts/health/domain/chaodays-client";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";

// This suite only exercises /health and /api/me; the health-context routes have their own test file.
function notImplemented(): never {
  throw new Error("not implemented in this test's fakes");
}
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
const stubWaterRepository: WaterRepository = {
  getIntake: notImplemented,
  addIntake: notImplemented,
  getTarget: notImplemented,
  getLatestTargetOnOrBefore: notImplemented,
  setTarget: notImplemented,
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
const stubBodyProfileRepository: BodyProfileRepository = {
  get: notImplemented,
  upsert: notImplemented,
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
const stubChaodaysClient: ChaodaysClient = {
  signIn: notImplemented,
  fetchWeightRecords: notImplemented,
  fetchDietRecords: notImplemented,
  fetchWaterRecords: notImplemented,
  fetchDefecationRecords: notImplemented,
};

const PROJECT_ID = "life-os-test";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KEY_ID = "test-key-1";

let signingKey: CryptoKey;
let jwks: JWTVerifyGetKey;

async function validToken(): Promise<string> {
  return new SignJWT({ email: "alice@example.com", name: "Alice" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setSubject("uid-1")
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(PROJECT_ID)
    .setExpirationTime("1h")
    .sign(signingKey);
}

async function tokenSignedByUnknownKey(): Promise<string> {
  const { privateKey } = await generateKeyPair("RS256");
  return new SignJWT({ email: "eve@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "not-in-jwks" })
    .setSubject("uid-eve")
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(PROJECT_ID)
    .setExpirationTime("1h")
    .sign(privateKey);
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
      id: String(this.nextId++),
      firebaseUid: input.firebaseUid,
      email: input.email,
      displayName: input.displayName,
      timezone: "Asia/Taipei",
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
}

function buildApp(
  overrides: { ping?: () => Promise<void>; userRepository?: UserRepository; allowedWebOrigin?: string } = {},
) {
  return createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: overrides.userRepository ?? new InMemoryUserRepository(),
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
    pushSubscriptionRepository: {
      upsert: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      listByUser: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      deleteByEndpoint: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    pushSender: {
      send: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    reminderScheduleRepository: {
      create: notImplemented,
      listByUser: notImplemented,
      get: notImplemented,
      update: notImplemented,
      delete: notImplemented,
      listActiveAll: notImplemented,
    },
    vapidPublicKey: "",
    ping: overrides.ping ?? (async () => {}),
    allowedWebOrigin: overrides.allowedWebOrigin,
  });
}

describe("CORS", () => {
  it("reflects an allowed localhost origin", async () => {
    const app = buildApp();

    const res = await app.request("/health", { headers: { Origin: "http://localhost:5000" } });

    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5000");
  });

  it("does not allow a foreign origin", async () => {
    const app = buildApp();

    const res = await app.request("/health", { headers: { Origin: "https://evil.example.com" } });

    expect(res.headers.get("access-control-allow-origin")).not.toBe("https://evil.example.com");
  });

  it("reflects the configured production web origin", async () => {
    const app = buildApp({ allowedWebOrigin: "https://life-os.pages.dev" });

    const res = await app.request("/health", { headers: { Origin: "https://life-os.pages.dev" } });

    expect(res.headers.get("access-control-allow-origin")).toBe("https://life-os.pages.dev");
  });

  it("still rejects a non-configured production origin", async () => {
    const app = buildApp({ allowedWebOrigin: "https://life-os.pages.dev" });

    const res = await app.request("/health", { headers: { Origin: "https://other.pages.dev" } });

    expect(res.headers.get("access-control-allow-origin")).not.toBe("https://other.pages.dev");
  });

  it("answers preflight for /api/me allowing the Authorization header", async () => {
    const app = buildApp();

    const res = await app.request("/api/me", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5000",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });

    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5000");
    expect((res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("authorization");
  });
});

describe("GET /health", () => {
  it("returns 200 {ok:true} when the database ping succeeds", async () => {
    const app = buildApp({ ping: async () => {} });

    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 503 {ok:false} when the database ping fails", async () => {
    const app = buildApp({
      ping: async () => {
        throw new Error("connection refused");
      },
    });

    const res = await app.request("/health");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});

describe("GET /api/me", () => {
  it("returns 401 when there is no Authorization header", async () => {
    const app = buildApp();

    const res = await app.request("/api/me");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 for a malformed Authorization header", async () => {
    const app = buildApp();

    const res = await app.request("/api/me", { headers: { Authorization: "NotBearer abc" } });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 for a token with an invalid signature", async () => {
    const app = buildApp();
    const token = await tokenSignedByUnknownKey();

    const res = await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 200 with the user JSON for a valid token, creating the user on first call", async () => {
    const repo = new InMemoryUserRepository();
    const app = buildApp({ userRepository: repo });
    const token = await validToken();

    const res = await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: expect.any(String),
      firebase_uid: "uid-1",
      email: "alice@example.com",
      display_name: "Alice",
      created_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("reuses the same user record across calls (no duplicate)", async () => {
    const repo = new InMemoryUserRepository();
    const app = buildApp({ userRepository: repo });
    const token = await validToken();

    const first = (await (await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string };
    const second = (await (await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string };

    expect(second.id).toBe(first.id);
  });

  it("returns 500 {error:'internal'} without leaking details when the repository throws", async () => {
    const app = buildApp({
      userRepository: {
        async getOrCreate() {
          throw new Error("connection string: postgres://user:secret@host/db");
        },
        async updateTimezone() {
          throw new Error("not implemented in this test's fakes");
        },
      },
    });
    const token = await validToken();

    const res = await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "internal" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
