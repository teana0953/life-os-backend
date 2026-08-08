import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import {
  ModelFailure,
  type AssistantMessage,
  type AssistantTool,
  type ModelClient,
  type ModelFailureReason,
  type ModelTurn,
  type ToolRound,
} from "../../../src/contexts/assistant/domain/model-client";
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

/** Scripted `ModelClient`: plays back the given turns and records what it saw. */
class ScriptedModel implements ModelClient {
  seen: Array<{ apiKey: string; rounds: ToolRound[] }> = [];

  constructor(private readonly turns: Array<ModelTurn | ModelFailure | Error>) {}

  async turn(apiKey: string, _system: string, _messages: AssistantMessage[], _tools: AssistantTool[], rounds: ToolRound[]): Promise<ModelTurn> {
    this.seen.push({ apiKey, rounds: rounds.map((r) => ({ calls: [...r.calls], results: [...r.results] })) });
    const next = this.turns.shift();
    if (next === undefined) throw new Error("scripted model ran out of turns");
    if (next instanceof Error) throw next;
    return next;
  }
}

function buildApp(model: ModelClient) {
  const financeCategoryRepository = new InMemoryFinanceCategoryRepository();
  const financeTransactionRepository = new InMemoryFinanceTransactionRepository();
  const financeBudgetRepository = new InMemoryFinanceBudgetRepository(financeTransactionRepository);
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
    financeNetWorthRepository: new InMemoryNetWorthRepository(),
    installmentPlanRepository: new InMemoryInstallmentPlanRepository(financeTransactionRepository),
    budgetAlertNotifier: new FakeBudgetAlertNotifier(),
    vapidPublicKey: "",
    friendshipRepository: stubFriendshipRepository,
    friendInviteRepository: stubFriendInviteRepository,
    expenseGroupRepository: stubExpenseGroupRepository,
    splitExpenseRepository: stubSplitExpenseRepository,
    splitBalanceRepository: stubSplitBalanceRepository,
    splitFriendChecker: stubSplitFriendChecker,
    splitSettlementRepository: stubSettlementRepository,
    splitActivityRepository: stubSplitActivityRepository,
    splitSpendingRepository: stubSplitSpendingRepository,
    modelClient: model,
    ping: async () => {},
  });
  return { app, financeTransactionRepository };
}

const CANARY_KEY = "SECRET-KEY-c4n4ry";

function assistantRequest(token: string, body: unknown, headers: Record<string, string> = {}, path = "/api/assistant") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const ASK = { messages: [{ role: "user", content: "這個月吃飯花多少?" }] };
const TEXT_ONLY: ModelTurn = { text: "answer", toolCalls: [] };

describe("POST /api/assistant — the key", () => {
  it("refuses a request without a key with a 400 naming the setting, not a 500", async () => {
    const { app } = buildApp(new ScriptedModel([TEXT_ONLY]));
    const token = await validToken();

    const res = await app.request(assistantRequest(token, ASK));

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; message: string }>();
    expect(body.error).toBe("bad_request");
    expect(body.message).toContain("設定");
  });

  it("reads the key from the header only — a key in the query string is a missing key", async () => {
    // Two halves so that a mutation moving the read to the query flips one of
    // them: query-only must stay 400, header-only must stay 200.
    const token = await validToken();

    const queryOnly = buildApp(new ScriptedModel([TEXT_ONLY]));
    const resQuery = await queryOnly.app.request(assistantRequest(token, ASK, {}, `/api/assistant?key=${CANARY_KEY}`));
    expect(resQuery.status).toBe(400);

    const headerOnly = buildApp(new ScriptedModel([TEXT_ONLY]));
    const resHeader = await headerOnly.app.request(assistantRequest(token, ASK, { "X-Gemini-Api-Key": CANARY_KEY }));
    expect(resHeader.status).toBe(200);
  });

  it("hands the model the caller's key untouched", async () => {
    const model = new ScriptedModel([TEXT_ONLY]);
    const { app } = buildApp(model);
    const res = await app.request(assistantRequest(await validToken(), ASK, { "X-Gemini-Api-Key": CANARY_KEY }));

    expect(res.status).toBe(200);
    expect(model.seen[0].apiKey).toBe(CANARY_KEY);
  });

  it("never echoes the key on any path — success and every error alike", async () => {
    // One canary, every path. A single success-only scan would miss the key
    // leaking from an error handler, which is where echoes usually live.
    const token = await validToken();
    const scenarios: Array<{ name: string; build: () => { app: ReturnType<typeof buildApp>["app"] }; body: unknown; status: number; token?: string }> = [
      { name: "success", build: () => buildApp(new ScriptedModel([TEXT_ONLY])), body: ASK, status: 200 },
      { name: "missing messages", build: () => buildApp(new ScriptedModel([TEXT_ONLY])), body: {}, status: 400 },
      {
        name: "malformed message",
        build: () => buildApp(new ScriptedModel([TEXT_ONLY])),
        body: { messages: [{ role: "system", content: "x" }] },
        status: 400,
      },
      { name: "key rejected", build: () => buildApp(new ScriptedModel([new ModelFailure("key_rejected")])), body: ASK, status: 400 },
      { name: "quota exhausted", build: () => buildApp(new ScriptedModel([new ModelFailure("quota_exhausted")])), body: ASK, status: 429 },
      { name: "model unavailable", build: () => buildApp(new ScriptedModel([new ModelFailure("model_unavailable")])), body: ASK, status: 403 },
      { name: "unknown model failure", build: () => buildApp(new ScriptedModel([new ModelFailure("unknown")])), body: ASK, status: 502 },
      { name: "internal error", build: () => buildApp(new ScriptedModel([new Error(`boom with ${CANARY_KEY}`)])), body: ASK, status: 500 },
      // 401 belongs here even though nothing in this handler runs: the
      // request still arrives carrying the key, so an auth failure that
      // echoed what it received would leak it before the route is reached.
      // (`missing key` — a 400 — is deliberately absent: that request has no
      // key on it, so scanning it proves nothing.)
      { name: "unauthenticated", build: () => buildApp(new ScriptedModel([TEXT_ONLY])), body: ASK, status: 401, token: "not-a-token" },
    ];

    for (const scenario of scenarios) {
      const { app } = scenario.build();
      const res = await app.request(assistantRequest(scenario.token ?? token, scenario.body, { "X-Gemini-Api-Key": CANARY_KEY }));

      // The status pins each scenario to the path it claims to cover — a
      // table of 404s would scan nothing.
      expect(scenario.name + ":" + res.status).toBe(scenario.name + ":" + scenario.status);
      expect(await res.text()).not.toContain("SECRET-KEY");
    }
  });
});

describe("POST /api/assistant — the three failures", () => {
  const cases: Array<{ reason: ModelFailureReason; status: number; error: string }> = [
    { reason: "key_rejected", status: 400, error: "gemini_key_rejected" },
    { reason: "quota_exhausted", status: 429, error: "gemini_quota_exhausted" },
    { reason: "model_unavailable", status: 403, error: "gemini_model_unavailable" },
  ];

  for (const { reason, status, error } of cases) {
    it(`${reason} is reported as itself: ${status} ${error}`, async () => {
      const { app } = buildApp(new ScriptedModel([new ModelFailure(reason)]));

      const res = await app.request(assistantRequest(await validToken(), ASK, { "X-Gemini-Api-Key": CANARY_KEY }));

      // Each case asserts its own literal status and code, so collapsing any
      // two of the three reddens at least one of these.
      expect(res.status).toBe(status);
      expect((await res.json<{ error: string }>()).error).toBe(error);
    });
  }
});

describe("POST /api/assistant — identity and writes", () => {
  it("runs tools under the token's user, ignoring a userId in the body", async () => {
    const model = new ScriptedModel([
      { text: "", toolCalls: [{ id: "s#0", name: "get_monthly_summary", arguments: {} }] },
      TEXT_ONLY,
    ]);
    const built = buildApp(model);
    const seen: string[] = [];
    const raw = built.financeTransactionRepository.getMonthlySummaryRaw.bind(built.financeTransactionRepository);
    built.financeTransactionRepository.getMonthlySummaryRaw = async (userId: string, month: string) => {
      seen.push(userId);
      return raw(userId, month);
    };
    const token = await validToken();
    const meRes = await built.app.request(new Request("http://localhost/api/me", { headers: { Authorization: `Bearer ${token}` } }));
    const me = await meRes.json<{ id: string }>();

    const res = await built.app.request(
      assistantRequest(token, { ...ASK, userId: "somebody-else", user_id: "somebody-else" }, { "X-Gemini-Api-Key": CANARY_KEY }),
    );

    expect(res.status).toBe(200);
    expect(seen).toEqual([me.id]);
  });

  it("returns a proposal card and leaves the database with zero new rows", async () => {
    const model = new ScriptedModel([
      {
        text: "",
        toolCalls: [{ id: "p#0", name: "propose_transaction", arguments: { type: "expense", amount: 180, category_name: "餐飲" } }],
      },
      { text: "記下來了嗎?還沒 — 請確認。", toolCalls: [] },
    ]);
    const built = buildApp(model);

    const res = await built.app.request(assistantRequest(await validToken(), ASK, { "X-Gemini-Api-Key": CANARY_KEY }));

    expect(res.status).toBe(200);
    const body = await res.json<{ text: string; proposals: Array<{ kind: string; fields: Record<string, unknown> }> }>();
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].kind).toBe("create_transaction");
    expect(body.proposals[0].fields.amount).toBe(180);
    // The proposal round-tripped through the whole HTTP stack and the fake
    // database gained nothing.
    expect(built.financeTransactionRepository.transactions).toEqual([]);
  });
});

describe("CORS for the assistant", () => {
  it("allows the key header through preflight", async () => {
    // Without this, only a real browser fails — every server-side test stays
    // green while the whole feature is unreachable from the web app.
    const { app } = buildApp(new ScriptedModel([]));

    const res = await app.request(
      new Request("http://localhost/api/assistant", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "X-Gemini-Api-Key",
        },
      }),
    );

    expect(res.headers.get("Access-Control-Allow-Headers") ?? "").toContain("X-Gemini-Api-Key");
  });
});
