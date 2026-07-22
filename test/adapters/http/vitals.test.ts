import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { VitalsRecord } from "../../../src/contexts/health/domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";

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
  listLoggedDays: notImplemented,
  updateMealTime: notImplemented,
  deleteMeal: notImplemented,
  updateItem: notImplemented,
  deleteItem: notImplemented,
};
const stubDailyTargetRepository: DailyTargetRepository = {
  get: notImplemented,
  getLatestOnOrBefore: notImplemented,
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

class InMemoryVitalsRepository implements VitalsRepository {
  private byUserDay = new Map<string, VitalsRecord>();

  async get(userId: string, day: string): Promise<VitalsRecord | null> {
    return this.byUserDay.get(`${userId}:${day}`) ?? null;
  }

  async set(input: SetVitalsInput): Promise<VitalsRecord> {
    const record: VitalsRecord = {
      userId: input.userId,
      day: input.day,
      weightKg: input.weightKg,
      bodyFatPct: input.bodyFatPct,
      bpReadings: input.bpReadings,
      glucoseReadings: input.glucoseReadings,
      spo2Readings: input.spo2Readings,
    };
    this.byUserDay.set(`${input.userId}:${input.day}`, record);
    return record;
  }
}

function buildApp() {
  const vitalsRepository = new InMemoryVitalsRepository();
  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: new InMemoryUserRepository(),
    foodDictionaryRepository: stubFoodDictionaryRepository,
    mealRepository: stubMealRepository,
    dailyTargetRepository: stubDailyTargetRepository,
    waterRepository: stubWaterRepository,
    bowelRepository: stubBowelRepository,
    vitalsRepository,
    ping: async () => {},
  });
  return { app, vitalsRepository };
}

const EMPTY_DAY = {
  day: "2026-07-18",
  weight_kg: null,
  body_fat_pct: null,
  bp_readings: [],
  glucose_readings: [],
  spo2_readings: [],
};

describe("vitals HTTP routes", () => {
  it("requires auth for GET /api/vitals", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/vitals?day=2026-07-18");

    expect(res.status).toBe(401);
  });

  it("requires auth for PUT /api/vitals", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18" }),
    });

    expect(res.status).toBe(401);
  });

  it("reads empty defaults for an unrecorded day", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EMPTY_DAY);
  });

  it("upserts a day's whole record with multiple readings and round-trips (incl. null pulse)", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const payload = {
      day: "2026-07-18",
      weight_kg: 65.5,
      body_fat_pct: 22.1,
      bp_readings: [
        { systolic: 120, diastolic: 80, pulse: 70 },
        { systolic: 118, diastolic: 78, pulse: 72 },
      ],
      glucose_readings: [{ label: "餐前", value: 95 }],
      spo2_readings: [{ spo2: 98, pulse: null }],
    };

    const put = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(put.status).toBe(200);
    expect(await put.json()).toEqual(payload);

    const get = await app.request("/api/vitals?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });
    expect(await get.json()).toEqual(payload);
  });

  it("accepts null scalars and empty arrays", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EMPTY_DAY);
  });

  it("rejects GET /api/vitals with a missing day, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(400);
  });

  it("rejects PUT /api/vitals with a non-numeric scalar, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", weight_kg: "abc" }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a non-array reading list, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", bp_readings: "nope" }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a reading that is a primitive, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", bp_readings: [42] }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a reading missing a required numeric value, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", glucose_readings: [{ label: "餐前" }] }),
    });

    expect(res.status).toBe(400);
  });

  it.each([
    ["a negative weight", { weight_kg: -1 }],
    ["a body-fat percentage over 100", { body_fat_pct: 150 }],
    ["a negative systolic", { bp_readings: [{ systolic: -1, diastolic: 80 }] }],
    ["a negative glucose value", { glucose_readings: [{ label: "餐前", value: -5 }] }],
    ["an SpO2 over 100", { spo2_readings: [{ spo2: 150 }] }],
    ["a negative pulse", { spo2_readings: [{ spo2: 98, pulse: -3 }] }],
  ])("rejects %s, as 400", async (_desc, patch) => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", ...patch }),
    });

    expect(res.status).toBe(400);
  });
});
