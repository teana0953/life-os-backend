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
import { isActiveOn } from "../../../src/contexts/notifications/domain/care-schedule";
import type {
  ActiveCareSchedule,
  ActiveScheduleForUser,
  CareCategory,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
  CareScheduleInput,
  CreateCareItemInput,
  UpdateCareItemPatch,
} from "../../../src/contexts/notifications/domain/care-item";
import type { CareLog, CareLogRepository, CareLogStatus, CreateCareLogInput } from "../../../src/contexts/notifications/domain/care-log";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";
import { stubFriendInviteRepository, stubFriendshipRepository } from "./social-stubs";
import {
  stubExpenseGroupRepository,
  stubSettlementRepository,
  stubSplitBalanceRepository,
  stubSplitExpenseRepository,
  stubSplitFriendChecker,
  stubSplitSpendingRepository,
} from "./split-stubs";

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

class InMemoryCareItemRepository implements CareItemRepository {
  private byId = new Map<string, CareItemWithSchedules>();
  private nextId = 1;
  private nextScheduleId = 1;

  private scheduleInputToSchedule(careItemId: string, input: CareScheduleInput): CareSchedule {
    return {
      id: input.id ?? `sched-${this.nextScheduleId++}`,
      careItemId,
      timeOfDay: input.timeOfDay,
      repeatDays: input.repeatDays,
      weekInterval: input.weekInterval,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      doseQuantity: input.doseQuantity,
      nagIntervalMinutes: input.nagIntervalMinutes,
      enabled: input.enabled,
    };
  }

  async create(input: CreateCareItemInput): Promise<CareItemWithSchedules> {
    const id = `item-${this.nextId++}`;
    const item: CareItemWithSchedules = {
      id,
      userId: input.userId,
      category: input.category,
      title: input.title,
      note: input.note ?? null,
      dose: input.dose ?? null,
      stock: input.stock ?? null,
      stockAlert: input.stockAlert ?? null,
      schedules: input.schedules.map((s) => this.scheduleInputToSchedule(id, s)),
    };
    this.byId.set(id, item);
    return item;
  }

  async listByUser(userId: string, category?: CareCategory): Promise<CareItemWithSchedules[]> {
    return [...this.byId.values()].filter((i) => i.userId === userId && (!category || i.category === category));
  }

  async get(id: string): Promise<CareItemWithSchedules | null> {
    return this.byId.get(id) ?? null;
  }

  async getByScheduleId(scheduleId: string): Promise<CareItemWithSchedules | null> {
    for (const item of this.byId.values()) {
      if (item.schedules.some((s) => s.id === scheduleId)) return item;
    }
    return null;
  }

  async update(id: string, userId: string, patch: UpdateCareItemPatch): Promise<CareItemWithSchedules | null> {
    const existing = this.byId.get(id);
    if (!existing || existing.userId !== userId) return null;
    const updated: CareItemWithSchedules = {
      ...existing,
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.dose !== undefined ? { dose: patch.dose } : {}),
      ...(patch.stock !== undefined ? { stock: patch.stock } : {}),
      ...(patch.stockAlert !== undefined ? { stockAlert: patch.stockAlert } : {}),
      schedules: patch.schedules !== undefined ? patch.schedules.map((s) => this.scheduleInputToSchedule(id, s)) : existing.schedules,
    };
    this.byId.set(id, updated);
    return updated;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = this.byId.get(id);
    if (!existing || existing.userId !== userId) return false;
    this.byId.delete(id);
    return true;
  }

  async listActiveSchedules(): Promise<ActiveCareSchedule[]> {
    throw new Error("not used by these tests");
  }

  /** Mirrors DrizzleCareItemRepository.listActiveSchedulesForUserOn: enabled + owned + active-today, ordered by time then title. */
  async listActiveSchedulesForUserOn(userId: string, localDate: string): Promise<ActiveScheduleForUser[]> {
    const rows: ActiveScheduleForUser[] = [];
    for (const item of this.byId.values()) {
      if (item.userId !== userId) continue;
      for (const schedule of item.schedules) {
        if (schedule.enabled && isActiveOn(schedule, localDate)) rows.push({ item, schedule });
      }
    }
    return rows.sort((a, b) => a.schedule.timeOfDay.localeCompare(b.schedule.timeOfDay) || a.item.title.localeCompare(b.item.title));
  }

  async decrementStock(itemId: string, amount: number): Promise<void> {
    const item = this.byId.get(itemId);
    if (item && item.stock !== null) item.stock = Math.max(0, item.stock - amount);
  }

  async incrementStock(itemId: string, amount: number): Promise<void> {
    const item = this.byId.get(itemId);
    if (item && item.stock !== null) item.stock = item.stock + amount;
  }

  size(): number {
    return this.byId.size;
  }
}

class InMemoryCareLogRepository implements CareLogRepository {
  private bySlot = new Map<string, CareLog>();
  private nextId = 1;

  private key(scheduleId: string, localDate: string, timeOfDay: string): string {
    return `${scheduleId}|${localDate}|${timeOfDay}`;
  }

  async upsertIfAbsent(input: CreateCareLogInput): Promise<{ log: CareLog; created: boolean }> {
    const key = this.key(input.careScheduleId, input.localDate, input.timeOfDay);
    const existing = this.bySlot.get(key);
    if (existing) return { log: existing, created: false };
    const log: CareLog = {
      id: `log-${this.nextId++}`,
      userId: input.userId,
      careItemId: input.careItemId,
      careScheduleId: input.careScheduleId,
      localDate: input.localDate,
      timeOfDay: input.timeOfDay,
      status: input.status,
      doneTime: input.doneTime,
      doseQuantity: input.doseQuantity,
    };
    this.bySlot.set(key, log);
    return { log, created: true };
  }

  async getBySlot(careScheduleId: string, localDate: string, timeOfDay: string): Promise<CareLog | null> {
    return this.bySlot.get(this.key(careScheduleId, localDate, timeOfDay)) ?? null;
  }

  async listByUserAndDate(userId: string, localDate: string): Promise<CareLog[]> {
    return [...this.bySlot.values()].filter((log) => log.userId === userId && log.localDate === localDate);
  }

  async listByUserAndDateRange(userId: string, from: string, to: string): Promise<CareLog[]> {
    return [...this.bySlot.values()].filter((log) => log.userId === userId && log.localDate >= from && log.localDate <= to);
  }

  async upsert(input: CreateCareLogInput): Promise<{ log: CareLog; previousStatus: CareLogStatus | null }> {
    const key = this.key(input.careScheduleId, input.localDate, input.timeOfDay);
    const existing = this.bySlot.get(key);
    const log: CareLog = {
      id: existing?.id ?? `log-${this.nextId++}`,
      userId: input.userId,
      careItemId: input.careItemId,
      careScheduleId: input.careScheduleId,
      localDate: input.localDate,
      timeOfDay: input.timeOfDay,
      status: input.status,
      doneTime: input.doneTime,
      doseQuantity: input.doseQuantity,
    };
    this.bySlot.set(key, log);
    return { log, previousStatus: existing?.status ?? null };
  }
}

function buildApp() {
  const careItemRepository = new InMemoryCareItemRepository();
  const careLogRepository = new InMemoryCareLogRepository();
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
    careItemRepository,
    careLogRepository,
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
    budgetAlertNotifier: {
      notify: notImplemented,
    },
    vapidPublicKey: "",
    friendshipRepository: stubFriendshipRepository,
    friendInviteRepository: stubFriendInviteRepository,
    expenseGroupRepository: stubExpenseGroupRepository,
    splitExpenseRepository: stubSplitExpenseRepository,
    splitBalanceRepository: stubSplitBalanceRepository,
    splitFriendChecker: stubSplitFriendChecker,
    splitSettlementRepository: stubSettlementRepository,
    splitSpendingRepository: stubSplitSpendingRepository,
    ping: async () => {},
  });
  return { app, careItemRepository, careLogRepository };
}

interface ScheduleJson {
  id: string;
  time_of_day: string;
  repeat_days: number[];
  week_interval: number;
  start_date: string;
  end_date: string | null;
  dose_quantity: number;
  nag_interval_minutes: number;
  enabled: boolean;
}

interface CareItemJson {
  id: string;
  category: string;
  title: string;
  note: string | null;
  dose: string | null;
  stock: number | null;
  stock_alert: number | null;
  schedules: ScheduleJson[];
}

const VALID_SCHEDULE = {
  time_of_day: "08:00",
  repeat_days: [1, 3, 5],
  week_interval: 1,
  start_date: "2026-07-01",
  end_date: null,
  dose_quantity: 1,
  nag_interval_minutes: 15,
  enabled: true,
};

const VALID_BODY = {
  category: "medication",
  title: "降血壓藥",
  note: null,
  dose: "5mg",
  stock: 30,
  stock_alert: 5,
  schedules: [VALID_SCHEDULE],
};

async function authed(uid = "uid-1") {
  return { Authorization: `Bearer ${await validToken(uid)}`, "Content-Type": "application/json" };
}

describe("care item HTTP routes", () => {
  it("requires auth for every endpoint", async () => {
    const { app } = buildApp();

    expect((await app.request("/api/care/items")).status).toBe(401);
    expect((await app.request("/api/care/items", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/care/items/x", { method: "PATCH" })).status).toBe(401);
    expect((await app.request("/api/care/items/x", { method: "DELETE" })).status).toBe(401);
    expect((await app.request("/api/care/log", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/care/today")).status).toBe(401);
    expect((await app.request("/api/care/range?from=2026-07-01&to=2026-07-02")).status).toBe(401);
    expect((await app.request("/api/care/log", { method: "PUT" })).status).toBe(401);
  });

  it("creates and lists a care item with its schedules (round trip)", async () => {
    const { app } = buildApp();
    const headers = await authed();

    const createRes = await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as CareItemJson;
    expect(created).toMatchObject({ category: "medication", title: "降血壓藥", dose: "5mg", stock: 30, stock_alert: 5 });
    expect(created.schedules).toHaveLength(1);
    expect(created.schedules[0]).toMatchObject({ time_of_day: "08:00", repeat_days: [1, 3, 5] });

    const listRes = await app.request("/api/care/items", { headers });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { items: CareItemJson[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe(created.id);
  });

  it("creates a rehab item with a note and no dose/stock", async () => {
    const { app } = buildApp();
    const headers = await authed();

    const res = await app.request("/api/care/items", {
      method: "POST",
      headers,
      body: JSON.stringify({ category: "rehab", title: "復健", note: "每天伸展 15 分鐘", schedules: [VALID_SCHEDULE] }),
    });

    expect(res.status).toBe(200);
    const created = (await res.json()) as CareItemJson;
    expect(created).toMatchObject({ category: "rehab", note: "每天伸展 15 分鐘", dose: null, stock: null });
  });

  it("filters the list by category", async () => {
    const { app } = buildApp();
    const headers = await authed();
    await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) });
    await app.request("/api/care/items", {
      method: "POST",
      headers,
      body: JSON.stringify({ category: "rehab", title: "復健", schedules: [VALID_SCHEDULE] }),
    });

    const res = await app.request("/api/care/items?category=rehab", { headers });

    const list = (await res.json()) as { items: CareItemJson[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0].category).toBe("rehab");
  });

  it.each([
    ["unknown category", { ...VALID_BODY, category: "unknown" }],
    ["time_of_day not HH:mm", { ...VALID_BODY, schedules: [{ ...VALID_SCHEDULE, time_of_day: "8:00" }] }],
    ["repeat_days entry out of range", { ...VALID_BODY, schedules: [{ ...VALID_SCHEDULE, repeat_days: [7] }] }],
    ["week_interval below 1", { ...VALID_BODY, schedules: [{ ...VALID_SCHEDULE, week_interval: 0 }] }],
    ["start_date not a real date", { ...VALID_BODY, schedules: [{ ...VALID_SCHEDULE, start_date: "2026-02-30" }] }],
    ["end_date before start_date", { ...VALID_BODY, schedules: [{ ...VALID_SCHEDULE, start_date: "2026-07-10", end_date: "2026-07-01" }] }],
    ["title missing", { ...VALID_BODY, title: undefined }],
    ["stock negative", { ...VALID_BODY, stock: -1 }],
  ])("rejects a create with %s, as 400", async (_name, body) => {
    const { app } = buildApp();
    const headers = await authed();

    const res = await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(body) });

    expect(res.status).toBe(400);
  });

  it("update is owner-scoped: the owner can update, a non-owner id is unaffected (404)", async () => {
    const { app } = buildApp();
    const ownerHeaders = await authed("uid-1");
    const otherHeaders = await authed("uid-2");
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers: ownerHeaders, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;

    const otherUpdate = await app.request(`/api/care/items/${created.id}`, {
      method: "PATCH",
      headers: otherHeaders,
      body: JSON.stringify({ title: "hacked" }),
    });
    expect(otherUpdate.status).toBe(404);

    const ownerUpdate = await app.request(`/api/care/items/${created.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ title: "新標題" }),
    });
    expect(ownerUpdate.status).toBe(200);
    expect(((await ownerUpdate.json()) as CareItemJson).title).toBe("新標題");
  });

  it("PATCH omitting schedules leaves them unchanged; providing schedules upserts by id", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const existingScheduleId = created.schedules[0].id;

    const titleOnly = await app.request(`/api/care/items/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "新標題" }),
    });
    expect(titleOnly.status).toBe(200);
    const titleOnlyJson = (await titleOnly.json()) as CareItemJson;
    expect(titleOnlyJson.schedules).toEqual(created.schedules);

    const withSchedules = await app.request(`/api/care/items/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        schedules: [
          { ...VALID_SCHEDULE, id: existingScheduleId, time_of_day: "09:00" },
          { ...VALID_SCHEDULE, time_of_day: "20:00" },
        ],
      }),
    });
    expect(withSchedules.status).toBe(200);
    const withSchedulesJson = (await withSchedules.json()) as CareItemJson;
    expect(withSchedulesJson.schedules).toHaveLength(2);
    expect(withSchedulesJson.schedules.find((s) => s.id === existingScheduleId)?.time_of_day).toBe("09:00");
  });

  it("rejects an update with an invalid field, as 400", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;

    const res = await app.request(`/api/care/items/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ schedules: [{ ...VALID_SCHEDULE, week_interval: 0 }] }),
    });

    expect(res.status).toBe(400);
  });

  it("delete is owner-scoped: a non-owner id is not deleted", async () => {
    const { app, careItemRepository } = buildApp();
    const ownerHeaders = await authed("uid-1");
    const otherHeaders = await authed("uid-2");
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers: ownerHeaders, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;

    const otherDelete = await app.request(`/api/care/items/${created.id}`, { method: "DELETE", headers: otherHeaders });
    expect(((await otherDelete.json()) as { deleted: boolean }).deleted).toBe(false);
    expect(careItemRepository.size()).toBe(1);

    const ownerDelete = await app.request(`/api/care/items/${created.id}`, { method: "DELETE", headers: ownerHeaders });
    expect(((await ownerDelete.json()) as { deleted: boolean }).deleted).toBe(true);
    expect(careItemRepository.size()).toBe(0);
  });
});

describe("POST /api/care/log", () => {
  it("records a done log and returns 200", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "POST",
      headers,
      body: JSON.stringify({ care_schedule_id: scheduleId, local_date: "2026-07-24", time_of_day: "08:00", status: "done" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; care_schedule_id: string };
    expect(body).toMatchObject({ status: "done", care_schedule_id: scheduleId });
  });

  it("a done for a tracked medication decrements stock by dose_quantity", async () => {
    const { app, careItemRepository } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request(
        "/api/care/items",
        { method: "POST", headers, body: JSON.stringify({ ...VALID_BODY, stock: 10, schedules: [{ ...VALID_SCHEDULE, dose_quantity: 3 }] }) },
      )
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    await app.request("/api/care/log", {
      method: "POST",
      headers,
      body: JSON.stringify({ care_schedule_id: scheduleId, local_date: "2026-07-24", time_of_day: "08:00", status: "done" }),
    });

    expect((await careItemRepository.get(created.id))?.stock).toBe(7);
  });

  it("returns 404 for a schedule not owned by the caller", async () => {
    const { app } = buildApp();
    const ownerHeaders = await authed("uid-1");
    const otherHeaders = await authed("uid-2");
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers: ownerHeaders, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "POST",
      headers: otherHeaders,
      body: JSON.stringify({ care_schedule_id: scheduleId, local_date: "2026-07-24", time_of_day: "08:00", status: "done" }),
    });

    expect(res.status).toBe(404);
  });

  it("rejects a bad status, as 400", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "POST",
      headers,
      body: JSON.stringify({ care_schedule_id: scheduleId, local_date: "2026-07-24", time_of_day: "08:00", status: "missed" }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a time_of_day that is not HH:mm, as 400", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "POST",
      headers,
      body: JSON.stringify({ care_schedule_id: scheduleId, local_date: "2026-07-24", time_of_day: "8:00", status: "done" }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a local_date that is not YYYY-MM-DD, as 400", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "POST",
      headers,
      body: JSON.stringify({ care_schedule_id: scheduleId, local_date: "2026/07/24", time_of_day: "08:00", status: "done" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/care/today", () => {
  // Empty repeat_days = every day (D3), a start_date in the past and no end_date, so this
  // schedule is active regardless of the date the test suite happens to run on.
  const EVERY_DAY_SCHEDULE = {
    time_of_day: "08:00",
    repeat_days: [],
    week_interval: 1,
    start_date: "2020-01-01",
    end_date: null,
    dose_quantity: 1,
    nag_interval_minutes: 15,
    enabled: true,
  };

  it("returns { date, items } with the caller's active-today slot", async () => {
    const { app } = buildApp();
    const headers = await authed();
    await app.request("/api/care/items", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...VALID_BODY, schedules: [EVERY_DAY_SCHEDULE] }),
    });

    const res = await app.request("/api/care/today", { headers });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { date: string; items: Record<string, unknown>[] };
    expect(typeof body.date).toBe("string");
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      category: "medication",
      title: "降血壓藥",
      dose: "5mg",
      time_of_day: "08:00",
      local_date: body.date,
    });
    expect(["pending", "overdue"]).toContain(body.items[0].status);
  });

  it("is owner-scoped: another user's schedule does not appear", async () => {
    const { app } = buildApp();
    const ownerHeaders = await authed("uid-1");
    const otherHeaders = await authed("uid-2");
    await app.request("/api/care/items", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ ...VALID_BODY, schedules: [EVERY_DAY_SCHEDULE] }),
    });

    const res = await app.request("/api/care/today", { headers: otherHeaders });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it("returns { date, items: [] } when the caller has no items", async () => {
    const { app } = buildApp();
    const headers = await authed();

    const res = await app.request("/api/care/today", { headers });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { date: string; items: unknown[] };
    expect(typeof body.date).toBe("string");
    expect(body.items).toEqual([]);
  });
});

interface RangeSlotJson {
  care_item_id: string;
  care_schedule_id: string;
  category: string;
  title: string;
  note: string | null;
  dose: string | null;
  time_of_day: string;
  local_date: string;
  status: string;
  done_time: string | null;
  dose_quantity: number;
}

interface RangeJson {
  from: string;
  to: string;
  days: { date: string; items: RangeSlotJson[] }[];
}

describe("GET /api/care/range", () => {
  // start_date well in the past, no end_date, empty repeat_days (every day) so
  // every date in the (also strictly-past) test range is reliably "missed"
  // (no log) regardless of when the test suite actually runs.
  const EVERY_DAY_SCHEDULE = {
    time_of_day: "08:00",
    repeat_days: [],
    week_interval: 1,
    start_date: "2020-01-01",
    end_date: null,
    dose_quantity: 1,
    nag_interval_minutes: 15,
    enabled: true,
  };

  it("returns { from, to, days } with one missed slot per day for a strictly-past range", async () => {
    const { app } = buildApp();
    const headers = await authed();
    await app.request("/api/care/items", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...VALID_BODY, schedules: [EVERY_DAY_SCHEDULE] }),
    });

    const res = await app.request("/api/care/range?from=2020-01-01&to=2020-01-03", { headers });

    expect(res.status).toBe(200);
    const body = (await res.json()) as RangeJson;
    expect(body.from).toBe("2020-01-01");
    expect(body.to).toBe("2020-01-03");
    expect(body.days.map((d) => d.date)).toEqual(["2020-01-01", "2020-01-02", "2020-01-03"]);
    for (const day of body.days) {
      expect(day.items).toHaveLength(1);
      expect(day.items[0]).toMatchObject({
        category: "medication",
        title: "降血壓藥",
        dose: "5mg",
        time_of_day: "08:00",
        local_date: day.date,
        status: "missed",
        done_time: null,
      });
    }
  });

  it("a disabled schedule is excluded from every day in the range", async () => {
    const { app } = buildApp();
    const headers = await authed();
    await app.request("/api/care/items", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...VALID_BODY, schedules: [{ ...EVERY_DAY_SCHEDULE, enabled: false }] }),
    });

    const res = await app.request("/api/care/range?from=2020-01-01&to=2020-01-02", { headers });

    const body = (await res.json()) as RangeJson;
    expect(body.days.every((d) => d.items.length === 0)).toBe(true);
  });

  it("is owner-scoped: another user's schedule does not appear", async () => {
    const { app } = buildApp();
    const ownerHeaders = await authed("uid-1");
    const otherHeaders = await authed("uid-2");
    await app.request("/api/care/items", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ ...VALID_BODY, schedules: [EVERY_DAY_SCHEDULE] }),
    });

    const res = await app.request("/api/care/range?from=2020-01-01&to=2020-01-01", { headers: otherHeaders });

    const body = (await res.json()) as RangeJson;
    expect(body.days[0].items).toEqual([]);
  });

  it.each([
    ["missing from", "?to=2026-07-02"],
    ["missing to", "?from=2026-07-01"],
    ["from not YYYY-MM-DD", "?from=2026/07/01&to=2026-07-02"],
    ["to not YYYY-MM-DD", "?from=2026-07-01&to=2026/07/02"],
    ["from later than to", "?from=2026-07-02&to=2026-07-01"],
    ["span exceeding 366 days", "?from=2020-01-01&to=2021-01-05"],
  ])("rejects %s, as 400", async (_name, qs) => {
    const { app } = buildApp();
    const headers = await authed();

    const res = await app.request(`/api/care/range${qs}`, { headers });

    expect(res.status).toBe(400);
  });
});

describe("PUT /api/care/log", () => {
  it("overwrites a slot's status: done -> skipped restores decremented stock", async () => {
    const { app, careItemRepository } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request(
        "/api/care/items",
        { method: "POST", headers, body: JSON.stringify({ ...VALID_BODY, stock: 10, schedules: [{ ...VALID_SCHEDULE, dose_quantity: 3 }] }) },
      )
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;
    const slotBody = { care_schedule_id: scheduleId, local_date: "2020-01-01", time_of_day: "08:00" };

    await app.request("/api/care/log", { method: "POST", headers, body: JSON.stringify({ ...slotBody, status: "done" }) });
    expect((await careItemRepository.get(created.id))?.stock).toBe(7);

    const res = await app.request("/api/care/log", { method: "PUT", headers, body: JSON.stringify({ ...slotBody, status: "skipped" }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("skipped");
    expect((await careItemRepository.get(created.id))?.stock).toBe(10);
  });

  it("PUT with no prior log still decrements stock (not-done -> done)", async () => {
    const { app, careItemRepository } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request(
        "/api/care/items",
        { method: "POST", headers, body: JSON.stringify({ ...VALID_BODY, stock: 10, schedules: [{ ...VALID_SCHEDULE, dose_quantity: 3 }] }) },
      )
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "PUT",
      headers,
      body: JSON.stringify({ care_schedule_id: scheduleId, local_date: "2020-01-01", time_of_day: "08:00", status: "done" }),
    });

    expect(res.status).toBe(200);
    expect((await careItemRepository.get(created.id))?.stock).toBe(7);
  });

  it("returns 404 for a schedule not owned by the caller", async () => {
    const { app } = buildApp();
    const ownerHeaders = await authed("uid-1");
    const otherHeaders = await authed("uid-2");
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers: ownerHeaders, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "PUT",
      headers: otherHeaders,
      body: JSON.stringify({ care_schedule_id: scheduleId, local_date: "2020-01-01", time_of_day: "08:00", status: "done" }),
    });

    expect(res.status).toBe(404);
  });

  it("rejects status=missed, as 400 (missed is derived, never editable)", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "PUT",
      headers,
      body: JSON.stringify({ care_schedule_id: scheduleId, local_date: "2020-01-01", time_of_day: "08:00", status: "missed" }),
    });

    expect(res.status).toBe(400);
  });

  it("a supplied done_time with a timezone offset is recorded as the same absolute instant, normalized to UTC in the response", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        care_schedule_id: scheduleId,
        local_date: "2020-01-01",
        time_of_day: "08:00",
        status: "done",
        done_time: "2026-07-20T21:30:00+08:00",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { done_time: string | null };
    expect(body.done_time).not.toBeNull();
    expect(new Date(body.done_time as string).getTime()).toBe(new Date("2026-07-20T13:30:00.000Z").getTime());
  });

  it("an omitted done_time on a first completion still records the current time", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const before = Date.now();
    const res = await app.request("/api/care/log", {
      method: "PUT",
      headers,
      body: JSON.stringify({ care_schedule_id: scheduleId, local_date: "2020-01-01", time_of_day: "08:00", status: "done" }),
    });
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { done_time: string | null };
    expect(body.done_time).not.toBeNull();
    // Bracketed, not just non-null: "not null" would also pass for an
    // implementation that wrote epoch 0 or any fixed constant.
    const recorded = new Date(body.done_time as string).getTime();
    expect(recorded).toBeGreaterThanOrEqual(before);
    expect(recorded).toBeLessThanOrEqual(after);
  });

  // The end-to-end half of the reason this change exists. The unit layer
  // guards the decision itself; without this, moving that decision into the
  // repository (or defaulting done_time in the handler) would break the
  // preserve semantics with every test still green.
  it("an omitted done_time on an ALREADY-done slot preserves the recorded completion time end to end", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;
    const slot = { care_schedule_id: scheduleId, local_date: "2020-01-01", time_of_day: "08:00" };

    // Backfill "it was actually 21:30 local".
    const first = (await (
      await app.request("/api/care/log", {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...slot, status: "done", done_time: "2026-07-20T21:30:00+08:00" }),
      })
    ).json()) as { done_time: string | null };

    // Re-save the same outcome without a time — must not refresh it to now.
    const res = await app.request("/api/care/log", {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...slot, status: "done" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { done_time: string | null };
    expect(body.done_time).toBe(first.done_time);
    expect(body.done_time).toBe("2026-07-20T13:30:00.000Z");
  });

  it("a done_time supplied with status=skipped is ignored: the response has done_time null, and the request is not a 400", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        care_schedule_id: scheduleId,
        local_date: "2020-01-01",
        time_of_day: "08:00",
        status: "skipped",
        done_time: "2026-07-20T21:30:00+08:00",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { done_time: string | null };
    expect(body.done_time).toBeNull();
  });

  it("rejects a malformed done_time, as 400", async () => {
    const { app } = buildApp();
    const headers = await authed();
    const created = (await (
      await app.request("/api/care/items", { method: "POST", headers, body: JSON.stringify(VALID_BODY) })
    ).json()) as CareItemJson;
    const scheduleId = created.schedules[0].id;

    const res = await app.request("/api/care/log", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        care_schedule_id: scheduleId,
        local_date: "2020-01-01",
        time_of_day: "08:00",
        status: "done",
        done_time: "not-a-timestamp",
      }),
    });

    expect(res.status).toBe(400);
  });
});
