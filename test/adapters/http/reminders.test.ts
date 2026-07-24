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
import type {
  ActiveReminderSchedule,
  CreateReminderScheduleInput,
  ReminderSchedule,
  ReminderScheduleRepository,
  UpdateReminderSchedulePatch,
} from "../../../src/contexts/notifications/domain/reminder-schedule";
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

class InMemoryReminderScheduleRepository implements ReminderScheduleRepository {
  private byId = new Map<string, ReminderSchedule>();
  private nextId = 1;

  async create(input: CreateReminderScheduleInput): Promise<ReminderSchedule> {
    const schedule: ReminderSchedule = { id: `sched-${this.nextId++}`, ...input };
    this.byId.set(schedule.id, schedule);
    return schedule;
  }

  async listByUser(userId: string): Promise<ReminderSchedule[]> {
    return [...this.byId.values()].filter((s) => s.userId === userId);
  }

  async get(id: string): Promise<ReminderSchedule | null> {
    return this.byId.get(id) ?? null;
  }

  async update(id: string, userId: string, patch: UpdateReminderSchedulePatch): Promise<ReminderSchedule | null> {
    const existing = this.byId.get(id);
    if (!existing || existing.userId !== userId) return null;
    const updated: ReminderSchedule = { ...existing, ...patch };
    this.byId.set(id, updated);
    return updated;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = this.byId.get(id);
    if (!existing || existing.userId !== userId) return false;
    this.byId.delete(id);
    return true;
  }

  async listActiveAll(): Promise<ActiveReminderSchedule[]> {
    throw new Error("not used by these tests");
  }

  size(): number {
    return this.byId.size;
  }
}

function buildApp() {
  const reminderScheduleRepository = new InMemoryReminderScheduleRepository();
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
    pushSubscriptionRepository: {
      upsert: notImplemented,
      listByUser: notImplemented,
      deleteByEndpoint: notImplemented,
    },
    pushSender: { send: notImplemented },
    reminderScheduleRepository,
    vapidPublicKey: "",
    ping: async () => {},
  });
  return { app, reminderScheduleRepository };
}

interface ReminderJson {
  id: string;
  label: string;
  times: string[];
  days_of_week: number[];
  week_interval: number;
  anchor_date: string;
  enabled: boolean;
}

const VALID_BODY = {
  label: "降血壓藥",
  times: ["08:00", "20:00"],
  days_of_week: [1, 3, 5],
  week_interval: 1,
  anchor_date: "2026-07-01",
};

async function authed(uid = "uid-1") {
  return { Authorization: `Bearer ${await validToken(uid)}`, "Content-Type": "application/json" };
}

describe("medication reminder HTTP routes", () => {
  it("requires auth for every endpoint", async () => {
    const { app } = buildApp();

    expect((await app.request("/api/reminders/medication")).status).toBe(401);
    expect((await app.request("/api/reminders/medication", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/reminders/medication/x", { method: "PATCH" })).status).toBe(401);
    expect((await app.request("/api/reminders/medication/x", { method: "DELETE" })).status).toBe(401);
  });

  it("creates and lists a medication reminder (round trip)", async () => {
    const { app } = buildApp();
    const headers = await authed();

    const createRes = await app.request("/api/reminders/medication", {
      method: "POST",
      headers,
      body: JSON.stringify(VALID_BODY),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as ReminderJson;
    expect(created).toMatchObject({
      label: VALID_BODY.label,
      times: VALID_BODY.times,
      days_of_week: VALID_BODY.days_of_week,
      week_interval: VALID_BODY.week_interval,
      anchor_date: VALID_BODY.anchor_date,
      enabled: true,
    });

    const listRes = await app.request("/api/reminders/medication", { headers });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { reminders: ReminderJson[] };
    expect(list.reminders).toHaveLength(1);
    expect(list.reminders[0].id).toBe(created.id);
  });

  it.each([
    ["times entry not HH:mm", { ...VALID_BODY, times: ["8:00"] }],
    ["days_of_week entry out of range", { ...VALID_BODY, days_of_week: [7] }],
    ["week_interval below 1", { ...VALID_BODY, week_interval: 0 }],
    ["anchor_date not a real date", { ...VALID_BODY, anchor_date: "2026-02-30" }],
    ["times not an array of strings", { ...VALID_BODY, times: [8] }],
    ["days_of_week not an array of numbers", { ...VALID_BODY, days_of_week: ["a"] }],
    ["label missing", { ...VALID_BODY, label: undefined }],
    ["times empty", { ...VALID_BODY, times: [] }],
    ["days_of_week empty", { ...VALID_BODY, days_of_week: [] }],
  ])("rejects a create with %s, as 400", async (_name, body) => {
    const { app } = buildApp();
    const headers = await authed();

    const res = await app.request("/api/reminders/medication", { method: "POST", headers, body: JSON.stringify(body) });

    expect(res.status).toBe(400);
  });

  it("update is owner-scoped: the owner can toggle enabled, a non-owner id is unaffected (404)", async () => {
    const { app } = buildApp();
    const ownerHeaders = await authed("uid-1");
    const otherHeaders = await authed("uid-2");

    const created = (await (
      await app.request("/api/reminders/medication", { method: "POST", headers: ownerHeaders, body: JSON.stringify(VALID_BODY) })
    ).json()) as ReminderJson;

    const otherUpdate = await app.request(`/api/reminders/medication/${created.id}`, {
      method: "PATCH",
      headers: otherHeaders,
      body: JSON.stringify({ enabled: false }),
    });
    expect(otherUpdate.status).toBe(404);

    const ownerUpdate = await app.request(`/api/reminders/medication/${created.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ enabled: false }),
    });
    expect(ownerUpdate.status).toBe(200);
    expect(((await ownerUpdate.json()) as ReminderJson).enabled).toBe(false);
  });

  it("update omitting `enabled` does not change it (only patches the given field)", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/reminders/medication", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as ReminderJson;

    const disableRes = await app.request(`/api/reminders/medication/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled: false }),
    });
    expect(disableRes.status).toBe(200);
    expect(((await disableRes.json()) as ReminderJson).enabled).toBe(false);

    const labelRes = await app.request(`/api/reminders/medication/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ label: "新標籤" }),
    });
    expect(labelRes.status).toBe(200);
    const labelUpdated = (await labelRes.json()) as ReminderJson;
    expect(labelUpdated.label).toBe("新標籤");
    expect(labelUpdated.enabled).toBe(false);

    const timesRes = await app.request(`/api/reminders/medication/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ times: ["09:00"] }),
    });
    expect(timesRes.status).toBe(200);
    const timesUpdated = (await timesRes.json()) as ReminderJson;
    expect(timesUpdated.times).toEqual(["09:00"]);
    expect(timesUpdated.enabled).toBe(false);

    const enableRes = await app.request(`/api/reminders/medication/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled: true }),
    });
    expect(enableRes.status).toBe(200);
    expect(((await enableRes.json()) as ReminderJson).enabled).toBe(true);
  });

  it("rejects an update with an invalid field, as 400", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/reminders/medication", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as ReminderJson;

    const res = await app.request(`/api/reminders/medication/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ week_interval: 0 }),
    });

    expect(res.status).toBe(400);
  });

  it("delete is owner-scoped: a non-owner id is not deleted", async () => {
    const { app, reminderScheduleRepository } = buildApp();
    const ownerHeaders = await authed("uid-1");
    const otherHeaders = await authed("uid-2");
    const created = (await (
      await app.request("/api/reminders/medication", { method: "POST", headers: ownerHeaders, body: JSON.stringify(VALID_BODY) })
    ).json()) as ReminderJson;

    const otherDelete = await app.request(`/api/reminders/medication/${created.id}`, { method: "DELETE", headers: otherHeaders });
    expect(((await otherDelete.json()) as { deleted: boolean }).deleted).toBe(false);
    expect(reminderScheduleRepository.size()).toBe(1);

    const ownerDelete = await app.request(`/api/reminders/medication/${created.id}`, { method: "DELETE", headers: ownerHeaders });
    expect(((await ownerDelete.json()) as { deleted: boolean }).deleted).toBe(true);
    expect(reminderScheduleRepository.size()).toBe(0);
  });
});
