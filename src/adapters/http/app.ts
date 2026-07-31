import { Hono } from "hono";
import { cors } from "hono/cors";
import type { JWTVerifyGetKey } from "jose";
import type { BudgetAlertNotifier } from "../../contexts/finance/domain/budget-alert-notifier";
import type { FinanceBudgetRepository } from "../../contexts/finance/domain/finance-budget-repository";
import type { FinanceCategoryRepository } from "../../contexts/finance/domain/finance-category-repository";
import type { FinanceTransactionRepository } from "../../contexts/finance/domain/finance-transaction-repository";
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
import type { PushSender } from "../../contexts/notifications/domain/push-sender";
import type { PushSubscriptionRepository } from "../../contexts/notifications/domain/push-subscription";
import type { CareItemRepository } from "../../contexts/notifications/domain/care-item";
import type { CareLogRepository } from "../../contexts/notifications/domain/care-log";
import type { UserRepository } from "../../contexts/user/domain/user-repository";
import { createAuthMiddleware, type AuthVariables } from "./middleware/auth";
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
import { createMeHandler } from "./routes/me";
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
  createCreateNetWorthAccountHandler,
  createCreateTransactionHandler,
  createDeleteBudgetHandler,
  createDeleteTransactionHandler,
  createGetBudgetsHandler,
  createGetNetWorthHandler,
  createGetNetWorthTrendHandler,
  createGetSummaryHandler,
  createListCategoriesHandler,
  createListNetWorthAccountsHandler,
  createListTransactionsHandler,
  createUpdateCategoryHandler,
  createUpdateNetWorthAccountHandler,
  createUpdateTransactionHandler,
  createUpsertBudgetHandler,
  createUpsertNetWorthSnapshotHandler,
} from "./routes/finance";
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
  financeCategoryRepository: FinanceCategoryRepository;
  financeTransactionRepository: FinanceTransactionRepository;
  financeBudgetRepository: FinanceBudgetRepository;
  financeNetWorthRepository: NetWorthRepository;
  budgetAlertNotifier: BudgetAlertNotifier;
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
      allowHeaders: ["Authorization", "Content-Type"],
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
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  app.get("/health", createHealthHandler({ ping: options.ping }));

  const authMiddleware = createAuthMiddleware({ projectId: options.projectId, jwks: options.jwks });
  app.get("/api/me", authMiddleware, createMeHandler({ userRepository: options.userRepository }));

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
  };
  app.get("/api/push/vapid-public-key", authMiddleware, createGetVapidPublicKeyHandler(pushOptions));
  app.post("/api/push/subscribe", authMiddleware, createSubscribeWebPushHandler(pushOptions));
  app.delete("/api/push/subscribe", authMiddleware, createUnsubscribeWebPushHandler(pushOptions));
  app.post("/api/push/test", authMiddleware, createTestPushHandler(pushOptions));

  app.put("/api/user/timezone", authMiddleware, createSetUserTimezoneHandler({ userRepository: options.userRepository }));

  const careOptions = {
    userRepository: options.userRepository,
    careItemRepository: options.careItemRepository,
    careLogRepository: options.careLogRepository,
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
    budgetAlertNotifier: options.budgetAlertNotifier,
  };
  app.get("/api/finance/transactions", authMiddleware, createListTransactionsHandler(financeOptions));
  app.post("/api/finance/transactions", authMiddleware, createCreateTransactionHandler(financeOptions));
  app.put("/api/finance/transactions/:id", authMiddleware, createUpdateTransactionHandler(financeOptions));
  app.delete("/api/finance/transactions/:id", authMiddleware, createDeleteTransactionHandler(financeOptions));
  app.get("/api/finance/categories", authMiddleware, createListCategoriesHandler(financeOptions));
  app.post("/api/finance/categories", authMiddleware, createCreateCategoryHandler(financeOptions));
  app.put("/api/finance/categories/:id", authMiddleware, createUpdateCategoryHandler(financeOptions));
  app.get("/api/finance/summary", authMiddleware, createGetSummaryHandler(financeOptions));
  app.get("/api/finance/budgets", authMiddleware, createGetBudgetsHandler(financeOptions));
  app.put("/api/finance/budgets", authMiddleware, createUpsertBudgetHandler(financeOptions));
  app.delete("/api/finance/budgets/:id", authMiddleware, createDeleteBudgetHandler(financeOptions));

  app.get("/api/finance/networth/accounts", authMiddleware, createListNetWorthAccountsHandler(financeOptions));
  app.post("/api/finance/networth/accounts", authMiddleware, createCreateNetWorthAccountHandler(financeOptions));
  app.put("/api/finance/networth/accounts/:id", authMiddleware, createUpdateNetWorthAccountHandler(financeOptions));
  app.put("/api/finance/networth/snapshots", authMiddleware, createUpsertNetWorthSnapshotHandler(financeOptions));
  app.get("/api/finance/networth/trend", authMiddleware, createGetNetWorthTrendHandler(financeOptions));
  app.get("/api/finance/networth", authMiddleware, createGetNetWorthHandler(financeOptions));

  return app;
}
