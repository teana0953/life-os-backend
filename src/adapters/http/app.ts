import { Hono } from "hono";
import { cors } from "hono/cors";
import type { JWTVerifyGetKey } from "jose";
import type { BowelRepository } from "../../contexts/health/domain/bowel-repository";
import type { DailyTargetRepository } from "../../contexts/health/domain/daily-target-repository";
import type { FoodDictionaryRepository } from "../../contexts/health/domain/food-dictionary-repository";
import type { MealRepository } from "../../contexts/health/domain/meal-repository";
import type { VitalsRepository } from "../../contexts/health/domain/vitals-repository";
import type { WaterRepository } from "../../contexts/health/domain/water-repository";
import type { UserRepository } from "../../contexts/user/domain/user-repository";
import { createAuthMiddleware, type AuthVariables } from "./middleware/auth";
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
import { createGetVitalsHandler, createSetVitalsHandler } from "./routes/vitals";
import { createHealthHandler } from "./routes/health";
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
  app.get("/api/vitals", authMiddleware, createGetVitalsHandler(vitalsOptions));
  app.put("/api/vitals", authMiddleware, createSetVitalsHandler(vitalsOptions));

  return app;
}
