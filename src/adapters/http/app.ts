import { Hono } from "hono";
import { cors } from "hono/cors";
import type { JWTVerifyGetKey } from "jose";
import type { DailyTargetRepository } from "../../contexts/health/domain/daily-target-repository";
import type { DietLogRepository } from "../../contexts/health/domain/diet-log-repository";
import type { FoodDictionaryRepository } from "../../contexts/health/domain/food-dictionary-repository";
import type { UserRepository } from "../../contexts/user/domain/user-repository";
import { createAuthMiddleware, type AuthVariables } from "./middleware/auth";
import {
  createGetDailyTargetHandler,
  createSetDailyTargetHandler,
} from "./routes/daily-target";
import {
  createDeleteFoodEntryHandler,
  createGetDayDietLogHandler,
  createLogFoodEntryHandler,
} from "./routes/diet-entries";
import {
  createCustomFoodItemHandler,
  createFavoriteFoodItemHandler,
  createListFavoriteFoodItemsHandler,
  createSearchFoodDictionaryHandler,
  createUnfavoriteFoodItemHandler,
} from "./routes/food-dictionary";
import { createHealthHandler } from "./routes/health";
import { createMeHandler } from "./routes/me";

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
  dietLogRepository: DietLogRepository;
  dailyTargetRepository: DailyTargetRepository;
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
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
    }),
  );

  app.onError((err, c) => {
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

  const dietEntryOptions = {
    userRepository: options.userRepository,
    dietLogRepository: options.dietLogRepository,
    foodDictionaryRepository: options.foodDictionaryRepository,
  };
  app.post("/api/diet-entries", authMiddleware, createLogFoodEntryHandler(dietEntryOptions));
  app.get("/api/diet-entries", authMiddleware, createGetDayDietLogHandler(dietEntryOptions));
  app.delete("/api/diet-entries/:id", authMiddleware, createDeleteFoodEntryHandler(dietEntryOptions));

  const dailyTargetOptions = {
    userRepository: options.userRepository,
    dailyTargetRepository: options.dailyTargetRepository,
    dietLogRepository: options.dietLogRepository,
  };
  app.get("/api/daily-target", authMiddleware, createGetDailyTargetHandler(dailyTargetOptions));
  app.put("/api/daily-target", authMiddleware, createSetDailyTargetHandler(dailyTargetOptions));

  return app;
}
