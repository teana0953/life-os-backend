import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { FoodDictionaryRepository } from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../../src/contexts/health/domain/meal-repository";
import type { DailyTargetRepository } from "../../../src/contexts/health/domain/daily-target-repository";
import type { WaterRepository } from "../../../src/contexts/health/domain/water-repository";
import type { BowelRepository } from "../../../src/contexts/health/domain/bowel-repository";
import type { BodyProfileRepository } from "../../../src/contexts/health/domain/body-profile-repository";
import type { VitalsRepository } from "../../../src/contexts/health/domain/vitals-repository";
import type { ExerciseEntry } from "../../../src/contexts/health/domain/exercise-entry";
import type { AddExerciseEntryInput, ExerciseRepository } from "../../../src/contexts/health/domain/exercise-repository";
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
const stubMenstrualRepository: MenstrualRepository = {
  add: notImplemented,
  listByUser: notImplemented,
  update: notImplemented,
  delete: notImplemented,
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

class InMemoryExerciseRepository implements ExerciseRepository {
  entries: ExerciseEntry[] = [];
  private nextId = 1;

  async addEntry(input: AddExerciseEntryInput): Promise<ExerciseEntry> {
    const entry: ExerciseEntry = {
      id: `entry-${this.nextId}`,
      userId: input.userId,
      day: input.day,
      activityId: input.activityId,
      durationMinutes: input.durationMinutes,
      note: input.note,
      createdAt: new Date(Date.UTC(2026, 6, 18, 0, 0, this.nextId)),
    };
    this.nextId++;
    this.entries.push(entry);
    return entry;
  }

  async listByDay(userId: string, day: string): Promise<ExerciseEntry[]> {
    return this.entries
      .filter((e) => e.userId === userId && e.day === day)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async deleteEntry(userId: string, entryId: string): Promise<boolean> {
    const idx = this.entries.findIndex((e) => e.id === entryId && e.userId === userId);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }
}

function buildApp() {
  const exerciseRepository = new InMemoryExerciseRepository();
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
    exerciseRepository,
    menstrualRepository: stubMenstrualRepository,
    bodyProfileRepository: stubBodyProfileRepository,
    healthCalendarRepository: { listLoggedDays: async () => [] },
    ping: async () => {},
  });
  return { app, exerciseRepository };
}

async function authedPost(app: ReturnType<typeof buildApp>["app"], token: string, body: unknown) {
  return app.request("/api/exercise", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("exercise HTTP routes", () => {
  it("requires auth for every /api/exercise endpoint", async () => {
    const { app } = buildApp();
    expect((await app.request("/api/exercise/activities")).status).toBe(401);
    expect((await app.request("/api/exercise?day=2026-07-18")).status).toBe(401);
    expect((await app.request("/api/exercise", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/exercise/some-id", { method: "DELETE" })).status).toBe(401);
  });

  it("lists the activity library", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/exercise/activities", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { activities: { id: string; name: string; category: string; intensity: string }[] };
    expect(body.activities.length).toBeGreaterThan(0);
    expect(body.activities[0]).toHaveProperty("id");
    expect(body.activities[0]).toHaveProperty("category");
  });

  it("reads empty defaults for an unrecorded day", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/exercise?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: "2026-07-18", entries: [], total_minutes: 0 });
  });

  it("appends entries and accumulates the day, enriched with activity details", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const post = await authedPost(app, token, { day: "2026-07-18", activity_id: "jogging", duration_minutes: 30, note: "morning" });
    expect(post.status).toBe(200);
    const created = (await post.json()) as Record<string, unknown>;
    expect(created).toMatchObject({
      activity_id: "jogging",
      activity_name: "慢跑",
      category: "aerobic",
      duration_minutes: 30,
      note: "morning",
    });
    expect(created.id).toBeTruthy();

    await authedPost(app, token, { day: "2026-07-18", activity_id: "squats", duration_minutes: 20, note: "" });

    const get = await app.request("/api/exercise?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });
    const day = (await get.json()) as { entries: unknown[]; total_minutes: number };
    expect(day.entries).toHaveLength(2);
    expect(day.total_minutes).toBe(50);
  });

  it("rejects a missing day, unknown activity, and a non-positive or non-integer duration as 400", async () => {
    const { app, exerciseRepository } = buildApp();
    const token = await validToken();

    expect((await authedPost(app, token, { activity_id: "jogging", duration_minutes: 30 })).status).toBe(400);
    expect((await authedPost(app, token, { day: "2026-07-18", activity_id: "nope", duration_minutes: 30 })).status).toBe(400);
    expect((await authedPost(app, token, { day: "2026-07-18", activity_id: "jogging", duration_minutes: 0 })).status).toBe(400);
    expect((await authedPost(app, token, { day: "2026-07-18", activity_id: "jogging", duration_minutes: -5 })).status).toBe(400);
    expect((await authedPost(app, token, { day: "2026-07-18", activity_id: "jogging", duration_minutes: "abc" })).status).toBe(400);
    expect((await authedPost(app, token, { day: "2026-07-18", activity_id: "jogging", duration_minutes: 30.5 })).status).toBe(400);
    expect(exerciseRepository.entries).toHaveLength(0);
  });

  it("deletes an owned entry and reports it", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const created = (await (await authedPost(app, token, { day: "2026-07-18", activity_id: "jogging", duration_minutes: 30, note: "" })).json()) as { id: string };

    const del = await app.request(`/api/exercise/${created.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: true });

    const day = (await (await app.request("/api/exercise?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } })).json()) as { entries: unknown[] };
    expect(day.entries).toHaveLength(0);
  });

  it("does nothing when deleting another user's entry", async () => {
    const { app } = buildApp();
    const owner = await validToken("uid-owner");
    const other = await validToken("uid-other");

    const created = (await (await authedPost(app, owner, { day: "2026-07-18", activity_id: "jogging", duration_minutes: 30, note: "" })).json()) as { id: string };

    const del = await app.request(`/api/exercise/${created.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${other}` } });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: false });

    const ownerDay = (await (await app.request("/api/exercise?day=2026-07-18", { headers: { Authorization: `Bearer ${owner}` } })).json()) as { entries: unknown[] };
    expect(ownerDay.entries).toHaveLength(1);
  });
});
