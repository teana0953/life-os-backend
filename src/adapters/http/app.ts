import { Hono } from "hono";
import { cors } from "hono/cors";
import type { JWTVerifyGetKey } from "jose";
import type { ModelClient } from "../../contexts/assistant/domain/model-client";
import { ModelFailure } from "../../contexts/assistant/domain/model-client";
import { FinanceSharesMirror } from "../../contexts/finance/adapters/finance-shares-mirror";
import type { BudgetAlertNotifier } from "../../contexts/finance/domain/budget-alert-notifier";
import type { FinanceBudgetRepository } from "../../contexts/finance/domain/finance-budget-repository";
import type { FinanceCategoryRepository } from "../../contexts/finance/domain/finance-category-repository";
import type { FinanceTransactionRepository } from "../../contexts/finance/domain/finance-transaction-repository";
import type { InstallmentPlanRepository } from "../../contexts/finance/domain/installment-plan-repository";
import type { NetWorthRepository } from "../../contexts/finance/domain/networth-repository";
import type { BodyProfileRepository } from "../../contexts/health/domain/body-profile-repository";
import type { BowelRepository } from "../../contexts/health/domain/bowel-repository";
import type { ChaodaysClient } from "../../contexts/health/domain/chaodays-client";
import { ChaodaysAuthError, ChaodaysUpstreamError } from "../../contexts/health/domain/chaodays-client";
import type { DailyTargetRepository } from "../../contexts/health/domain/daily-target-repository";
import type { HealthCalendarRepository } from "../../contexts/health/domain/health-calendar-repository";
import type { ExerciseRepository } from "../../contexts/health/domain/exercise-repository";
import type { FoodDictionaryRepository } from "../../contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../contexts/health/domain/meal-repository";
import type { MenstrualRepository } from "../../contexts/health/domain/menstrual-repository";
import type { VitalsRepository } from "../../contexts/health/domain/vitals-repository";
import type { WaterRepository } from "../../contexts/health/domain/water-repository";
import type { FriendInviteRepository } from "../../contexts/social/domain/friend-invite-repository";
import type { FriendshipRepository } from "../../contexts/social/domain/friendship-repository";
import type { BalanceRepository } from "../../contexts/split/domain/balance-repository";
import type { ExpenseGroupRepository } from "../../contexts/split/domain/expense-group-repository";
import type { FriendChecker } from "../../contexts/split/domain/friend-checker";
import type { SettlementRepository } from "../../contexts/split/domain/settlement-repository";
import type { SplitActivityRepository } from "../../contexts/split/domain/split-activity-repository";
import type { SplitExpenseRepository } from "../../contexts/split/domain/split-expense-repository";
import type { SplitSpendingRepository } from "../../contexts/split/domain/split-spending-repository";
import type { PushSender } from "../../contexts/notifications/domain/push-sender";
import type { PushSubscriptionRepository } from "../../contexts/notifications/domain/push-subscription";
import type { CareItemRepository } from "../../contexts/notifications/domain/care-item";
import type { CareLogRepository } from "../../contexts/notifications/domain/care-log";
import type { CareDayInstanceManager } from "../../contexts/notifications/domain/care-day-instance";
import type { UserRepository } from "../../contexts/user/domain/user-repository";
import type { UserDisplayNameRepository } from "../../contexts/user/domain/user-display-name-repository";
import { createAuthMiddleware, type AuthVariables } from "./middleware/auth";
import { logInternalError } from "./error-logging";
import {
  createCreateSharedFoodItemHandler,
  createUpdateSharedFoodItemHandler,
} from "./routes/admin-food-dictionary";
import {
  createGetDailyTargetHandler,
  createSetDailyTargetHandler,
} from "./routes/daily-target";
import {
  createCustomFoodItemHandler,
  createFavoriteFoodItemHandler,
  createListFavoriteFoodItemsHandler,
  createSearchFoodDictionaryHandler,
  createUnfavoriteFoodItemHandler,
} from "./routes/food-dictionary";
import { createGetBowelHandler, createSetBowelHandler } from "./routes/bowel";
import {
  createDeleteExerciseHandler,
  createGetExerciseHandler,
  createListExerciseActivitiesHandler,
  createLogExerciseHandler,
} from "./routes/exercise";
import { createGetVitalsHandler, createGetVitalsRangeHandler, createSetVitalsHandler } from "./routes/vitals";
import {
  createGetBodyProfileHandler,
  createGetWeightGoalHandler,
  createSetBodyProfileHandler,
} from "./routes/body-profile";
import {
  createAddMenstrualHandler,
  createDeleteMenstrualHandler,
  createGetMenstrualHandler,
  createUpdateMenstrualHandler,
} from "./routes/menstrual";
import { createGetHealthCalendarHandler } from "./routes/health-calendar";
import { createHealthHandler } from "./routes/health";
import {
  createImportChaodaysBowelHandler,
  createImportChaodaysDietHandler,
  createImportChaodaysDietTargetHandler,
  createImportChaodaysMenstrualHandler,
  createImportChaodaysWaterHandler,
  createImportChaodaysWeightHandler,
} from "./routes/import-chaodays";
import {
  createCreateMealHandler,
  createDeleteMealHandler,
  createDeleteMealItemHandler,
  createGetDayMealsHandler,
  createGetLoggedDaysHandler,
  createUpdateMealItemHandler,
  createUpdateMealTimeHandler,
} from "./routes/meals";
import { createMeHandler, createUpdateMeHandler } from "./routes/me";
import {
  createGetVapidPublicKeyHandler,
  createSubscribeWebPushHandler,
  createTestPushHandler,
  createUnsubscribeWebPushHandler,
} from "./routes/push";
import {
  createAnswerCareSlotHandler,
  createCreateCareItemHandler,
  createDeleteCareItemHandler,
  createEditCareSlotHandler,
  createGetCareRangeHandler,
  createGetCareTodayHandler,
  createListCareItemsHandler,
  createUpdateCareItemHandler,
} from "./routes/care";
import {
  createCreateCategoryHandler,
  createCreateInstallmentPlanHandler,
  createCreateNetWorthAccountHandler,
  createCreateTransactionHandler,
  createDeleteBudgetHandler,
  createDeleteTransactionHandler,
  createGetBudgetsHandler,
  createGetInstallmentPlanHandler,
  createGetNetWorthHandler,
  createGetNetWorthTrendHandler,
  createGetSplitSpendingHandler,
  createGetSummaryHandler,
  createListCategoriesHandler,
  createListNetWorthAccountsHandler,
  createListTransactionsHandler,
  createReorderNetWorthAccountsHandler,
  createSettleInstallmentPlanHandler,
  createUpdateCategoryHandler,
  createUpdateInstallmentPlanHandler,
  createUpdateNetWorthAccountHandler,
  createUpdateTransactionHandler,
  createUpsertBudgetHandler,
  createUpsertNetWorthSnapshotHandler,
} from "./routes/finance";
import {
  createAcceptInviteHandler,
  createCreateInviteHandler,
  createListFriendsHandler,
  createListMyInvitesHandler,
  createPreviewInviteHandler,
  createRemoveFriendHandler,
  createRevokeInviteHandler,
} from "./routes/friends";
import {
  createAddGroupMemberHandler,
  createArchiveGroupHandler,
  createCreateExpenseHandler,
  createCreateGroupHandler,
  createCreateSettlementHandler,
  createDeleteExpenseHandler,
  createDeleteSettlementHandler,
  createGetBalancesHandler,
  createGetExpenseHandler,
  createGetGroupBalancesHandler,
  createGetGroupHandler,
  createListActivityHandler,
  createListExpensesHandler,
  createListMyGroupsHandler,
  createListSettlementsHandler,
  createUpdateExpenseHandler,
} from "./routes/split";
import { createAssistantHandler } from "./routes/assistant";
import { GEMINI_KEY_HEADER } from "./routes/assistant-key";
import { createSetUserTimezoneHandler } from "./routes/user-timezone";
import {
  createAddWaterHandler,
  createGetWaterHandler,
  createSetWaterTargetHandler,
} from "./routes/water";
import { BadRequestError } from "./validation";

/**
 * Allows the Flutter web client: any localhost port during local development,
 * plus one configured production origin (the deployed Cloudflare Pages URL).
 */
function isAllowedOrigin(origin: string, productionOrigin?: string): boolean {
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return productionOrigin !== undefined && productionOrigin !== "" && origin === productionOrigin;
}

export interface CreateAppOptions {
  projectId: string;
  jwks: JWTVerifyGetKey;
  userRepository: UserRepository;
  /** Separate write capability; optional only for route-focused test apps that never call PATCH /api/me. */
  userDisplayNameRepository?: UserDisplayNameRepository;
  foodDictionaryRepository: FoodDictionaryRepository;
  mealRepository: MealRepository;
  dailyTargetRepository: DailyTargetRepository;
  waterRepository: WaterRepository;
  bowelRepository: BowelRepository;
  vitalsRepository: VitalsRepository;
  exerciseRepository: ExerciseRepository;
  menstrualRepository: MenstrualRepository;
  bodyProfileRepository: BodyProfileRepository;
  healthCalendarRepository: HealthCalendarRepository;
  chaodaysClient: ChaodaysClient;
  pushSubscriptionRepository: PushSubscriptionRepository;
  pushSender: PushSender;
  /** Configured VAPID public key, or "" when unset (D6 in design.md). */
  vapidPublicKey: string;
  careItemRepository: CareItemRepository;
  careLogRepository: CareLogRepository;
  /** Optional: care/timezone/push-subscription changes best-effort restart today's instance (key_decisions "即時生效機制"). */
  careDayInstanceManager?: CareDayInstanceManager;
  financeCategoryRepository: FinanceCategoryRepository;
  financeTransactionRepository: FinanceTransactionRepository;
  financeBudgetRepository: FinanceBudgetRepository;
  financeNetWorthRepository: NetWorthRepository;
  installmentPlanRepository: InstallmentPlanRepository;
  budgetAlertNotifier: BudgetAlertNotifier;
  friendshipRepository: FriendshipRepository;
  friendInviteRepository: FriendInviteRepository;
  expenseGroupRepository: ExpenseGroupRepository;
  splitExpenseRepository: SplitExpenseRepository;
  splitBalanceRepository: BalanceRepository;
  splitFriendChecker: FriendChecker;
  splitSettlementRepository: SettlementRepository;
  splitActivityRepository: SplitActivityRepository;
  splitSpendingRepository: SplitSpendingRepository;
  modelClient: ModelClient;
  ping: () => Promise<void>;
  /** Deployed web app origin (Cloudflare Pages) to allow via CORS, in addition to localhost. */
  allowedWebOrigin?: string;
}

/** Composes the Hono app (driving adapter): routes, auth middleware, and the uniform error handler. */
export function createApp(options: CreateAppOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Browser clients (Flutter web) are cross-origin; allow localhost during dev
  // and permit the Authorization header + preflight for GET requests.
  app.use(
    "*",
    cors({
      origin: (origin) => (isAllowedOrigin(origin, options.allowedWebOrigin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      // GEMINI_KEY_HEADER must be allowed here or the browser's preflight
      // rejects every assistant request before it leaves the client.
      allowHeaders: ["Authorization", "Content-Type", GEMINI_KEY_HEADER],
    }),
  );

  app.onError((err, c) => {
    if (err instanceof BadRequestError) {
      return c.json({ error: "bad_request", message: err.message }, 400);
    }
    if (err instanceof ChaodaysAuthError) {
      return c.json({ error: "chaodays_auth_failed" }, 400);
    }
    if (err instanceof ChaodaysUpstreamError) {
      // `detail` is a short, non-credential diagnostic (e.g. "status_403",
      // "network", "parse") to tell apart a WAF/bot block from a network error.
      return c.json({ error: "chaodays_unavailable", detail: err.reason }, 502);
    }
    if (err instanceof ModelFailure) {
      // Three of these are the caller's own account, and each is reported as
      // itself — collapsed, they all read as "the assistant is broken", which
      // is both wrong and unactionable. Nothing here echoes the request or key.
      switch (err.reason) {
        case "key_rejected":
          return c.json({ error: "gemini_key_rejected", message: "Gemini 拒絕了這把金鑰，請到 設定 > AI 助手 檢查" }, 400);
        case "quota_exhausted":
          return c.json({ error: "gemini_quota_exhausted", message: "你的 Gemini 免費額度已用盡" }, 429);
        case "model_unavailable":
          return c.json({ error: "gemini_model_unavailable", message: "這把金鑰無法使用此模型" }, 403);
        default:
          return c.json({ error: "gemini_unavailable" }, 502);
      }
    }
    logInternalError(err);
    return c.json({ error: "internal" }, 500);
  });

  app.get("/health", createHealthHandler({ ping: options.ping }));

  const authMiddleware = createAuthMiddleware({ projectId: options.projectId, jwks: options.jwks });
  const meOptions = {
    userRepository: options.userRepository,
    userDisplayNameRepository:
      options.userDisplayNameRepository ?? {
        updateDisplayName: async () => {
          throw new Error("display-name repository not configured");
        },
      },
  };
  app.get("/api/me", authMiddleware, createMeHandler(meOptions));
  app.patch("/api/me", authMiddleware, createUpdateMeHandler(meOptions));

  const foodDictionaryOptions = { userRepository: options.userRepository, foodDictionaryRepository: options.foodDictionaryRepository };
  app.get("/api/food-items/favorites", authMiddleware, createListFavoriteFoodItemsHandler(foodDictionaryOptions));
  app.get("/api/food-items", authMiddleware, createSearchFoodDictionaryHandler(foodDictionaryOptions));
  app.post("/api/food-items", authMiddleware, createCustomFoodItemHandler(foodDictionaryOptions));
  app.post("/api/food-items/:id/favorite", authMiddleware, createFavoriteFoodItemHandler(foodDictionaryOptions));
  app.delete("/api/food-items/:id/favorite", authMiddleware, createUnfavoriteFoodItemHandler(foodDictionaryOptions));
  app.post("/api/admin/food-items", authMiddleware, createCreateSharedFoodItemHandler(foodDictionaryOptions));
  app.patch("/api/admin/food-items/:id", authMiddleware, createUpdateSharedFoodItemHandler(foodDictionaryOptions));

  const mealOptions = {
    userRepository: options.userRepository,
    mealRepository: options.mealRepository,
    foodDictionaryRepository: options.foodDictionaryRepository,
  };
  app.post("/api/meals", authMiddleware, createCreateMealHandler(mealOptions));
  app.get("/api/meals/logged-days", authMiddleware, createGetLoggedDaysHandler(mealOptions));
  app.get("/api/meals", authMiddleware, createGetDayMealsHandler(mealOptions));
  app.patch("/api/meals/:id", authMiddleware, createUpdateMealTimeHandler(mealOptions));
  app.delete("/api/meals/:id", authMiddleware, createDeleteMealHandler(mealOptions));
  app.patch("/api/meal-items/:id", authMiddleware, createUpdateMealItemHandler(mealOptions));
  app.delete("/api/meal-items/:id", authMiddleware, createDeleteMealItemHandler(mealOptions));

  const dailyTargetOptions = {
    userRepository: options.userRepository,
    dailyTargetRepository: options.dailyTargetRepository,
    mealRepository: options.mealRepository,
  };
  app.get("/api/daily-target", authMiddleware, createGetDailyTargetHandler(dailyTargetOptions));
  app.put("/api/daily-target", authMiddleware, createSetDailyTargetHandler(dailyTargetOptions));

  const waterOptions = {
    userRepository: options.userRepository,
    waterRepository: options.waterRepository,
  };
  app.get("/api/water", authMiddleware, createGetWaterHandler(waterOptions));
  app.post("/api/water", authMiddleware, createAddWaterHandler(waterOptions));
  app.put("/api/water/target", authMiddleware, createSetWaterTargetHandler(waterOptions));

  const bowelOptions = {
    userRepository: options.userRepository,
    bowelRepository: options.bowelRepository,
  };
  app.get("/api/bowel", authMiddleware, createGetBowelHandler(bowelOptions));
  app.put("/api/bowel", authMiddleware, createSetBowelHandler(bowelOptions));

  const vitalsOptions = {
    userRepository: options.userRepository,
    vitalsRepository: options.vitalsRepository,
  };
  app.get("/api/vitals/range", authMiddleware, createGetVitalsRangeHandler(vitalsOptions));
  app.get("/api/vitals", authMiddleware, createGetVitalsHandler(vitalsOptions));
  app.put("/api/vitals", authMiddleware, createSetVitalsHandler(vitalsOptions));

  const exerciseOptions = {
    userRepository: options.userRepository,
    exerciseRepository: options.exerciseRepository,
    dailyTargetRepository: options.dailyTargetRepository,
  };
  app.get("/api/exercise/activities", authMiddleware, createListExerciseActivitiesHandler(exerciseOptions));
  app.get("/api/exercise", authMiddleware, createGetExerciseHandler(exerciseOptions));
  app.post("/api/exercise", authMiddleware, createLogExerciseHandler(exerciseOptions));
  app.delete("/api/exercise/:id", authMiddleware, createDeleteExerciseHandler(exerciseOptions));

  const menstrualOptions = {
    userRepository: options.userRepository,
    menstrualRepository: options.menstrualRepository,
  };
  app.get("/api/menstrual", authMiddleware, createGetMenstrualHandler(menstrualOptions));
  app.post("/api/menstrual", authMiddleware, createAddMenstrualHandler(menstrualOptions));
  app.patch("/api/menstrual/:id", authMiddleware, createUpdateMenstrualHandler(menstrualOptions));
  app.delete("/api/menstrual/:id", authMiddleware, createDeleteMenstrualHandler(menstrualOptions));

  const bodyProfileOptions = {
    userRepository: options.userRepository,
    bodyProfileRepository: options.bodyProfileRepository,
    vitalsRepository: options.vitalsRepository,
  };
  app.get("/api/body-profile", authMiddleware, createGetBodyProfileHandler(bodyProfileOptions));
  app.put("/api/body-profile", authMiddleware, createSetBodyProfileHandler(bodyProfileOptions));
  app.get("/api/weight-goal", authMiddleware, createGetWeightGoalHandler(bodyProfileOptions));

  const healthCalendarOptions = {
    userRepository: options.userRepository,
    healthCalendarRepository: options.healthCalendarRepository,
    dailyTargetRepository: options.dailyTargetRepository,
    mealRepository: options.mealRepository,
  };
  app.get("/api/health-calendar", authMiddleware, createGetHealthCalendarHandler(healthCalendarOptions));

  const importChaodaysOptions = {
    userRepository: options.userRepository,
    vitalsRepository: options.vitalsRepository,
    chaodaysClient: options.chaodaysClient,
  };
  app.post("/api/import/chaodays/weight", authMiddleware, createImportChaodaysWeightHandler(importChaodaysOptions));
  const importChaodaysDietOptions = {
    userRepository: options.userRepository,
    mealRepository: options.mealRepository,
    vitalsRepository: options.vitalsRepository,
    chaodaysClient: options.chaodaysClient,
  };
  app.post("/api/import/chaodays/diet", authMiddleware, createImportChaodaysDietHandler(importChaodaysDietOptions));
  const importChaodaysWaterOptions = {
    userRepository: options.userRepository,
    waterRepository: options.waterRepository,
    chaodaysClient: options.chaodaysClient,
  };
  app.post("/api/import/chaodays/water", authMiddleware, createImportChaodaysWaterHandler(importChaodaysWaterOptions));
  const importChaodaysBowelOptions = {
    userRepository: options.userRepository,
    bowelRepository: options.bowelRepository,
    chaodaysClient: options.chaodaysClient,
  };
  app.post("/api/import/chaodays/bowel", authMiddleware, createImportChaodaysBowelHandler(importChaodaysBowelOptions));
  const importChaodaysDietTargetOptions = {
    userRepository: options.userRepository,
    dailyTargetRepository: options.dailyTargetRepository,
    waterRepository: options.waterRepository,
    chaodaysClient: options.chaodaysClient,
  };
  app.post(
    "/api/import/chaodays/diet-target",
    authMiddleware,
    createImportChaodaysDietTargetHandler(importChaodaysDietTargetOptions),
  );
  const importChaodaysMenstrualOptions = {
    userRepository: options.userRepository,
    menstrualRepository: options.menstrualRepository,
    chaodaysClient: options.chaodaysClient,
  };
  app.post(
    "/api/import/chaodays/menstrual",
    authMiddleware,
    createImportChaodaysMenstrualHandler(importChaodaysMenstrualOptions),
  );

  const pushOptions = {
    userRepository: options.userRepository,
    pushSubscriptionRepository: options.pushSubscriptionRepository,
    pushSender: options.pushSender,
    vapidPublicKey: options.vapidPublicKey,
    careDayInstanceManager: options.careDayInstanceManager,
  };
  app.get("/api/push/vapid-public-key", authMiddleware, createGetVapidPublicKeyHandler(pushOptions));
  app.post("/api/push/subscribe", authMiddleware, createSubscribeWebPushHandler(pushOptions));
  app.delete("/api/push/subscribe", authMiddleware, createUnsubscribeWebPushHandler(pushOptions));
  app.post("/api/push/test", authMiddleware, createTestPushHandler(pushOptions));

  app.put(
    "/api/user/timezone",
    authMiddleware,
    createSetUserTimezoneHandler({ userRepository: options.userRepository, careDayInstanceManager: options.careDayInstanceManager }),
  );

  // The assistant (ai-assistant): reads finance and split records through the
  // same use cases as everything else, under the caller's identity, and its
  // only write is a proposal the caller must accept through an ordinary request.
  app.post(
    "/api/assistant",
    authMiddleware,
    createAssistantHandler({
      userRepository: options.userRepository,
      financeTransactionRepository: options.financeTransactionRepository,
      financeCategoryRepository: options.financeCategoryRepository,
      financeBudgetRepository: options.financeBudgetRepository,
      balanceRepository: options.splitBalanceRepository,
      modelClient: options.modelClient,
    }),
  );

  const careOptions = {
    userRepository: options.userRepository,
    careItemRepository: options.careItemRepository,
    careLogRepository: options.careLogRepository,
    careDayInstanceManager: options.careDayInstanceManager,
  };
  app.post("/api/care/items", authMiddleware, createCreateCareItemHandler(careOptions));
  app.get("/api/care/items", authMiddleware, createListCareItemsHandler(careOptions));
  app.patch("/api/care/items/:id", authMiddleware, createUpdateCareItemHandler(careOptions));
  app.delete("/api/care/items/:id", authMiddleware, createDeleteCareItemHandler(careOptions));
  app.post("/api/care/log", authMiddleware, createAnswerCareSlotHandler(careOptions));
  app.put("/api/care/log", authMiddleware, createEditCareSlotHandler(careOptions));
  app.get("/api/care/today", authMiddleware, createGetCareTodayHandler(careOptions));
  app.get("/api/care/range", authMiddleware, createGetCareRangeHandler(careOptions));

  const financeOptions = {
    userRepository: options.userRepository,
    financeCategoryRepository: options.financeCategoryRepository,
    financeTransactionRepository: options.financeTransactionRepository,
    financeBudgetRepository: options.financeBudgetRepository,
    financeNetWorthRepository: options.financeNetWorthRepository,
    installmentPlanRepository: options.installmentPlanRepository,
    budgetAlertNotifier: options.budgetAlertNotifier,
    splitSpendingRepository: options.splitSpendingRepository,
  };
  app.get("/api/finance/transactions", authMiddleware, createListTransactionsHandler(financeOptions));
  app.post("/api/finance/transactions", authMiddleware, createCreateTransactionHandler(financeOptions));
  app.put("/api/finance/transactions/:id", authMiddleware, createUpdateTransactionHandler(financeOptions));
  app.delete("/api/finance/transactions/:id", authMiddleware, createDeleteTransactionHandler(financeOptions));
  app.post("/api/finance/installment-plans", authMiddleware, createCreateInstallmentPlanHandler(financeOptions));
  app.get("/api/finance/installment-plans/:id", authMiddleware, createGetInstallmentPlanHandler(financeOptions));
  app.put("/api/finance/installment-plans/:id", authMiddleware, createUpdateInstallmentPlanHandler(financeOptions));
  app.post("/api/finance/installment-plans/:id/settle", authMiddleware, createSettleInstallmentPlanHandler(financeOptions));
  app.get("/api/finance/categories", authMiddleware, createListCategoriesHandler(financeOptions));
  app.post("/api/finance/categories", authMiddleware, createCreateCategoryHandler(financeOptions));
  app.put("/api/finance/categories/:id", authMiddleware, createUpdateCategoryHandler(financeOptions));
  app.get("/api/finance/summary", authMiddleware, createGetSummaryHandler(financeOptions));
  app.get("/api/finance/split-spending", authMiddleware, createGetSplitSpendingHandler(financeOptions));
  app.get("/api/finance/budgets", authMiddleware, createGetBudgetsHandler(financeOptions));
  app.put("/api/finance/budgets", authMiddleware, createUpsertBudgetHandler(financeOptions));
  app.delete("/api/finance/budgets/:id", authMiddleware, createDeleteBudgetHandler(financeOptions));

  app.get("/api/finance/networth/accounts", authMiddleware, createListNetWorthAccountsHandler(financeOptions));
  app.post("/api/finance/networth/accounts", authMiddleware, createCreateNetWorthAccountHandler(financeOptions));
  // Must be registered before PUT /accounts/:id, or "order" matches that route as id="order".
  app.put("/api/finance/networth/accounts/order", authMiddleware, createReorderNetWorthAccountsHandler(financeOptions));
  app.put("/api/finance/networth/accounts/:id", authMiddleware, createUpdateNetWorthAccountHandler(financeOptions));
  app.put("/api/finance/networth/snapshots", authMiddleware, createUpsertNetWorthSnapshotHandler(financeOptions));
  app.get("/api/finance/networth/trend", authMiddleware, createGetNetWorthTrendHandler(financeOptions));
  app.get("/api/finance/networth", authMiddleware, createGetNetWorthHandler(financeOptions));

  // Friends: the first data any user can see about another (add-friends).
  // The invite routes are registered before `/api/friends/:friendUserId` so
  // "invites" is never taken for a user id.
  const friendsOptions = {
    userRepository: options.userRepository,
    friendshipRepository: options.friendshipRepository,
    friendInviteRepository: options.friendInviteRepository,
  };
  app.post("/api/friends/invites/preview", authMiddleware, createPreviewInviteHandler(friendsOptions));
  app.post("/api/friends/invites/accept", authMiddleware, createAcceptInviteHandler(friendsOptions));
  app.get("/api/friends/invites", authMiddleware, createListMyInvitesHandler(friendsOptions));
  app.post("/api/friends/invites", authMiddleware, createCreateInviteHandler(friendsOptions));
  app.delete("/api/friends/invites/:id", authMiddleware, createRevokeInviteHandler(friendsOptions));
  app.get("/api/friends", authMiddleware, createListFriendsHandler(friendsOptions));
  app.delete("/api/friends/:friendUserId", authMiddleware, createRemoveFriendHandler(friendsOptions));

  // Split bills (add-split-bills): the first feature that writes directly
  // into another user's balance. `/api/split/groups/:id/members` and
  // `/api/split/groups/:id/balances` are registered before the plain
  // `/api/split/groups/:id`, mirroring the friends routes' precedent, so a
  // sub-path segment is never mistaken for the `:id` param.
  // Composed here rather than injected as an option (design.md D2): every
  // `createApp` caller — including `finance.test.ts` — then gets the real
  // category resolution instead of a fake that would agree with itself.
  // budget alert gating (add-installments design.md D4b) is enabled by passing
  // now/getUserTimezone so split mirrors are subject to the same D4b month gate
  // as direct expense transactions.
  const sharesMirror = new FinanceSharesMirror({
    categories: options.financeCategoryRepository,
    budgets: options.financeBudgetRepository,
    notifier: options.budgetAlertNotifier,
    now: () => new Date(),
    getUserTimezone: async (userId: string) => (await options.userRepository.getById(userId))?.timezone ?? "Asia/Taipei",
  });
  const splitOptions = {
    userRepository: options.userRepository,
    sharesMirror,
    expenseGroupRepository: options.expenseGroupRepository,
    splitExpenseRepository: options.splitExpenseRepository,
    balanceRepository: options.splitBalanceRepository,
    friendChecker: options.splitFriendChecker,
    settlementRepository: options.splitSettlementRepository,
    splitActivityRepository: options.splitActivityRepository,
  };
  app.get("/api/split/groups", authMiddleware, createListMyGroupsHandler(splitOptions));
  app.post("/api/split/groups", authMiddleware, createCreateGroupHandler(splitOptions));
  app.post("/api/split/groups/:id/members", authMiddleware, createAddGroupMemberHandler(splitOptions));
  app.get("/api/split/groups/:id/balances", authMiddleware, createGetGroupBalancesHandler(splitOptions));
  app.get("/api/split/groups/:id", authMiddleware, createGetGroupHandler(splitOptions));
  app.delete("/api/split/groups/:id", authMiddleware, createArchiveGroupHandler(splitOptions));

  app.get("/api/split/expenses", authMiddleware, createListExpensesHandler(splitOptions));
  app.post("/api/split/expenses", authMiddleware, createCreateExpenseHandler(splitOptions));
  app.get("/api/split/expenses/:id", authMiddleware, createGetExpenseHandler(splitOptions));
  app.patch("/api/split/expenses/:id", authMiddleware, createUpdateExpenseHandler(splitOptions));
  app.delete("/api/split/expenses/:id", authMiddleware, createDeleteExpenseHandler(splitOptions));

  app.get("/api/split/balances", authMiddleware, createGetBalancesHandler(splitOptions));
  // "/api/split/activity" shares no parameterized prefix with the routes
  // above, so ordering does not matter here.
  app.get("/api/split/activity", authMiddleware, createListActivityHandler(splitOptions));

  // Settlements (add-settle-up): "/api/split/settlements" does not share a
  // parameterized prefix with "/api/split/expenses/:id", so there is no
  // ordering conflict of the kind the groups routes above guard against.
  app.get("/api/split/settlements", authMiddleware, createListSettlementsHandler(splitOptions));
  app.post("/api/split/settlements", authMiddleware, createCreateSettlementHandler(splitOptions));
  app.delete("/api/split/settlements/:id", authMiddleware, createDeleteSettlementHandler(splitOptions));

  return app;
}
