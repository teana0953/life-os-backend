import { sql } from "drizzle-orm";
import { createApp } from "./adapters/http/app";
import { GeminiModelClient } from "./contexts/assistant/adapters/gemini-model-client";
import { DrizzleFinanceBudgetRepository } from "./contexts/finance/adapters/drizzle-finance-budget-repository";
import { DrizzleFinanceCategoryRepository } from "./contexts/finance/adapters/drizzle-finance-category-repository";
import { DrizzleFinanceTransactionRepository } from "./contexts/finance/adapters/drizzle-finance-transaction-repository";
import { DrizzleInstallmentPlanRepository } from "./contexts/finance/adapters/drizzle-installment-plan-repository";
import { DrizzleNetWorthRepository } from "./contexts/finance/adapters/drizzle-networth-repository";
import { PushBudgetAlertNotifier } from "./contexts/finance/adapters/push-budget-alert-notifier";
import { DrizzleBodyProfileRepository } from "./contexts/health/adapters/drizzle-body-profile-repository";
import { DrizzleBowelRepository } from "./contexts/health/adapters/drizzle-bowel-repository";
import { DrizzleDailyTargetRepository } from "./contexts/health/adapters/drizzle-daily-target-repository";
import { HttpChaodaysClient } from "./contexts/health/adapters/http-chaodays-client";
import { DrizzleExerciseRepository } from "./contexts/health/adapters/drizzle-exercise-repository";
import { DrizzleHealthCalendarRepository } from "./contexts/health/adapters/drizzle-health-calendar-repository";
import { DrizzleFoodDictionaryRepository } from "./contexts/health/adapters/drizzle-food-dictionary-repository";
import { DrizzleMealRepository } from "./contexts/health/adapters/drizzle-meal-repository";
import { DrizzleMenstrualRepository } from "./contexts/health/adapters/drizzle-menstrual-repository";
import { DrizzleVitalsRepository } from "./contexts/health/adapters/drizzle-vitals-repository";
import { DrizzleWaterRepository } from "./contexts/health/adapters/drizzle-water-repository";
import { runCareTick } from "./contexts/notifications/application/run-care-tick";
import { DrizzlePushSubscriptionRepository } from "./contexts/notifications/adapters/drizzle-push-subscription-repository";
import { DrizzleCareItemRepository } from "./contexts/notifications/adapters/drizzle-care-item-repository";
import { DrizzleCareLogRepository } from "./contexts/notifications/adapters/drizzle-care-log-repository";
import { DrizzleCareOccurrenceRepository } from "./contexts/notifications/adapters/drizzle-care-occurrence-repository";
import { WebPushSender } from "./contexts/notifications/adapters/web-push-sender";
import { DrizzleFriendInviteRepository } from "./contexts/social/adapters/drizzle-friend-invite-repository";
import { DrizzleFriendshipRepository } from "./contexts/social/adapters/drizzle-friendship-repository";
import { DrizzleBalanceRepository } from "./contexts/split/adapters/drizzle-balance-repository";
import { DrizzleExpenseGroupRepository } from "./contexts/split/adapters/drizzle-expense-group-repository";
import { DrizzleFriendChecker } from "./contexts/split/adapters/drizzle-friend-checker";
import { DrizzleSettlementRepository } from "./contexts/split/adapters/drizzle-settlement-repository";
import { DrizzleSplitActivityRepository } from "./contexts/split/adapters/drizzle-split-activity-repository";
import { DrizzleSplitExpenseRepository } from "./contexts/split/adapters/drizzle-split-expense-repository";
import { DrizzleUserRepository } from "./contexts/user/adapters/drizzle-user-repository";
import { createGoogleSecuretokenJwks } from "./shared/auth/firebase-verifier";
import { createDbClient, type Db } from "./shared/db/client";

export interface Env {
  DATABASE_URL: string;
  FIREBASE_PROJECT_ID: string;
  /** Optional deployed web app origin (Cloudflare Pages) to allow via CORS. */
  ALLOWED_WEB_ORIGIN?: string;
  /** Optional Web Push (VAPID) config — unset until a deploy's secrets are provisioned (D6 in design.md). */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

// Module-scope so the fetched JWKS is cached across requests within a worker instance.
const jwks = createGoogleSecuretokenJwks();

/**
 * `DrizzleInstallmentPlanRepository` takes a `Db` directly rather than a
 * `getDb: () => Db` accessor like every other repository here — its
 * constructor is fixed by `test/db/installments.test.ts`, which builds it
 * straight from a PGlite instance. This Proxy gets the same laziness back:
 * `getDb()` (which can throw on a malformed `DATABASE_URL`) only runs on the
 * first property actually touched — i.e. the first real DB call inside a
 * request that hits an installment route — not for every request regardless
 * of which route it hits.
 */
function lazyDb(getDb: () => Db): Db {
  return new Proxy({} as Db, {
    get(_target, prop, receiver) {
      return Reflect.get(getDb() as object, prop, receiver);
    },
  });
}

/**
 * Builds the DB client + every repository/adapter shared by `fetch` and
 * `scheduled`, so the two entry points never drift (D7 in
 * add-medication-reminders/design.md). The DB client is built lazily on first
 * use (memoized per call): `neon()` throws on a malformed `DATABASE_URL`, and
 * deferring construction to inside the Hono handlers keeps that error within
 * the error boundary (→ 503 on `/health`, 500 on DB-backed routes) instead of
 * throwing in the raw `fetch` handler and crashing the Worker (Cloudflare
 * error 1101). Requests that never touch the DB (e.g. an unauthenticated
 * `/api/me`) are unaffected.
 */
function buildDeps(env: Env) {
  let db: Db | undefined;
  const getDb = () => (db ??= createDbClient(env.DATABASE_URL));

  const pushSender = new WebPushSender({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  });
  const chaodaysClient = new HttpChaodaysClient();

  return {
    getDb,
    userRepository: new DrizzleUserRepository(getDb),
    foodDictionaryRepository: new DrizzleFoodDictionaryRepository(getDb),
    mealRepository: new DrizzleMealRepository(getDb),
    dailyTargetRepository: new DrizzleDailyTargetRepository(getDb),
    waterRepository: new DrizzleWaterRepository(getDb),
    bowelRepository: new DrizzleBowelRepository(getDb),
    vitalsRepository: new DrizzleVitalsRepository(getDb),
    exerciseRepository: new DrizzleExerciseRepository(getDb),
    menstrualRepository: new DrizzleMenstrualRepository(getDb),
    bodyProfileRepository: new DrizzleBodyProfileRepository(getDb),
    healthCalendarRepository: new DrizzleHealthCalendarRepository(getDb),
    pushSubscriptionRepository: new DrizzlePushSubscriptionRepository(getDb),
    careItemRepository: new DrizzleCareItemRepository(getDb),
    careLogRepository: new DrizzleCareLogRepository(getDb),
    careOccurrenceRepository: new DrizzleCareOccurrenceRepository(getDb),
    financeCategoryRepository: new DrizzleFinanceCategoryRepository(getDb),
    financeTransactionRepository: new DrizzleFinanceTransactionRepository(getDb),
    financeBudgetRepository: new DrizzleFinanceBudgetRepository(getDb),
    financeNetWorthRepository: new DrizzleNetWorthRepository(getDb),
    installmentPlanRepository: new DrizzleInstallmentPlanRepository(lazyDb(getDb)),
    friendshipRepository: new DrizzleFriendshipRepository(getDb),
    friendInviteRepository: new DrizzleFriendInviteRepository(getDb),
    expenseGroupRepository: new DrizzleExpenseGroupRepository(getDb),
    splitExpenseRepository: new DrizzleSplitExpenseRepository(getDb),
    splitBalanceRepository: new DrizzleBalanceRepository(getDb),
    splitFriendChecker: new DrizzleFriendChecker(getDb),
    splitSettlementRepository: new DrizzleSettlementRepository(getDb),
    splitActivityRepository: new DrizzleSplitActivityRepository(getDb),
    pushSender,
    chaodaysClient,
  };
}

export default {
  fetch(request, env, ctx) {
    const deps = buildDeps(env);

    const app = createApp({
      projectId: env.FIREBASE_PROJECT_ID,
      jwks,
      userRepository: deps.userRepository,
      userDisplayNameRepository: deps.userRepository,
      foodDictionaryRepository: deps.foodDictionaryRepository,
      mealRepository: deps.mealRepository,
      dailyTargetRepository: deps.dailyTargetRepository,
      waterRepository: deps.waterRepository,
      bowelRepository: deps.bowelRepository,
      vitalsRepository: deps.vitalsRepository,
      exerciseRepository: deps.exerciseRepository,
      menstrualRepository: deps.menstrualRepository,
      bodyProfileRepository: deps.bodyProfileRepository,
      healthCalendarRepository: deps.healthCalendarRepository,
      chaodaysClient: deps.chaodaysClient,
      pushSubscriptionRepository: deps.pushSubscriptionRepository,
      pushSender: deps.pushSender,
      careItemRepository: deps.careItemRepository,
      careLogRepository: deps.careLogRepository,
      financeCategoryRepository: deps.financeCategoryRepository,
      financeTransactionRepository: deps.financeTransactionRepository,
      financeBudgetRepository: deps.financeBudgetRepository,
      financeNetWorthRepository: deps.financeNetWorthRepository,
      installmentPlanRepository: deps.installmentPlanRepository,
      budgetAlertNotifier: new PushBudgetAlertNotifier(deps.pushSubscriptionRepository, deps.pushSender),
      friendshipRepository: deps.friendshipRepository,
      friendInviteRepository: deps.friendInviteRepository,
      expenseGroupRepository: deps.expenseGroupRepository,
      splitExpenseRepository: deps.splitExpenseRepository,
      splitBalanceRepository: deps.splitBalanceRepository,
      splitFriendChecker: deps.splitFriendChecker,
      splitSettlementRepository: deps.splitSettlementRepository,
      splitActivityRepository: deps.splitActivityRepository,
      // DrizzleSplitExpenseRepository also implements SplitSpendingRepository
      // (both read split_expense/split_share) — reuse the same instance
      // rather than constructing a second repository for one query.
      splitSpendingRepository: deps.splitExpenseRepository,
      // Stateless: the caller's key arrives per request and is kept nowhere.
      modelClient: new GeminiModelClient(),
      vapidPublicKey: env.VAPID_PUBLIC_KEY ?? "",
      allowedWebOrigin: env.ALLOWED_WEB_ORIGIN,
      ping: async () => {
        await deps.getDb().execute(sql`select 1`);
      },
    });

    return app.fetch(request, env, ctx);
  },

  scheduled(_event, env, ctx) {
    const deps = buildDeps(env);
    ctx.waitUntil(
      runCareTick(new Date(), {
        careItemRepo: deps.careItemRepository,
        careLogRepo: deps.careLogRepository,
        careOccurrenceRepo: deps.careOccurrenceRepository,
        subscriptionRepo: deps.pushSubscriptionRepository,
        pushSender: deps.pushSender,
      }),
    );
  },
} satisfies ExportedHandler<Env>;
