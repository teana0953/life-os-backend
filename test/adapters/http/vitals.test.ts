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
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
import type { MenstrualRepository } from "../../../src/contexts/health/domain/menstrual-repository";
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

  /** Test helper: seed a whole record for a user/day. */
  seed(record: VitalsRecord) {
    this.byUserDay.set(`${record.userId}:${record.day}`, record);
  }

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

  async getLatestWeight(userId: string): Promise<number | null> {
    return this.weightAtExtreme(userId, "latest");
  }

  async getEarliestWeight(userId: string): Promise<number | null> {
    return this.weightAtExtreme(userId, "earliest");
  }

  async getWeightDayCount(userId: string): Promise<number> {
    return [...this.byUserDay.values()].filter((r) => r.userId === userId && r.weightKg !== null).length;
  }

  private weightAtExtreme(userId: string, which: "latest" | "earliest"): number | null {
    const withWeight = [...this.byUserDay.values()].filter((r) => r.userId === userId && r.weightKg !== null);
    if (withWeight.length === 0) return null;
    withWeight.sort((a, b) => a.day.localeCompare(b.day));
    const record = which === "latest" ? withWeight[withWeight.length - 1] : withWeight[0];
    return record.weightKg;
  }

  async listRange(userId: string, from: string, to: string): Promise<VitalsRecord[]> {
    return [...this.byUserDay.values()]
      .filter((r) => r.userId === userId && r.day >= from && r.day <= to)
      .sort((a, b) => a.day.localeCompare(b.day));
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
    exerciseRepository: stubExerciseRepository,
    menstrualRepository: stubMenstrualRepository,
    bodyProfileRepository: stubBodyProfileRepository,
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
        { systolic: 120, diastolic: 80, pulse: 70, time: "08:30" },
        { systolic: 118, diastolic: 78, pulse: 72, time: "21:00" },
      ],
      glucose_readings: [{ label: "餐前", value: 95, meal_context: "pre_meal", time: "07:45" }],
      spo2_readings: [{ spo2: 98, pulse: null, time: "08:30" }],
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

  it("rejects a reading missing a time, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", bp_readings: [{ systolic: 120, diastolic: 80, pulse: 70 }] }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a reading with an empty time, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", glucose_readings: [{ label: "餐前", value: 95, time: "" }] }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a glucose reading with an unknown meal_context, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        day: "2026-07-18",
        glucose_readings: [{ label: "", value: 95, meal_context: "brunch", time: "07:45" }],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("accepts a glucose reading with no meal_context, storing it as null", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        day: "2026-07-18",
        glucose_readings: [{ label: "", value: 95, time: "07:45" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { glucose_readings: { meal_context: unknown }[] };
    expect(body.glucose_readings[0].meal_context).toBeNull();
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

  it("requires auth for GET /api/vitals/range", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/vitals/range?from=2026-07-01&to=2026-07-31");

    expect(res.status).toBe(401);
  });

  it("returns the per-metric per-reading series over the range", async () => {
    const { app, vitalsRepository } = buildApp();
    const token = await validToken();
    vitalsRepository.seed({
      userId: "user-1",
      day: "2026-07-01",
      weightKg: 52,
      bodyFatPct: null,
      bpReadings: [
        { systolic: 118, diastolic: 76, pulse: 70, time: "08:00" },
        { systolic: 122, diastolic: 80, pulse: null, time: "20:00" },
      ],
      glucoseReadings: [],
      spo2Readings: [{ spo2: 98, pulse: 74, time: "08:00" }],
    });
    vitalsRepository.seed({
      userId: "user-1",
      day: "2026-07-03",
      weightKg: 51.7,
      bodyFatPct: null,
      bpReadings: [],
      glucoseReadings: [],
      spo2Readings: [],
    });

    const res = await app.request("/api/vitals/range?from=2026-07-01&to=2026-07-31", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
      series: {
        weight: [
          { day: "2026-07-01", time: "", value: 52 },
          { day: "2026-07-03", time: "", value: 51.7 },
        ],
        body_fat: [],
        systolic: [
          { day: "2026-07-01", time: "08:00", value: 118 },
          { day: "2026-07-01", time: "20:00", value: 122 },
        ],
        diastolic: [
          { day: "2026-07-01", time: "08:00", value: 76 },
          { day: "2026-07-01", time: "20:00", value: 80 },
        ],
        pulse: [
          { day: "2026-07-01", time: "08:00", value: 70 },
          { day: "2026-07-01", time: "08:00", value: 74 },
        ],
        glucose: [],
        spo2: [{ day: "2026-07-01", time: "08:00", value: 98 }],
      },
    });
  });

  it("rejects GET /api/vitals/range with a missing from, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals/range?to=2026-07-31", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(400);
  });

  it("rejects GET /api/vitals/range with an invalid to, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals/range?from=2026-07-01&to=nope", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(400);
  });

  it("rejects GET /api/vitals/range when from is later than to, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals/range?from=2026-07-31&to=2026-07-01", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(400);
  });

  it("rejects GET /api/vitals/range when the span exceeds the max, as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/vitals/range?from=2025-01-01&to=2026-12-31", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(400);
  });
});
