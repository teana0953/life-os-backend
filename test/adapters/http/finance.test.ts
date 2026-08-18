import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import type { FinanceTransaction } from "../../../src/contexts/finance/domain/finance-transaction";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";
import {
  FakeBudgetAlertNotifier,
  InMemoryFinanceBudgetRepository,
  InMemoryFinanceCategoryRepository,
  InMemoryFinanceTransactionRepository,
} from "../../contexts/finance/fakes";
import { InMemoryInstallmentPlanRepository } from "../../contexts/finance/installment-fakes";
import { InMemoryNetWorthRepository } from "../../contexts/finance/networth-fakes";
import {
  InMemoryExpenseGroupRepository,
  InMemoryFriendChecker,
  InMemorySettlementRepository,
  InMemorySplitExpenseRepository,
  TestUserDirectory,
} from "../../contexts/split/fakes";
import { stubFriendInviteRepository, stubFriendshipRepository } from "./social-stubs";
import { stubSplitActivityRepository, stubSplitBalanceRepository } from "./split-stubs";
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

  /** Optional so the many tests that never touch split routes can keep constructing this bare. */
  constructor(private readonly directory?: TestUserDirectory) {}

  async getOrCreate(input: GetOrCreateUserInput): Promise<User> {
    const existing = this.usersByFirebaseUid.get(input.firebaseUid);
    if (existing) return existing;
    const user: User = {
      // A real lowercase canonical uuid, since split routes reject anything
      // else as a 404/400 (mirroring `split.test.ts`'s user repository).
      id: crypto.randomUUID(),
      firebaseUid: input.firebaseUid,
      email: input.email,
      displayName: input.displayName,
      timezone: "Asia/Taipei",
      isAdmin: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    this.usersByFirebaseUid.set(input.firebaseUid, user);
    this.directory?.add(user.id, user.displayName ?? user.email);
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

/**
 * Lets `findById` hand back a snapshot and then let something else commit,
 * which is the only way to stage the window inside `updateTransaction`: it
 * reads the row, compares the split's facts, then writes. Nothing a request
 * can do reaches between those two, so the interleaving has to be injected at
 * the repository. The snapshot is taken *before* the hook runs — a real
 * `SELECT` returns values, not a live row — or the use case's own value
 * comparison would reject first and the case would prove nothing about the
 * write.
 */
class RacingFinanceTransactionRepository extends InMemoryFinanceTransactionRepository {
  onNextRead: (() => Promise<void>) | null = null;

  override async findById(id: string): Promise<FinanceTransaction | null> {
    const row = await super.findById(id);
    const snapshot = row === null ? null : { ...row };
    const hook = this.onNextRead;
    this.onNextRead = null;
    if (hook) await hook();
    return snapshot;
  }
}

function buildApp(overrides: { financeTransactionRepository?: InMemoryFinanceTransactionRepository } = {}) {
  const financeCategoryRepository = new InMemoryFinanceCategoryRepository();
  const financeTransactionRepository = overrides.financeTransactionRepository ?? new InMemoryFinanceTransactionRepository();
  const financeBudgetRepository = new InMemoryFinanceBudgetRepository(financeTransactionRepository);
  const financeNetWorthRepository = new InMemoryNetWorthRepository();
  const installmentPlanRepository = new InMemoryInstallmentPlanRepository(financeTransactionRepository);
  const budgetAlertNotifier = new FakeBudgetAlertNotifier();
  // Real (in-memory) split fakes, not stubs: the split-spending and
  // budget-non-interference tests below need to actually create a split
  // expense through `/api/split/expenses` and read it back.
  const userDirectory = new TestUserDirectory();
  const expenseGroupRepository = new InMemoryExpenseGroupRepository(userDirectory);
  // The mirrors land in the *same* transactions fake every finance endpoint
  // reads from — a separate list would put them out of reach of exactly the
  // assertions they exist for.
  const splitExpenseRepository = new InMemorySplitExpenseRepository(expenseGroupRepository, userDirectory, financeTransactionRepository);
  const splitFriendChecker = new InMemoryFriendChecker();
  const splitSettlementRepository = new InMemorySettlementRepository(expenseGroupRepository, userDirectory);
  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: new InMemoryUserRepository(userDirectory),
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
    pushDeliveryRepository: {
      registerSent: async () => {
        throw new Error("not implemented in this test's fakes");
      },
      markAcked: async () => {
        throw new Error("not implemented in this test's fakes");
      },
    },
    pushSender: {
      send: notImplemented,
    },
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
    financeCategoryRepository,
    financeTransactionRepository,
    financeBudgetRepository,
    financeNetWorthRepository,
    installmentPlanRepository,
    budgetAlertNotifier,
    vapidPublicKey: "",
    friendshipRepository: stubFriendshipRepository,
    friendInviteRepository: stubFriendInviteRepository,
    expenseGroupRepository,
    splitExpenseRepository,
    splitBalanceRepository: stubSplitBalanceRepository,
    splitFriendChecker,
    splitSettlementRepository,
    splitActivityRepository: stubSplitActivityRepository,
    // `InMemorySplitExpenseRepository` also implements `SplitSpendingRepository`.
    splitSpendingRepository: splitExpenseRepository,
    modelClient: stubModelClient,
    ping: async () => {},
  });
  return {
    app,
    financeCategoryRepository,
    financeTransactionRepository,
    financeBudgetRepository,
    financeNetWorthRepository,
    installmentPlanRepository,
    budgetAlertNotifier,
    expenseGroupRepository,
    splitExpenseRepository,
    splitFriendChecker,
  };
}

function authed(token: string, method = "GET", body?: unknown) {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return init;
}

async function seedCategory(app: ReturnType<typeof buildApp>["app"], token: string, overrides: { name?: string; type?: string } = {}) {
  const res = await app.request(
    "/api/finance/categories",
    authed(token, "POST", { name: overrides.name ?? "餐飲", type: overrides.type ?? "expense" }),
  );
  return (await res.json()) as { id: string; name: string; type: string };
}

/** Resolves `token`'s internal user id by calling a cheap authenticated endpoint. */
async function idOf(app: ReturnType<typeof buildApp>["app"], token: string): Promise<string> {
  const res = await app.request("/api/me", authed(token));
  const body = await res.json<{ id: string }>();
  return body.id;
}

/**
 * Creates a split expense between two tokens, splitting evenly — enough to
 * give both of them a real `split_share`, and therefore a mirrored
 * transaction, in the month. Establishes the friendship the split creation
 * rule requires. Returns the expense id so a test can find the mirror it
 * produced.
 */
async function createSplitExpenseBetween(
  ctx: ReturnType<typeof buildApp>,
  payerToken: string,
  otherToken: string,
  amount: number,
  currency: string,
  day: string,
  categoryName: string | null = null,
): Promise<string> {
  const payerId = await idOf(ctx.app, payerToken);
  const otherId = await idOf(ctx.app, otherToken);
  ctx.splitFriendChecker.addFriendship(payerId, otherId);
  const res = await ctx.app.request("/api/split/expenses", {
    method: "POST",
    headers: authHeaderFor(payerToken),
    body: JSON.stringify({
      group_id: null,
      payer_user_id: payerId,
      amount,
      currency,
      description: "dinner",
      day,
      category_name: categoryName,
      split: { mode: "equal", participant_user_ids: [payerId, otherId] },
    }),
  });
  if (res.status !== 201) throw new Error(`failed to seed split expense: ${res.status} ${await res.text()}`);
  return (await res.json<{ id: string }>()).id;
}

/**
 * Edits an existing split through the payer's `PATCH`, resending every field
 * the route requires. Kept beside the create helper so the two send the same
 * shape and an edit can never quietly become a lighter write than a create.
 */
async function editSplitExpenseBetween(
  ctx: ReturnType<typeof buildApp>,
  splitId: string,
  payerToken: string,
  otherToken: string,
  amount: number,
  currency: string,
  day: string,
  categoryName: string | null = null,
): Promise<void> {
  const payerId = await idOf(ctx.app, payerToken);
  const otherId = await idOf(ctx.app, otherToken);
  const res = await ctx.app.request(`/api/split/expenses/${splitId}`, {
    method: "PATCH",
    headers: authHeaderFor(payerToken),
    body: JSON.stringify({
      payer_user_id: payerId,
      amount,
      currency,
      description: "dinner",
      day,
      category_name: categoryName,
      split: { mode: "equal", participant_user_ids: [payerId, otherId] },
    }),
  });
  if (res.status !== 200) throw new Error(`failed to edit split expense: ${res.status} ${await res.text()}`);
}

/**
 * A split with hand-picked share amounts. `createSplitExpenseBetween` cannot
 * express these: it splits evenly between exactly two people, while a zero
 * share needs three participants (an even split into a zero would have to be
 * under 3, which validation rejects outright) and a payer who fronted the
 * money holds no share at all.
 */
async function createExactSplit(
  ctx: ReturnType<typeof buildApp>,
  payerToken: string,
  shares: { token: string; amount: number }[],
  options: { amount: number; currency?: string; day: string; categoryName?: string | null },
): Promise<string> {
  const payerId = await idOf(ctx.app, payerToken);
  const resolved = await Promise.all(shares.map(async (share) => ({ userId: await idOf(ctx.app, share.token), amount: share.amount })));
  for (const share of resolved) ctx.splitFriendChecker.addFriendship(payerId, share.userId);
  const res = await ctx.app.request("/api/split/expenses", {
    method: "POST",
    headers: authHeaderFor(payerToken),
    body: JSON.stringify({
      group_id: null,
      payer_user_id: payerId,
      amount: options.amount,
      currency: options.currency ?? "TWD",
      description: "dinner",
      day: options.day,
      category_name: options.categoryName ?? null,
      split: { mode: "exact", shares: resolved.map((share) => ({ user_id: share.userId, amount: share.amount })) },
    }),
  });
  if (res.status !== 201) throw new Error(`failed to seed split expense: ${res.status} ${await res.text()}`);
  return (await res.json<{ id: string }>()).id;
}

function authHeaderFor(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

interface TransactionJson {
  id: string;
  type: string;
  amount: number;
  currency: string;
  category_id: string;
  date: string;
  note: string | null;
  split_expense_id: string | null;
  category_source: string;
}

async function transactionsOf(ctx: ReturnType<typeof buildApp>, token: string, from = "2026-07-01", to = "2026-07-31"): Promise<TransactionJson[]> {
  const res = await ctx.app.request(`/api/finance/transactions?from=${from}&to=${to}`, authed(token));
  return ((await res.json()) as { transactions: TransactionJson[] }).transactions;
}

/** The caller's mirror of `splitExpenseId`, read back through the public listing. */
async function mirrorFor(ctx: ReturnType<typeof buildApp>, token: string, splitExpenseId: string): Promise<TransactionJson | undefined> {
  return (await transactionsOf(ctx, token)).find((txn) => txn.split_expense_id === splitExpenseId);
}

describe("finance HTTP routes", () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(() => {
    ctx = buildApp();
  });

  it("requires auth for every /api/finance endpoint", async () => {
    const { app } = ctx;
    expect((await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31")).status).toBe(401);
    expect((await app.request("/api/finance/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/finance/transactions/some-id", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/finance/transactions/some-id", { method: "DELETE" })).status).toBe(401);
    expect((await app.request("/api/finance/categories")).status).toBe(401);
    expect((await app.request("/api/finance/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/finance/categories/some-id", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/finance/summary?month=2026-07")).status).toBe(401);
    expect((await app.request("/api/finance/split-spending?month=2026-07")).status).toBe(401);
    expect((await app.request("/api/finance/budgets?month=2026-07")).status).toBe(401);
    expect((await app.request("/api/finance/budgets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request("/api/finance/budgets/some-id", { method: "DELETE" })).status).toBe(401);
  });

  describe("categories", () => {
    it("seeds the defaults idempotently on the first two GETs", async () => {
      const { app } = ctx;
      const token = await validToken();
      const first = (await (await app.request("/api/finance/categories", authed(token))).json()) as { categories: unknown[] };
      const second = (await (await app.request("/api/finance/categories", authed(token))).json()) as { categories: unknown[] };
      expect(first.categories).toHaveLength(11);
      expect(second.categories).toHaveLength(11);
    });

    it("creates a category", async () => {
      const { app } = ctx;
      const token = await validToken();
      const res = await app.request("/api/finance/categories", authed(token, "POST", { name: "副業", type: "income" }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ name: "副業", type: "income", icon: "other", sort_order: 0, archived: false });
    });

    it("rejects a duplicate name for the same user+type as 400", async () => {
      const { app } = ctx;
      const token = await validToken();
      await app.request("/api/finance/categories", authed(token, "POST", { name: "副業", type: "income" }));
      const res = await app.request("/api/finance/categories", authed(token, "POST", { name: "副業", type: "income" }));
      expect(res.status).toBe(400);
    });

    it("updates a category's archived flag", async () => {
      const { app } = ctx;
      const token = await validToken();
      const created = await seedCategory(app, token);
      const res = await app.request(`/api/finance/categories/${created.id}`, authed(token, "PUT", { archived: true }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ archived: true });
    });

    it("returns 404 for another user's category", async () => {
      const { app } = ctx;
      const owner = await validToken("uid-owner");
      const other = await validToken("uid-other");
      const created = await seedCategory(app, owner);
      const res = await app.request(`/api/finance/categories/${created.id}`, authed(other, "PUT", { archived: true }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  });

  describe("transactions", () => {
    it("creates and lists a transaction, defaulting currency to TWD", async () => {
      const { app } = ctx;
      const token = await validToken();
      const category = await seedCategory(app, token);

      const created = await app.request(
        "/api/finance/transactions",
        authed(token, "POST", { type: "expense", amount: 300, category_id: category.id, date: "2026-07-15" }),
      );
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as Record<string, unknown>;
      expect(createdBody).toMatchObject({ type: "expense", amount: 300, currency: "TWD", category_id: category.id, date: "2026-07-15" });
      expect(createdBody.id).toBeTruthy();

      const listRes = await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(token));
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { transactions: { id: string }[] };
      expect(listBody.transactions).toHaveLength(1);
      expect(listBody.transactions[0].id).toBe(createdBody.id);
    });

    it("rejects amount <= 0, a currency outside the whitelist, a malformed date, and a missing category_id — storing nothing", async () => {
      const { app, financeTransactionRepository } = ctx;
      const token = await validToken();
      const category = await seedCategory(app, token);

      expect(
        (await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 0, category_id: category.id, date: "2026-07-15" }))).status,
      ).toBe(400);
      expect(
        (
          await app.request(
            "/api/finance/transactions",
            authed(token, "POST", { type: "expense", amount: 100, currency: "XYZ", category_id: category.id, date: "2026-07-15" }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await app.request(
            "/api/finance/transactions",
            authed(token, "POST", { type: "expense", amount: 100, category_id: category.id, date: "not-a-date" }),
          )
        ).status,
      ).toBe(400);
      expect(
        (await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 100, date: "2026-07-15" }))).status,
      ).toBe(400);

      expect(financeTransactionRepository.transactions).toHaveLength(0);
    });

    it("rejects an expense transaction whose category_id is an income category (400) or another user's category (404)", async () => {
      const { app } = ctx;
      const token = await validToken();
      const incomeCategory = await seedCategory(app, token, { name: "薪資", type: "income" });
      const otherToken = await validToken("uid-other");
      const otherCategory = await seedCategory(app, otherToken);

      const typeMismatch = await app.request(
        "/api/finance/transactions",
        authed(token, "POST", { type: "expense", amount: 100, category_id: incomeCategory.id, date: "2026-07-15" }),
      );
      expect(typeMismatch.status).toBe(400);

      const foreignCategory = await app.request(
        "/api/finance/transactions",
        authed(token, "POST", { type: "expense", amount: 100, category_id: otherCategory.id, date: "2026-07-15" }),
      );
      expect(foreignCategory.status).toBe(404);
    });

    it("PUT full-replaces a transaction and requires currency (400 when omitted)", async () => {
      const { app } = ctx;
      const token = await validToken();
      const category = await seedCategory(app, token);
      const created = (await (
        await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 100, category_id: category.id, date: "2026-07-15" }))
      ).json()) as { id: string };

      const missingCurrency = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(token, "PUT", { type: "expense", amount: 200, category_id: category.id, date: "2026-07-16" }),
      );
      expect(missingCurrency.status).toBe(400);

      const replaced = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(token, "PUT", { type: "expense", amount: 200, currency: "USD", category_id: category.id, date: "2026-07-16", note: "updated" }),
      );
      expect(replaced.status).toBe(200);
      expect(await replaced.json()).toMatchObject({ amount: 200, currency: "USD", date: "2026-07-16", note: "updated" });
    });

    it("archived category: blocks a new transaction (400), keeps history readable, allows editing amount/note but not switching onto it (400)", async () => {
      const { app } = ctx;
      const token = await validToken();
      const category = await seedCategory(app, token, { name: "娛樂" });
      const otherCategory = await seedCategory(app, token, { name: "居住" });

      const created = (await (
        await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 100, category_id: category.id, date: "2026-07-15" }))
      ).json()) as { id: string };

      const archiveRes = await app.request(`/api/finance/categories/${category.id}`, authed(token, "PUT", { archived: true }));
      expect(archiveRes.status).toBe(200);

      const blockedCreate = await app.request(
        "/api/finance/transactions",
        authed(token, "POST", { type: "expense", amount: 50, category_id: category.id, date: "2026-07-16" }),
      );
      expect(blockedCreate.status).toBe(400);

      const listRes = await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(token));
      const listBody = (await listRes.json()) as { transactions: { id: string }[] };
      expect(listBody.transactions.map((t) => t.id)).toContain(created.id);

      const editSameCategory = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(token, "PUT", { type: "expense", amount: 150, currency: "TWD", category_id: category.id, date: "2026-07-15", note: "still editable" }),
      );
      expect(editSameCategory.status).toBe(200);
      expect(await editSameCategory.json()).toMatchObject({ amount: 150, note: "still editable" });

      const switchOntoArchived = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(token, "PUT", { type: "expense", amount: 150, currency: "TWD", category_id: otherCategory.id, date: "2026-07-15" }),
      );
      // switching FROM the (now-archived) category onto a live one is fine —
      // this asserts the reverse case in the same scenario: switching a
      // transaction still on the *live* otherCategory onto the archived one.
      expect(switchOntoArchived.status).toBe(200);

      const switchBackOntoArchived = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(token, "PUT", { type: "expense", amount: 150, currency: "TWD", category_id: category.id, date: "2026-07-15" }),
      );
      expect(switchBackOntoArchived.status).toBe(400);
    });

    it("DELETE removes an owned transaction", async () => {
      const { app } = ctx;
      const token = await validToken();
      const category = await seedCategory(app, token);
      const created = (await (
        await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 100, category_id: category.id, date: "2026-07-15" }))
      ).json()) as { id: string };

      const res = await app.request(`/api/finance/transactions/${created.id}`, authed(token, "DELETE"));
      expect(res.status).toBe(200);

      const listRes = await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(token));
      expect(((await listRes.json()) as { transactions: unknown[] }).transactions).toHaveLength(0);
    });
  });

  describe("user isolation", () => {
    it("returns 404 for another user's transaction on GET-adjacent (PUT/DELETE) and leaves it unchanged", async () => {
      const { app } = ctx;
      const owner = await validToken("uid-owner");
      const other = await validToken("uid-other");
      const category = await seedCategory(app, owner);
      const created = (await (
        await app.request("/api/finance/transactions", authed(owner, "POST", { type: "expense", amount: 100, category_id: category.id, date: "2026-07-15" }))
      ).json()) as { id: string };

      const putRes = await app.request(
        `/api/finance/transactions/${created.id}`,
        authed(other, "PUT", { type: "expense", amount: 999, currency: "TWD", category_id: category.id, date: "2026-07-15" }),
      );
      expect(putRes.status).toBe(404);
      expect(await putRes.json()).toEqual({ error: "not_found" });

      const deleteRes = await app.request(`/api/finance/transactions/${created.id}`, authed(other, "DELETE"));
      expect(deleteRes.status).toBe(404);

      const ownerListRes = await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(owner));
      const ownerList = (await ownerListRes.json()) as { transactions: { amount: number }[] };
      expect(ownerList.transactions[0].amount).toBe(100);
    });

    it("a user's transactions list is scoped to their own data", async () => {
      const { app } = ctx;
      const userA = await validToken("uid-a");
      const userB = await validToken("uid-b");
      const categoryA = await seedCategory(app, userA);
      const categoryB = await seedCategory(app, userB);

      await app.request("/api/finance/transactions", authed(userA, "POST", { type: "expense", amount: 100, category_id: categoryA.id, date: "2026-07-15" }));
      await app.request("/api/finance/transactions", authed(userB, "POST", { type: "expense", amount: 200, category_id: categoryB.id, date: "2026-07-15" }));

      const listA = (await (await app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(userA))).json()) as {
        transactions: unknown[];
      };
      expect(listA.transactions).toHaveLength(1);
    });
  });

  describe("summary", () => {
    it("splits totals per currency and computes net", async () => {
      const { app } = ctx;
      const token = await validToken();
      const foodCategory = await seedCategory(app, token, { name: "餐飲", type: "expense" });
      const salaryCategory = await seedCategory(app, token, { name: "薪資", type: "income" });

      await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 300, category_id: foodCategory.id, date: "2026-07-05" }));
      await app.request(
        "/api/finance/transactions",
        authed(token, "POST", { type: "expense", amount: 1000, currency: "USD", category_id: foodCategory.id, date: "2026-07-06" }),
      );
      await app.request("/api/finance/transactions", authed(token, "POST", { type: "income", amount: 50000, category_id: salaryCategory.id, date: "2026-07-01" }));

      const res = await app.request("/api/finance/summary?month=2026-07", authed(token));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { month: string; totals: unknown[]; by_category: unknown[] };
      expect(body.month).toBe("2026-07");
      expect(body.totals).toEqual(
        expect.arrayContaining([
          { currency: "TWD", expense: 300, income: 50000, net: 49700 },
          { currency: "USD", expense: 1000, income: 0, net: -1000 },
        ]),
      );
    });

    it("returns empty totals/by_category for a month with no transactions, and excludes other users", async () => {
      const { app } = ctx;
      const token = await validToken();
      const otherToken = await validToken("uid-other");
      const category = await seedCategory(app, otherToken);
      await app.request("/api/finance/transactions", authed(otherToken, "POST", { type: "expense", amount: 100, category_id: category.id, date: "2026-07-15" }));

      const res = await app.request("/api/finance/summary?month=2026-07", authed(token));
      expect(await res.json()).toEqual({ month: "2026-07", totals: [], by_category: [] });
    });

    it("is unaffected by split expenses: the share is counted once, as the transaction it now is", async () => {
      // Kept under its former name so the inversion is loud: a split share
      // used to be invisible here and now it is a real transaction. The
      // "exactly once" half is the one that matters — the share must reach
      // the summary through the mirror and never a second time from the
      // split tables.
      const token = await validToken();
      const otherToken = await validToken("uid-other");
      const foodCategory = await seedCategory(ctx.app, token, { name: "餐飲", type: "expense" });

      await ctx.app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 300, category_id: foodCategory.id, date: "2026-07-05" }));
      await createSplitExpenseBetween(ctx, token, otherToken, 900, "TWD", "2026-07-06");

      const res = await ctx.app.request("/api/finance/summary?month=2026-07", authed(token));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { totals: Array<{ currency: string; expense: number }> };
      expect(body.totals.find((total) => total.currency === "TWD")?.expense).toBe(750);

      // ...and the same number the budget reports, which is the whole point:
      // the two used to disagree by exactly the share.
      await ctx.app.request("/api/finance/budgets", authed(token, "PUT", { category_id: null, amount: 10000 }));
      const budgets = (await (await ctx.app.request("/api/finance/budgets?month=2026-07", authed(token))).json()) as { budgets: Array<{ spent: number }> };
      expect(budgets.budgets[0].spent).toBe(750);
    });
  });

  describe("split-spending", () => {
    it("sums the caller's own split-expense shares per currency for the month, including as payer", async () => {
      const token = await validToken();
      const otherToken = await validToken("uid-other");
      // The caller is the payer here, and their own share must count.
      await createSplitExpenseBetween(ctx, token, otherToken, 900, "TWD", "2026-07-01");

      const res = await ctx.app.request("/api/finance/split-spending?month=2026-07", authed(token));
      expect(res.status).toBe(200);
      // TWD is whitelisted, so the same 450 is also a transaction — the flag
      // is what stops a caller adding this figure to the summary total.
      expect(await res.json()).toEqual({ month: "2026-07", totals: [{ currency: "TWD", amount: 450, counted_in_transactions: true }] });
    });

    // Both halves run through one app instance, so a future change that fed
    // settlements into the split-spending aggregate (or wired the settlement
    // table into `splitSpendingRepository`) would fail here. It still does not
    // prove the real SQL adapter — nothing in CI can.
    it("a recorded settlement does not move the split-spending figure", async () => {
      const token = await validToken();
      const otherToken = await validToken("uid-other");
      await createSplitExpenseBetween(ctx, token, otherToken, 900, "TWD", "2026-07-01");

      const before = await (await ctx.app.request("/api/finance/split-spending?month=2026-07", authed(token))).json();

      const callerId = await idOf(ctx.app, token);
      const otherId = await idOf(ctx.app, otherToken);
      const settled = await ctx.app.request(
        "/api/split/settlements",
        authed(token, "POST", {
          group_id: null,
          from_user_id: callerId,
          to_user_id: otherId,
          amount: 450,
          currency: "TWD",
          day: "2026-07-05",
          note: null,
        }),
      );
      expect(settled.status).toBe(201);

      // A settlement is repayment, not spending, so it also creates no
      // transaction. Kept as a regression assertion only: settlements are
      // written by a repository this change never touched, so no mutation of
      // *this* change could make one appear — do not present it as proven.
      expect(await transactionsOf(ctx, token)).toHaveLength(1);

      const after = await (await ctx.app.request("/api/finance/split-spending?month=2026-07", authed(token))).json();
      expect(after).toEqual(before);
      expect(after).toEqual({ month: "2026-07", totals: [{ currency: "TWD", amount: 450, counted_in_transactions: true }] });
    });

    it("returns an empty array, not a zero row, for a month with no split shares", async () => {
      const token = await validToken();
      const res = await ctx.app.request("/api/finance/split-spending?month=2026-08", authed(token));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ month: "2026-08", totals: [] });
    });
  });

  /**
   * These run through `createApp`, which composes the real
   * `FinanceSharesMirror` out of the in-memory finance repositories — so the
   * category resolution under test is the production one, not a fake
   * reimplementation agreeing with itself.
   */
  describe("split mirror: category resolution", () => {
    const DAY = "2026-07-06";

    interface MirrorJson {
      id: string;
      amount: number;
      category_id: string;
      split_expense_id: string | null;
      category_source: string;
    }

    async function mirrorOf(token: string, splitExpenseId: string): Promise<MirrorJson | undefined> {
      const res = await ctx.app.request("/api/finance/transactions?from=2026-07-01&to=2026-07-31", authed(token));
      const body = (await res.json()) as { transactions: MirrorJson[] };
      return body.transactions.find((txn) => txn.split_expense_id === splitExpenseId);
    }

    async function categoriesOf(token: string): Promise<Array<{ id: string; name: string; type: string; archived: boolean }>> {
      const res = await ctx.app.request("/api/finance/categories", authed(token));
      return ((await res.json()) as { categories: Array<{ id: string; name: string; type: string; archived: boolean }> }).categories;
    }

    /** Names the category a mirror landed on, resolved through the owner's own category list. */
    async function mirrorCategory(token: string, splitExpenseId: string): Promise<{ name: string; type: string } | undefined> {
      const mirror = await mirrorOf(token, splitExpenseId);
      if (!mirror) return undefined;
      return (await categoriesOf(token)).find((category) => category.id === mirror.category_id);
    }

    it("takes the share holder's own expense category of that name, never their income one", async () => {
      // The holder has 餐飲 only as an *income* category. Step 1 must miss it
      // and fall through to their expense 其他 — an unfiltered name lookup
      // would file a split dinner as income, and `getMonthlySummaryRaw`
      // groups by category, so nothing about the result would look wrong.
      const payer = await validToken();
      const holder = await validToken("uid-holder");
      await seedCategory(ctx.app, holder, { name: "其他", type: "expense" });
      await seedCategory(ctx.app, holder, { name: "餐飲", type: "income" });

      const splitId = await createSplitExpenseBetween(ctx, payer, holder, 900, "TWD", DAY, "餐飲");

      expect(await mirrorCategory(holder, splitId)).toMatchObject({ name: "其他", type: "expense" });
    });

    it("re-seeds a renamed 其他 rather than landing on whatever expense category is left over", async () => {
      // The holder renamed their 其他 and has an income 其他. They still have
      // plenty of categories, so a "seed only when they have none" condition
      // would never fire for them and the mirror would have nowhere to go —
      // failing the payer's perfectly legal split because of a rename they
      // know nothing about.
      const payer = await validToken();
      const holder = await validToken("uid-holder");
      const renamed = await seedCategory(ctx.app, holder, { name: "其他", type: "expense" });
      await ctx.app.request(`/api/finance/categories/${renamed.id}`, authed(holder, "PUT", { name: "雜項" }));
      await seedCategory(ctx.app, holder, { name: "其他", type: "income" });
      const expenseCountBefore = (await categoriesOf(holder)).filter((category) => category.type === "expense").length;

      const splitId = await createSplitExpenseBetween(ctx, payer, holder, 900, "TWD", DAY, "旅遊");

      expect(await mirrorCategory(holder, splitId)).toMatchObject({ name: "其他", type: "expense" });
      // Proof the 其他 it landed on was genuinely re-seeded, not the renamed
      // one under another name or the income one.
      const expenseCountAfter = (await categoriesOf(holder)).filter((category) => category.type === "expense").length;
      expect(expenseCountAfter).toBeGreaterThan(expenseCountBefore);
    });

    it("seeds the defaults for a share holder who has never opened the ledger", async () => {
      // Deliberately no category call for the holder before the split: one
      // `GET /api/finance/categories` would seed them and this guard could
      // never fail again.
      const payer = await validToken();
      const holder = await validToken("uid-holder");

      const splitId = await createSplitExpenseBetween(ctx, payer, holder, 900, "TWD", DAY, "餐飲");

      const mirror = await mirrorOf(holder, splitId);
      expect(mirror).toMatchObject({ amount: 450, category_source: "mirror" });
      // 餐飲, not 其他: the re-seed creates the named category too, so the
      // retry goes back to step 1 rather than settling for the fallback with
      // the right category sitting there unused (design.md D4).
      expect(await mirrorCategory(holder, splitId)).toMatchObject({ name: "餐飲", type: "expense" });
      expect((await categoriesOf(holder)).length).toBe(11);
    });

    it("resolves the category per user: each side's mirror uses their own id for the same name", async () => {
      // `finance_transaction.category_id` has no constraint tying it to the
      // row's `user_id`, so using the payer's id would insert happily and
      // just file the holder's money under someone else's category.
      const payer = await validToken();
      const holder = await validToken("uid-holder");
      const payerFood = await seedCategory(ctx.app, payer, { name: "餐飲", type: "expense" });
      const holderFood = await seedCategory(ctx.app, holder, { name: "餐飲", type: "expense" });
      expect(payerFood.id).not.toBe(holderFood.id);

      const splitId = await createSplitExpenseBetween(ctx, payer, holder, 900, "TWD", DAY, "餐飲");

      expect((await mirrorOf(holder, splitId))?.category_id).toBe(holderFood.id);
      expect((await mirrorOf(payer, splitId))?.category_id).toBe(payerFood.id);
    });

    it("lets a mirror land on an archived category, while the API still refuses to create one there", async () => {
      // The asymmetry is deliberate: archiving hides a category from new
      // *choices*, and a mirror is not a choice — refusing it would drop a
      // real expense. Both halves are asserted, because with only the first
      // one "just drop the archived check from create" would survive.
      const payer = await validToken();
      const holder = await validToken("uid-holder");
      const food = await seedCategory(ctx.app, holder, { name: "餐飲", type: "expense" });
      await ctx.app.request(`/api/finance/categories/${food.id}`, authed(holder, "PUT", { archived: true }));

      const splitId = await createSplitExpenseBetween(ctx, payer, holder, 900, "TWD", DAY, "餐飲");

      expect((await mirrorOf(holder, splitId))?.category_id).toBe(food.id);

      const manual = await ctx.app.request("/api/finance/transactions", authed(holder, "POST", { type: "expense", amount: 100, category_id: food.id, date: DAY }));
      expect(manual.status).toBe(400);
    });
  });

  /**
   * #76: a split write has to run the same budget-alert check a transaction
   * the holder wrote themselves would — otherwise the mirrored numbers are
   * right and nobody is ever told they crossed a threshold.
   */
  describe("split mirror: budget alerts", () => {
    const DAY = "2026-07-06";

    it("notifies a share holder who did not write the split", async () => {
      const payer = await validToken("uid-payer");
      const holder = await validToken("uid-holder");
      // Both fixture conditions matter. The share alone has to cross the
      // threshold — 1800 split evenly is 900 against a 1000 budget, 90%;
      // a 900 split would be a 450 share, 45%, and dropping the check
      // entirely would go unnoticed. And the budget belongs to the *other*
      // participant, not the writer: being told about your own write is the
      // half that was never broken.
      await ctx.app.request("/api/finance/budgets", authed(holder, "PUT", { category_id: null, amount: 1000 }));

      await createSplitExpenseBetween(ctx, payer, holder, 1800, "TWD", DAY);

      expect(ctx.budgetAlertNotifier.messages).toHaveLength(1);
      expect(ctx.budgetAlertNotifier.messages[0].userId).toBe(await idOf(ctx.app, holder));
      expect(ctx.budgetAlertNotifier.messages[0].message).toEqual({ title: "預算提醒", body: "7月支出已達預算 8 成" });
    });

    it("does not burn a future month's alert on a future-dated split", async () => {
      // A split's `day` has no future-date restriction, so this is reachable.
      // Without the month gate the mirror runs a real threshold check for a
      // month that has not happened, writes the (budget, month, threshold)
      // dedup row, and that month can then never alert again — the row is
      // spent before the spending is real. Same failure the instalment work
      // added the gate for; this path is the one that did not have it.
      const payer = await validToken("uid-payer");
      const holder = await validToken("uid-holder");
      const future = `${new Date().getUTCFullYear() + 1}-01-06`;
      await ctx.app.request("/api/finance/budgets", authed(holder, "PUT", { category_id: null, amount: 1000 }));

      await createSplitExpenseBetween(ctx, payer, holder, 1800, "TWD", future);

      expect(ctx.budgetAlertNotifier.messages).toHaveLength(0);
    });

    it("still notifies the same (budget, month, threshold) only once across two splits", async () => {
      const payer = await validToken("uid-payer");
      const holder = await validToken("uid-holder");
      await ctx.app.request("/api/finance/budgets", authed(holder, "PUT", { category_id: null, amount: 1000 }));

      await createSplitExpenseBetween(ctx, payer, holder, 1800, "TWD", DAY);
      // A second, small split: the holder is still in the 80% band, so the
      // dedup record from the first write is what has to keep this quiet.
      await createSplitExpenseBetween(ctx, payer, holder, 100, "TWD", DAY);

      expect(ctx.budgetAlertNotifier.messages).toHaveLength(1);
    });

    it("checks the category a recategorised mirror now carries when the split is edited", async () => {
      // Two things at once, because neither is observable without the other:
      // the edit path has to run the check at all, and the check has to run
      // against the category the mirror is *in*. The holder moved their copy
      // to 娛樂, so the row the payer's edit grows is a 娛樂 row — planning
      // said 餐飲, and a check on 餐飲 would look at a category holding
      // nothing and stay silent forever.
      const payer = await validToken("uid-payer");
      const holder = await validToken("uid-holder");
      const splitId = await createSplitExpenseBetween(ctx, payer, holder, 1800, "TWD", DAY, "餐飲");
      const mirror = await mirrorFor(ctx, holder, splitId);
      if (!mirror) throw new Error("no mirror was created for the holder");
      const categories = (await (await ctx.app.request("/api/finance/categories", authed(holder))).json()) as {
        categories: { id: string; name: string; type: string }[];
      };
      const fun = categories.categories.find((category) => category.name === "娛樂" && category.type === "expense")?.id;
      await ctx.app.request("/api/finance/budgets", authed(holder, "PUT", { category_id: fun, amount: 2000 }));
      const moved = await ctx.app.request(
        `/api/finance/transactions/${mirror.id}`,
        authed(holder, "PUT", { type: "expense", amount: mirror.amount, currency: mirror.currency, category_id: fun, date: mirror.date, note: mirror.note }),
      );
      expect(moved.status).toBe(200);
      // 900 of 2000 is 45%: the fixture is not already over the line, so the
      // alert below can only come from the edit.
      expect(ctx.budgetAlertNotifier.messages).toHaveLength(0);

      await editSplitExpenseBetween(ctx, splitId, payer, holder, 3600, "TWD", DAY, "餐飲");

      expect((await mirrorFor(ctx, holder, splitId))?.category_id).toBe(fun);
      expect(ctx.budgetAlertNotifier.messages).toHaveLength(1);
      expect(ctx.budgetAlertNotifier.messages[0].userId).toBe(await idOf(ctx.app, holder));
      expect(ctx.budgetAlertNotifier.messages[0].message).toEqual({ title: "預算提醒", body: "7月娛樂支出已達預算 8 成" });
    });

    it("records the split even when the alert check itself throws", async () => {
      // The spec's claim is about the HTTP response, so it is asserted here
      // rather than one layer down. `findByUserAndCategory` is the throwing
      // point on purpose: `checkBudget` returns early when it finds no
      // budget, so a fixture without one never reaches anything further in.
      const payer = await validToken("uid-payer");
      const holder = await validToken("uid-holder");
      ctx.financeBudgetRepository.findByUserAndCategory = async () => {
        throw new Error("budget lookup exploded");
      };

      const splitId = await createSplitExpenseBetween(ctx, payer, holder, 1800, "TWD", DAY);

      expect((await mirrorFor(ctx, holder, splitId))?.amount).toBe(900);
    });

    it("one holder's failing check does not silence the holders after them", async () => {
      // The loop's catch is per row on purpose. `writeMirrorAftermath` keeps a
      // failed check from failing the split write, but it sits outside the
      // loop — without this one, the first holder to throw would abandon
      // everyone after them, and since alerts are month-deduped and only fire
      // on the way up, those holders would never be told at all.
      const payer = await validToken("uid-payer");
      const doomed = await validToken("uid-doomed");
      const later = await validToken("uid-later");
      const payerId = await idOf(ctx.app, payer);
      const doomedId = await idOf(ctx.app, doomed);
      const laterId = await idOf(ctx.app, later);
      ctx.splitFriendChecker.addFriendship(payerId, doomedId);
      ctx.splitFriendChecker.addFriendship(payerId, laterId);

      // `later` must cross 80% on their share alone, so the alert can only
      // come from the loop having reached them.
      await ctx.app.request("/api/finance/budgets", authed(later, "PUT", { category_id: null, amount: 1000 }));

      const realLookup = ctx.financeBudgetRepository.findByUserAndCategory.bind(ctx.financeBudgetRepository);
      ctx.financeBudgetRepository.findByUserAndCategory = async (userId: string, categoryId: string | null) => {
        if (userId === doomedId) throw new Error("budget lookup exploded for this holder only");
        return realLookup(userId, categoryId);
      };

      const res = await ctx.app.request("/api/split/expenses", {
        method: "POST",
        headers: authHeaderFor(payer),
        body: JSON.stringify({
          group_id: null,
          payer_user_id: payerId,
          amount: 2700,
          currency: "TWD",
          description: "dinner",
          day: DAY,
          category_name: null,
          // `doomed` is listed before `later`, so the loop reaches the
          // throwing holder first — the whole point of the fixture.
          split: { mode: "equal", participant_user_ids: [payerId, doomedId, laterId] },
        }),
      });
      expect(res.status).toBe(201);

      const alerted = ctx.budgetAlertNotifier.messages.map((message) => message.userId);
      expect(alerted).toContain(laterId);
      expect(alerted).not.toContain(doomedId);
    });
  });

  /**
   * D7: a mirror is the split's facts wearing a transaction's clothes. The
   * holder owns its category and its note; everything else would only make
   * the two views disagree, so the finance API refuses it — in the backend,
   * because the frontend lives in another repo and the API is public.
   */
  describe("split mirror: half read-only in the finance API", () => {
    const DAY = "2026-07-06";

    /** The holder's mirror of a 1800 TWD even split, i.e. a 900 share. */
    async function seedMirror(): Promise<{ payer: string; holder: string; splitId: string; mirror: TransactionJson }> {
      const payer = await validToken("uid-payer");
      const holder = await validToken("uid-holder");
      const splitId = await createSplitExpenseBetween(ctx, payer, holder, 1800, "TWD", DAY, "餐飲");
      const mirror = await mirrorFor(ctx, holder, splitId);
      if (!mirror) throw new Error("no mirror was created for the holder");
      return { payer, holder, splitId, mirror };
    }

    /**
     * One of the holder's own categories by name. Looked up rather than
     * created: the mirror seeds their defaults, so `POST /categories` with
     * any default name is a duplicate and answers 400 — a fixture built that
     * way would make every case below fail for the wrong reason.
     */
    async function categoryIdOf(token: string, name: string, type: "expense" | "income"): Promise<string> {
      const res = await ctx.app.request("/api/finance/categories", authed(token));
      const { categories } = (await res.json()) as { categories: { id: string; name: string; type: string }[] };
      const found = categories.find((category) => category.name === name && category.type === type);
      if (!found) throw new Error(`no ${type} category named ${name}`);
      return found.id;
    }

    /** A full-replace body echoing the mirror back, with `overrides` applied. */
    function replaceBody(mirror: TransactionJson, overrides: Record<string, unknown> = {}) {
      return {
        type: mirror.type,
        amount: mirror.amount,
        currency: mirror.currency,
        category_id: mirror.category_id,
        date: mirror.date,
        note: mirror.note,
        ...overrides,
      };
    }

    async function expenseTotal(token: string): Promise<number | undefined> {
      const res = await ctx.app.request("/api/finance/summary?month=2026-07", authed(token));
      const body = (await res.json()) as { totals: { currency: string; expense: number }[] };
      return body.totals.find((total) => total.currency === "TWD")?.expense;
    }

    it("refuses to delete a mirrored transaction", async () => {
      const { holder, splitId, mirror } = await seedMirror();

      const res = await ctx.app.request(`/api/finance/transactions/${mirror.id}`, authed(holder, "DELETE"));

      expect(res.status).toBe(400);
      expect(await mirrorFor(ctx, holder, splitId)).toBeDefined();
    });

    it("refuses a PUT that changes the amount, and leaves the summary where it was", async () => {
      const { holder, mirror } = await seedMirror();
      const before = await expenseTotal(holder);

      const res = await ctx.app.request(`/api/finance/transactions/${mirror.id}`, authed(holder, "PUT", replaceBody(mirror, { amount: 10 })));

      expect(res.status).toBe(400);
      expect(await expenseTotal(holder)).toBe(before);
    });

    it("refuses a PUT that flips the mirror to income", async () => {
      // `type` is part of a full replace, so without it in the locked list a
      // holder can turn their 900 expense into 900 of income: out of every
      // budget's spent and out of the expense total, while the split still
      // says they owe it — the exact disagreement this change exists to end.
      const { holder, mirror } = await seedMirror();
      const salary = await categoryIdOf(holder, "薪資", "income");
      const before = await expenseTotal(holder);

      const res = await ctx.app.request(
        `/api/finance/transactions/${mirror.id}`,
        authed(holder, "PUT", replaceBody(mirror, { type: "income", category_id: salary })),
      );

      expect(res.status).toBe(400);
      expect(await expenseTotal(holder)).toBe(before);
    });

    it("refuses a PUT that changes the date or the currency", async () => {
      const { holder, mirror } = await seedMirror();

      const movedDay = await ctx.app.request(`/api/finance/transactions/${mirror.id}`, authed(holder, "PUT", replaceBody(mirror, { date: "2026-07-20" })));
      expect(movedDay.status).toBe(400);

      const movedCurrency = await ctx.app.request(`/api/finance/transactions/${mirror.id}`, authed(holder, "PUT", replaceBody(mirror, { currency: "USD" })));
      expect(movedCurrency.status).toBe(400);
    });

    it("accepts a PUT that resends the same values and only changes the category", async () => {
      // The one edit that is allowed, and a full replace is the only way to
      // express it: "carried a value at all" cannot be the refusal condition
      // or recategorising would be impossible. The currency is resent in the
      // other case to pin that the comparison is normalized, not literal.
      const { holder, mirror } = await seedMirror();
      const fun = await categoryIdOf(holder, "娛樂", "expense");

      const res = await ctx.app.request(`/api/finance/transactions/${mirror.id}`, authed(holder, "PUT", replaceBody(mirror, { category_id: fun, currency: "twd" })));

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ category_id: fun, amount: 900 });
    });

    it("keeps the holder's own category when the payer edits the split afterwards", async () => {
      // The `PUT` has to mark the row `'manual'`, and only an end-to-end run
      // can show that: the PGlite guard writes `'manual'` itself, so it would
      // stay green with a handler that never set it.
      const { payer, holder, splitId, mirror } = await seedMirror();
      const fun = await categoryIdOf(holder, "娛樂", "expense");
      await ctx.app.request(`/api/finance/transactions/${mirror.id}`, authed(holder, "PUT", replaceBody(mirror, { category_id: fun })));

      await editSplitExpenseBetween(ctx, splitId, payer, holder, 2400, "TWD", DAY, "餐飲");

      const after = await mirrorFor(ctx, holder, splitId);
      expect(after?.category_id).toBe(fun);
      // The amount still follows the split — the category is frozen, not the row.
      expect(after?.amount).toBe(1200);
    });

    it("does not freeze the category when a PUT only changed the note", async () => {
      // A `PUT` is a full replace, so a client editing only the note resends
      // the category it already had. Marking the row `'manual'` on any `PUT`
      // — rather than only when the category really moved — would take that
      // mirror out of the split's hands forever, silently, on an edit that
      // never touched the category. Only `&& categoryChanged` keeps this
      // holder's mirror following the split.
      const { payer, holder, splitId, mirror } = await seedMirror();

      const put = await ctx.app.request(`/api/finance/transactions/${mirror.id}`, authed(holder, "PUT", replaceBody(mirror, { note: "my half" })));
      expect(put.status).toBe(200);
      expect(await put.json()).toMatchObject({ note: "my half", category_id: mirror.category_id });

      await editSplitExpenseBetween(ctx, splitId, payer, holder, 1800, "TWD", DAY, "娛樂");

      const fun = await categoryIdOf(holder, "娛樂", "expense");
      expect((await mirrorFor(ctx, holder, splitId))?.category_id).toBe(fun);
    });

    it("answers 409 when the payer's split edit lands between the read and the write", async () => {
      // The holder read amount 900; the payer's edit makes it 1200 before the
      // holder's PUT is written. An unconditional write would put 900 back
      // and the two views would disagree forever, with no error — through the
      // one edit this API allows. 409 rather than 400 because re-reading and
      // re-sending is a sensible thing for the client to do next.
      const racing = new RacingFinanceTransactionRepository();
      ctx = buildApp({ financeTransactionRepository: racing });
      const { payer, holder, splitId, mirror } = await seedMirror();
      const fun = await categoryIdOf(holder, "娛樂", "expense");

      racing.onNextRead = async () => {
        await editSplitExpenseBetween(ctx, splitId, payer, holder, 2400, "TWD", DAY, "餐飲");
      };
      const res = await ctx.app.request(`/api/finance/transactions/${mirror.id}`, authed(holder, "PUT", replaceBody(mirror, { category_id: fun })));

      expect(res.status).toBe(409);
      const after = await mirrorFor(ctx, holder, splitId);
      expect(after?.amount).toBe(1200);
      // Not even the category landed, though on its own it would have been
      // the one permitted edit.
      expect(after?.category_id).toBe(mirror.category_id);
    });

    it("ignores a split_expense_id sent in a PUT body", async () => {
      // D17: the column is only ever set by the mirror write path. A client
      // that could set it would attach its own transaction to someone else's
      // split; one that could clear it would unlock a mirror.
      const { holder, splitId } = await seedMirror();
      const food = await categoryIdOf(holder, "購物", "expense");
      const created = await ctx.app.request("/api/finance/transactions", authed(holder, "POST", { type: "expense", amount: 100, category_id: food, date: DAY, split_expense_id: splitId }));
      const own = (await created.json()) as TransactionJson;
      expect(own.split_expense_id).toBeNull();

      const res = await ctx.app.request(
        `/api/finance/transactions/${own.id}`,
        authed(holder, "PUT", { type: "expense", amount: 100, currency: "TWD", category_id: food, date: DAY, split_expense_id: splitId }),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ split_expense_id: null });
    });
  });

  /**
   * D8/D9/D10: which shares become money in somebody's ledger. Everything
   * here is a decision `plan` makes, so it is observable at this layer — the
   * repository only writes the rows it is handed.
   */
  describe("split mirror: who gets one, and in which currency", () => {
    const DAY = "2026-07-06";

    it("creates no transaction for a zero share", async () => {
      // `mode: "exact"` is the only way to express this: an even split into a
      // zero share would need a total under 3, which validation rejects
      // outright — so `createSplitExpenseBetween` cannot reach the case.
      const payer = await validToken("uid-payer");
      const holder = await validToken("uid-holder");
      const freeloader = await validToken("uid-free");

      await createExactSplit(
        ctx,
        payer,
        [
          { token: payer, amount: 900 },
          { token: holder, amount: 900 },
          { token: freeloader, amount: 0 },
        ],
        { amount: 1800, day: DAY },
      );

      // Owing nothing is not spending — and `finance_transaction.amount` has
      // no CHECK, so a 0 written here would sit in the ledger unnoticed.
      expect(await transactionsOf(ctx, freeloader)).toHaveLength(0);
      expect(await transactionsOf(ctx, holder)).toHaveLength(1);
      expect(await transactionsOf(ctx, payer)).toHaveLength(1);
    });

    it("mirrors the payer for their own share, not for the whole bill", async () => {
      const payer = await validToken("uid-payer");
      const holder = await validToken("uid-holder");

      const splitId = await createExactSplit(
        ctx,
        payer,
        [
          { token: payer, amount: 900 },
          { token: holder, amount: 900 },
        ],
        { amount: 1800, day: DAY },
      );

      expect((await mirrorFor(ctx, payer, splitId))?.amount).toBe(900);
    });

    it("gives the payer nothing when they only fronted the money", async () => {
      // A different claim from the one above, and the mutation that breaks
      // this one leaves that one green: a payer holding no share has no
      // "their own share vs the whole bill" to get wrong.
      const payer = await validToken("uid-payer");
      const first = await validToken("uid-first");
      const second = await validToken("uid-second");

      await createExactSplit(
        ctx,
        payer,
        [
          { token: first, amount: 900 },
          { token: second, amount: 900 },
        ],
        { amount: 1800, day: DAY },
      );

      expect(await transactionsOf(ctx, payer)).toHaveLength(0);
    });

    it("records a split in an unsupported currency without mirroring it", async () => {
      // THB is a valid split currency (any three uppercase letters) and not a
      // finance one. The split must still be created: refusing it would take
      // a working feature away over a limitation of the other side.
      const payer = await validToken("uid-payer");
      const holder = await validToken("uid-holder");

      await createSplitExpenseBetween(ctx, payer, holder, 1800, "THB", DAY);

      expect(await transactionsOf(ctx, holder)).toHaveLength(0);
      const spending = (await (await ctx.app.request("/api/finance/split-spending?month=2026-07", authed(holder))).json()) as {
        totals: { currency: string; amount: number }[];
      };
      expect(spending.totals).toEqual([{ currency: "THB", amount: 900, counted_in_transactions: false }]);
    });

    it("marks per currency whether split spending is already counted in the transactions", async () => {
      // Both currencies in one response on purpose: with only one row a
      // hard-coded flag would answer correctly every time.
      const payer = await validToken("uid-payer");
      const holder = await validToken("uid-holder");
      await createSplitExpenseBetween(ctx, payer, holder, 1800, "TWD", DAY);
      await createSplitExpenseBetween(ctx, payer, holder, 600, "THB", DAY);

      const body = (await (await ctx.app.request("/api/finance/split-spending?month=2026-07", authed(holder))).json()) as {
        totals: { currency: string; amount: number; counted_in_transactions: boolean }[];
      };

      const flagFor = (currency: string) => body.totals.find((total) => total.currency === currency)?.counted_in_transactions;
      expect(flagFor("TWD")).toBe(true);
      expect(flagFor("THB")).toBe(false);
    });
  });

  describe("budgets", () => {
    it("PUT creates then updates (upsert) an overall budget, GET reports its progress", async () => {
      const { app } = ctx;
      const token = await validToken();

      const created = await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: null, amount: 20000 }));
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as Record<string, unknown>;
      expect(createdBody).toMatchObject({ category_id: null, amount: 20000 });

      const updated = await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: null, amount: 25000 }));
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ id: createdBody.id, category_id: null, amount: 25000 });

      const progress = await app.request("/api/finance/budgets?month=2026-07", authed(token));
      expect(progress.status).toBe(200);
      const progressBody = (await progress.json()) as { month: string; budgets: { id: string; amount: number; spent: number; remaining: number }[] };
      expect(progressBody.month).toBe("2026-07");
      expect(progressBody.budgets).toEqual([{ id: createdBody.id, category_id: null, amount: 25000, spent: 0, remaining: 25000, percent: 0 }]);
    });

    it("PUT creates a category budget and GET splits overall vs category spent, excluding a USD transaction", async () => {
      const { app } = ctx;
      const token = await validToken();
      const food = await seedCategory(app, token, { name: "餐飲" });
      const transit = await seedCategory(app, token, { name: "交通" });

      await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: null, amount: 10000 }));
      await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: food.id, amount: 3000 }));

      await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 2500, category_id: food.id, date: "2026-07-10" }));
      await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 1000, category_id: transit.id, date: "2026-07-11" }));
      await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 999, currency: "USD", category_id: food.id, date: "2026-07-12" }));

      const progress = (await (await app.request("/api/finance/budgets?month=2026-07", authed(token))).json()) as {
        budgets: { category_id: string | null; spent: number }[];
      };
      const overall = progress.budgets.find((b) => b.category_id === null);
      const foodProgress = progress.budgets.find((b) => b.category_id === food.id);
      expect(overall?.spent).toBe(3500);
      expect(foodProgress?.spent).toBe(2500);
    });

    it("PUT rejects amount <= 0 (400) and an unknown month on GET (400)", async () => {
      const { app } = ctx;
      const token = await validToken();
      expect((await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: null, amount: 0 }))).status).toBe(400);
      expect((await app.request("/api/finance/budgets?month=not-a-month", authed(token))).status).toBe(400);
    });

    it("PUT rejects an income category (400), an archived category (400), and another user's category (404)", async () => {
      const { app } = ctx;
      const token = await validToken();
      const income = await seedCategory(app, token, { name: "薪資", type: "income" });
      const archivable = await seedCategory(app, token, { name: "娛樂" });
      await app.request(`/api/finance/categories/${archivable.id}`, authed(token, "PUT", { archived: true }));
      const otherToken = await validToken("uid-other");
      const otherCategory = await seedCategory(app, otherToken);

      expect((await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: income.id, amount: 1000 }))).status).toBe(400);
      expect((await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: archivable.id, amount: 1000 }))).status).toBe(400);
      expect((await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: otherCategory.id, amount: 1000 }))).status).toBe(404);
    });

    it("DELETE removes an owned budget (200) and 404s for another user's or an unknown budget", async () => {
      const { app } = ctx;
      const owner = await validToken("uid-owner");
      const other = await validToken("uid-other");
      const created = (await (await app.request("/api/finance/budgets", authed(owner, "PUT", { category_id: null, amount: 1000 }))).json()) as { id: string };

      expect((await app.request(`/api/finance/budgets/${created.id}`, authed(other, "DELETE"))).status).toBe(404);
      expect((await app.request("/api/finance/budgets/nope", authed(owner, "DELETE"))).status).toBe(404);

      const deleteRes = await app.request(`/api/finance/budgets/${created.id}`, authed(owner, "DELETE"));
      expect(deleteRes.status).toBe(200);

      const progress = (await (await app.request("/api/finance/budgets?month=2026-07", authed(owner))).json()) as { budgets: unknown[] };
      expect(progress.budgets).toEqual([]);
    });

    it("crossing 80% on a TWD expense POST records and pushes a budget alert", async () => {
      const { app, budgetAlertNotifier } = ctx;
      const token = await validToken();
      const food = await seedCategory(app, token, { name: "餐飲" });
      await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: food.id, amount: 1000 }));

      const res = await app.request("/api/finance/transactions", authed(token, "POST", { type: "expense", amount: 900, category_id: food.id, date: "2026-07-01" }));
      expect(res.status).toBe(200); // the transaction write succeeds regardless of the alert side effect

      expect(budgetAlertNotifier.messages).toHaveLength(1);
      expect(budgetAlertNotifier.messages[0].message).toEqual({ title: "預算提醒", body: "7月餐飲支出已達預算 8 成" });
    });

    it("a TWD split share does consume a budget: both the overall one and the category the split named", async () => {
      // Kept under its former name so the inversion is explicit. The
      // per-category half needs the split to actually name a category: with
      // no name the mirror lands on 其他 and only the overall budget moves,
      // which would leave "the split's category is honoured" unguarded.
      const { app } = ctx;
      const token = await validToken();
      const otherToken = await validToken("uid-other");
      const food = await seedCategory(app, token, { name: "餐飲" });
      const transport = await seedCategory(app, token, { name: "交通" });
      await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: null, amount: 10000 }));
      await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: food.id, amount: 10000 }));
      await app.request("/api/finance/budgets", authed(token, "PUT", { category_id: transport.id, amount: 10000 }));

      await createSplitExpenseBetween(ctx, token, otherToken, 900, "TWD", "2026-07-01", "餐飲");

      const after = (await (await app.request("/api/finance/budgets?month=2026-07", authed(token))).json()) as {
        budgets: Array<{ category_id: string | null; spent: number }>;
      };
      const spentFor = (categoryId: string | null) => after.budgets.find((budget) => budget.category_id === categoryId)?.spent;
      expect(spentFor(null)).toBe(450);
      expect(spentFor(food.id)).toBe(450);
      // The budget of a category the split did not name stays untouched — the
      // share lands somewhere specific, not everywhere.
      expect(spentFor(transport.id)).toBe(0);
    });
  });

  describe("networth", () => {
    async function seedAccount(app: ReturnType<typeof buildApp>["app"], token: string, kind: "asset" | "liability", name: string) {
      const res = await app.request("/api/finance/networth/accounts", authed(token, "POST", { kind, name }));
      return (await res.json()) as { id: string; kind: string; name: string };
    }

    it("requires auth for every /api/finance/networth endpoint", async () => {
      const { app } = ctx;
      expect((await app.request("/api/finance/networth/accounts")).status).toBe(401);
      expect((await app.request("/api/finance/networth/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
      expect((await app.request("/api/finance/networth/accounts/some-id", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
      expect((await app.request("/api/finance/networth/snapshots", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
      expect((await app.request("/api/finance/networth?month=2026-07")).status).toBe(401);
      expect((await app.request("/api/finance/networth/trend?from=2026-01&to=2026-07")).status).toBe(401);
    });

    it("seeds the defaults idempotently on the first two GETs", async () => {
      const { app } = ctx;
      const token = await validToken();
      const first = (await (await app.request("/api/finance/networth/accounts", authed(token))).json()) as { accounts: unknown[] };
      const second = (await (await app.request("/api/finance/networth/accounts", authed(token))).json()) as { accounts: unknown[] };
      expect(first.accounts).toHaveLength(10);
      expect(second.accounts).toHaveLength(10);
    });

    it("creates an account and rejects a duplicate name within the same kind as 400", async () => {
      const { app } = ctx;
      const token = await validToken();
      const res = await app.request("/api/finance/networth/accounts", authed(token, "POST", { kind: "asset", name: "加密貨幣" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ kind: "asset", name: "加密貨幣", sort_order: 0, archived: false });

      const dup = await app.request("/api/finance/networth/accounts", authed(token, "POST", { kind: "asset", name: "加密貨幣" }));
      expect(dup.status).toBe(400);
    });

    it("rejects a create with a missing name (400)", async () => {
      const { app } = ctx;
      const token = await validToken();
      expect((await app.request("/api/finance/networth/accounts", authed(token, "POST", { kind: "asset" }))).status).toBe(400);
    });

    it("PUT updates an owned account's archived flag and 404s for another user's account", async () => {
      const { app } = ctx;
      const owner = await validToken("uid-owner");
      const other = await validToken("uid-other");
      const account = await seedAccount(app, owner, "asset", "股票");

      const ok = await app.request(`/api/finance/networth/accounts/${account.id}`, authed(owner, "PUT", { archived: true }));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ archived: true });

      expect((await app.request(`/api/finance/networth/accounts/${account.id}`, authed(other, "PUT", { name: "x" }))).status).toBe(404);
      expect((await app.request("/api/finance/networth/accounts/nope", authed(owner, "PUT", { name: "x" }))).status).toBe(404);
    });

    it("PUT snapshot upserts (overwrites), rejects negative/archived/foreign", async () => {
      const { app } = ctx;
      const owner = await validToken("uid-owner");
      const other = await validToken("uid-other");
      const account = await seedAccount(app, owner, "asset", "股票");

      await app.request("/api/finance/networth/snapshots", authed(owner, "PUT", { account_id: account.id, month: "2026-07", value: 30000 }));
      const overwrite = await app.request("/api/finance/networth/snapshots", authed(owner, "PUT", { account_id: account.id, month: "2026-07", value: 25000 }));
      expect(overwrite.status).toBe(200);
      expect(await overwrite.json()).toMatchObject({ account_id: account.id, month: "2026-07", value: 25000 });

      // negative value -> 400, malformed month -> 400
      expect((await app.request("/api/finance/networth/snapshots", authed(owner, "PUT", { account_id: account.id, month: "2026-07", value: -1 }))).status).toBe(400);
      expect((await app.request("/api/finance/networth/snapshots", authed(owner, "PUT", { account_id: account.id, month: "2026-13", value: 1 }))).status).toBe(400);
      // foreign account -> 404
      expect((await app.request("/api/finance/networth/snapshots", authed(other, "PUT", { account_id: account.id, month: "2026-07", value: 1 }))).status).toBe(404);

      // archived account -> 400
      await app.request(`/api/finance/networth/accounts/${account.id}`, authed(owner, "PUT", { archived: true }));
      expect((await app.request("/api/finance/networth/snapshots", authed(owner, "PUT", { account_id: account.id, month: "2026-08", value: 1 }))).status).toBe(400);
    });

    it("GET networth returns totals, net worth, prev, and growth rate (spec example)", async () => {
      const { app } = ctx;
      const token = await validToken();
      const stock = await seedAccount(app, token, "asset", "股票");
      const cash = await seedAccount(app, token, "asset", "台幣活存");
      const card = await seedAccount(app, token, "liability", "信用卡");
      const juneAsset = await seedAccount(app, token, "asset", "基金");
      await app.request("/api/finance/networth/snapshots", authed(token, "PUT", { account_id: juneAsset.id, month: "2026-06", value: 460181 }));
      await app.request("/api/finance/networth/snapshots", authed(token, "PUT", { account_id: stock.id, month: "2026-07", value: 350000 }));
      await app.request("/api/finance/networth/snapshots", authed(token, "PUT", { account_id: cash.id, month: "2026-07", value: 170000 }));
      await app.request("/api/finance/networth/snapshots", authed(token, "PUT", { account_id: card.id, month: "2026-07", value: 41484 }));

      const res = await app.request("/api/finance/networth?month=2026-07", authed(token));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        month: string;
        accounts: unknown[];
        total_asset: number;
        total_liability: number;
        net_worth: number;
        prev_net_worth: number | null;
        growth_rate: number | null;
      };
      expect(body.month).toBe("2026-07");
      expect(body.total_asset).toBe(520000);
      expect(body.total_liability).toBe(41484);
      expect(body.net_worth).toBe(478516);
      expect(body.prev_net_worth).toBe(460181);
      expect(body.growth_rate).toBeCloseTo(0.0398, 4);
      expect(body.accounts).toHaveLength(3);
    });

    it("GET networth returns null prev/growth for the first month with data", async () => {
      const { app } = ctx;
      const token = await validToken();
      const stock = await seedAccount(app, token, "asset", "股票");
      await app.request("/api/finance/networth/snapshots", authed(token, "PUT", { account_id: stock.id, month: "2026-07", value: 100000 }));
      const body = (await (await app.request("/api/finance/networth?month=2026-07", authed(token))).json()) as {
        net_worth: number;
        prev_net_worth: number | null;
        growth_rate: number | null;
      };
      expect(body.net_worth).toBe(100000);
      expect(body.prev_net_worth).toBeNull();
      expect(body.growth_rate).toBeNull();
    });

    it("GET networth rejects a malformed month with 400", async () => {
      const { app } = ctx;
      const token = await validToken();
      expect((await app.request("/api/finance/networth?month=2026-13", authed(token))).status).toBe(400);
    });

    it("GET trend lists months ascending, skipping empty months, and empty for a barren range", async () => {
      const { app } = ctx;
      const token = await validToken();
      const asset = await seedAccount(app, token, "asset", "股票");
      const liability = await seedAccount(app, token, "liability", "信用卡");
      await app.request("/api/finance/networth/snapshots", authed(token, "PUT", { account_id: asset.id, month: "2026-01", value: 400000 }));
      await app.request("/api/finance/networth/snapshots", authed(token, "PUT", { account_id: liability.id, month: "2026-01", value: 24959 }));
      await app.request("/api/finance/networth/snapshots", authed(token, "PUT", { account_id: asset.id, month: "2026-03", value: 420000 }));

      const res = await app.request("/api/finance/networth/trend?from=2026-01&to=2026-03", authed(token));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { points: { month: string; net_worth: number }[] };
      expect(body.points).toEqual([
        { month: "2026-01", net_worth: 375041 },
        { month: "2026-03", net_worth: 420000 },
      ]);

      const empty = (await (await app.request("/api/finance/networth/trend?from=2026-05&to=2026-08", authed(token))).json()) as { points: unknown[] };
      expect(empty.points).toEqual([]);
    });

    it("GET trend rejects a malformed range with 400", async () => {
      const { app } = ctx;
      const token = await validToken();
      expect((await app.request("/api/finance/networth/trend?from=nope&to=2026-08", authed(token))).status).toBe(400);
    });

    describe("PUT /api/finance/networth/accounts/order (batch reorder, issue #80)", () => {
      // Accounts are seeded via POST only — never GET /accounts here, because
      // GET lazily seeds the 10 defaults and would silently widen "全部科目"
      // beyond what these fixtures control. State is asserted directly on the
      // in-memory fake for the same reason: "拒絕而且不寫入任何一筆" must mean
      // no account object changed, not just that a later GET looks plausible.
      async function seedOrdered(token: string, kind: "asset" | "liability", name: string, sortOrder: number) {
        const res = await ctx.app.request(
          "/api/finance/networth/accounts",
          authed(token, "POST", { kind, name, sort_order: sortOrder }),
        );
        expect(res.status).toBe(200);
        return (await res.json()) as { id: string };
      }

      function sortOrderOf(id: string): number | undefined {
        return ctx.financeNetWorthRepository.accounts.find((a) => a.id === id)?.sortOrder;
      }

      it("rejects ids missing one of the user's accounts of that kind (400) and writes nothing", async () => {
        const token = await validToken("uid-owner");
        const stock = await seedOrdered(token, "asset", "股票", 10);
        const cash = await seedOrdered(token, "asset", "現金", 20);

        const res = await ctx.app.request(
          "/api/finance/networth/accounts/order",
          authed(token, "PUT", { kind: "asset", ids: [stock.id] }),
        );
        expect(res.status).toBe(400);
        expect(sortOrderOf(stock.id)).toBe(10);
        expect(sortOrderOf(cash.id)).toBe(20);
      });

      it("rejects a duplicated id padding out the length (400) and writes nothing", async () => {
        // The one shape that keeps `ids.length` right while omitting an
        // account: send one id twice. A length check plus "every given id is
        // mine" both pass on this input — only comparing it as a *set* against
        // the user's own ids rejects it. Behaviour was confirmed by hand
        // during review and then not pinned by anything, which is how it would
        // quietly stop holding.
        const token = await validToken("uid-owner");
        const stock = await seedOrdered(token, "asset", "股票", 10);
        const cash = await seedOrdered(token, "asset", "現金", 20);

        const res = await ctx.app.request(
          "/api/finance/networth/accounts/order",
          authed(token, "PUT", { kind: "asset", ids: [stock.id, stock.id] }),
        );
        expect(res.status).toBe(400);
        expect(sortOrderOf(stock.id)).toBe(10);
        expect(sortOrderOf(cash.id)).toBe(20);
      });

      it("rejects an invalid kind before it can reach the write (400)", async () => {
        // `ids: []`, deliberately. With a non-empty `ids` this test cannot
        // fail: dropping the kind check makes `filter(a => a.kind === "savings")`
        // return nothing, the set comparison then rejects on length, and the
        // response is 400 either way — the assertion could not tell "invalid
        // kind" from "set mismatch". Empty ids make both sides empty, so the
        // set comparison passes vacuously and only the kind check is left
        // standing between the request and a write with a bogus kind.
        const token = await validToken("uid-owner");
        const stock = await seedOrdered(token, "asset", "股票", 10);

        const res = await ctx.app.request(
          "/api/finance/networth/accounts/order",
          authed(token, "PUT", { kind: "savings", ids: [] }),
        );
        expect(res.status).toBe(400);
        expect(sortOrderOf(stock.id)).toBe(10);
      });

      it("rejects ids containing an extra unknown id (400) and writes nothing", async () => {
        const token = await validToken("uid-owner");
        const stock = await seedOrdered(token, "asset", "股票", 10);
        const cash = await seedOrdered(token, "asset", "現金", 20);

        const res = await ctx.app.request(
          "/api/finance/networth/accounts/order",
          authed(token, "PUT", { kind: "asset", ids: [cash.id, stock.id, "00000000-0000-0000-0000-0000000000ff"] }),
        );
        expect(res.status).toBe(400);
        expect(sortOrderOf(stock.id)).toBe(10);
        expect(sortOrderOf(cash.id)).toBe(20);
      });

      it("rejects ids smuggling in another user's or another kind's account (400) and writes nothing", async () => {
        const owner = await validToken("uid-owner");
        const other = await validToken("uid-other");
        const stock = await seedOrdered(owner, "asset", "股票", 10);
        const cash = await seedOrdered(owner, "asset", "現金", 20);
        const loan = await seedOrdered(owner, "liability", "學貸", 30);
        const foreign = await seedOrdered(other, "asset", "外人資產", 40);

        // Both fixtures keep the LENGTH equal to the owner's asset count (2),
        // so an implementation that only checks length passes them — and both
        // make exactly one of {ownership, kind} the failing check, so an
        // implementation that checks only the other one passes them too.
        const wrongUser = await ctx.app.request(
          "/api/finance/networth/accounts/order",
          authed(owner, "PUT", { kind: "asset", ids: [stock.id, foreign.id] }),
        );
        expect(wrongUser.status).toBe(400);

        const wrongKind = await ctx.app.request(
          "/api/finance/networth/accounts/order",
          authed(owner, "PUT", { kind: "asset", ids: [stock.id, loan.id] }),
        );
        expect(wrongKind.status).toBe(400);

        expect(sortOrderOf(stock.id)).toBe(10);
        expect(sortOrderOf(cash.id)).toBe(20);
        expect(sortOrderOf(loan.id)).toBe(30);
        expect(sortOrderOf(foreign.id)).toBe(40);
      });

      it("reorders archived accounts in the same ordering space: the archived id must be given and gets its own sortOrder", async () => {
        const token = await validToken("uid-owner");
        const stock = await seedOrdered(token, "asset", "股票", 10);
        const cash = await seedOrdered(token, "asset", "現金", 20);
        const archive = await ctx.app.request(`/api/finance/networth/accounts/${cash.id}`, authed(token, "PUT", { archived: true }));
        expect(archive.status).toBe(200);

        // The archived account is in ids (an implementation that drops
        // archived from the validation scope sees it as "extra" and 400s) and
        // lands FIRST (an implementation that skips writing archived leaves
        // its sortOrder at 20 while still returning 200).
        const res = await ctx.app.request(
          "/api/finance/networth/accounts/order",
          authed(token, "PUT", { kind: "asset", ids: [cash.id, stock.id] }),
        );
        expect(res.status).toBe(200);
        expect(sortOrderOf(cash.id)).toBe(0);
        expect(sortOrderOf(stock.id)).toBe(1);
      });
    });
  });
});
