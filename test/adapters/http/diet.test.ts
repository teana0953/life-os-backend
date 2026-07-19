import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { DailyTarget } from "../../../src/contexts/health/domain/daily-target";
import type { DailyTargetRepository, SetDailyTargetInput } from "../../../src/contexts/health/domain/daily-target-repository";
import { portionsToNutrients } from "../../../src/contexts/health/domain/conversion";
import type {
  CreateFoodEntryInput,
  DietLogRepository,
  UpdateFoodEntryPatch,
} from "../../../src/contexts/health/domain/diet-log-repository";
import type {
  CreateCustomFoodItemInput,
  FoodDictionaryRepository,
} from "../../../src/contexts/health/domain/food-dictionary-repository";
import type { FoodEntry } from "../../../src/contexts/health/domain/food-entry";
import type { FoodItem } from "../../../src/contexts/health/domain/food-item";
import type { User } from "../../../src/contexts/user/domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../../../src/contexts/user/domain/user-repository";

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

class InMemoryFoodDictionaryRepository implements FoodDictionaryRepository {
  items: FoodItem[] = [];
  private nextId = 1;

  seed(item: Omit<FoodItem, "id" | "createdAt">): FoodItem {
    const created: FoodItem = { id: `item-${this.nextId++}`, createdAt: new Date(), ...item };
    this.items.push(created);
    return created;
  }

  async search(userId: string, query: string): Promise<FoodItem[]> {
    const needle = query.toLowerCase();
    return this.items.filter(
      (item) => (item.ownerUserId === null || item.ownerUserId === userId) && item.name.toLowerCase().includes(needle),
    );
  }

  async findById(userId: string, id: string): Promise<FoodItem | null> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return null;
    return item.ownerUserId === null || item.ownerUserId === userId ? item : null;
  }

  async createCustom(input: CreateCustomFoodItemInput): Promise<FoodItem> {
    return this.seed({ ...input, baseGrams: null });
  }

  async favorite(): Promise<void> {}
  async unfavorite(): Promise<void> {}
  async listFavorites(): Promise<FoodItem[]> {
    return [];
  }
}

class InMemoryDietLogRepository implements DietLogRepository {
  entries: FoodEntry[] = [];
  private nextId = 1;

  async create(input: CreateFoodEntryInput): Promise<FoodEntry> {
    const entry: FoodEntry = { id: `entry-${this.nextId++}`, loggedAt: new Date(), ...input };
    this.entries.push(entry);
    return entry;
  }

  async listByDay(userId: string, day: string): Promise<FoodEntry[]> {
    return this.entries.filter((e) => e.userId === userId && e.day === day);
  }

  async delete(userId: string, entryId: string): Promise<boolean> {
    const idx = this.entries.findIndex((e) => e.userId === userId && e.id === entryId);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  async update(userId: string, entryId: string, patch: UpdateFoodEntryPatch): Promise<FoodEntry | null> {
    const entry = this.entries.find((e) => e.userId === userId && e.id === entryId);
    if (!entry) return null;

    if (patch.name !== undefined) entry.name = patch.name;
    if (patch.meal !== undefined) entry.meal = patch.meal;
    if (patch.eatenAt !== undefined) {
      entry.eatenAt = patch.eatenAt;
      entry.day = patch.eatenAt.toISOString().slice(0, 10);
    }
    if (patch.portions !== undefined) {
      const nutrients = portionsToNutrients(patch.portions);
      entry.unclassified = false;
      Object.assign(entry, nutrients, patch.portions);
    }
    return entry;
  }

  async listLoggedDays(userId: string, month: string): Promise<string[]> {
    const days = new Set(
      this.entries.filter((e) => e.userId === userId && e.day.startsWith(month)).map((e) => e.day),
    );
    return [...days].sort();
  }
}

class InMemoryDailyTargetRepository implements DailyTargetRepository {
  private targetsByUserDay = new Map<string, DailyTarget>();
  private nextId = 1;

  async get(userId: string, day: string): Promise<DailyTarget | null> {
    return this.targetsByUserDay.get(`${userId}:${day}`) ?? null;
  }

  async getLatestOnOrBefore(userId: string, day: string): Promise<DailyTarget | null> {
    let latest: DailyTarget | null = null;
    for (const target of this.targetsByUserDay.values()) {
      if (target.userId === userId && target.day <= day && (!latest || target.day > latest.day)) {
        latest = target;
      }
    }
    return latest;
  }

  async set(input: SetDailyTargetInput): Promise<DailyTarget> {
    const target: DailyTarget = {
      id: `target-${this.nextId++}`,
      userId: input.userId,
      day: input.day,
      baseStaple: input.baseStaple,
      baseMeat: input.baseMeat,
      baseFruit: input.baseFruit,
      baseVeg: input.baseVeg,
      bonusStaple: input.bonusStaple ?? 0,
      bonusMeat: input.bonusMeat ?? 0,
      bonusFruit: input.bonusFruit ?? 0,
      bonusVeg: input.bonusVeg ?? 0,
    };
    this.targetsByUserDay.set(`${input.userId}:${input.day}`, target);
    return target;
  }
}

function buildApp() {
  const foodDictionaryRepository = new InMemoryFoodDictionaryRepository();
  const dietLogRepository = new InMemoryDietLogRepository();
  const dailyTargetRepository = new InMemoryDailyTargetRepository();
  const app = createApp({
    projectId: PROJECT_ID,
    jwks,
    userRepository: new InMemoryUserRepository(),
    foodDictionaryRepository,
    dietLogRepository,
    dailyTargetRepository,
    ping: async () => {},
  });
  return { app, foodDictionaryRepository, dietLogRepository, dailyTargetRepository };
}

describe("diet-tracking HTTP routes", () => {
  it("requires auth for the dictionary search route", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/food-items?q=banana");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("requires auth for logging a diet entry", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/diet-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", portions: { staple: 1 } }),
    });

    expect(res.status).toBe(401);
  });

  it("requires auth for the daily target route", async () => {
    const { app } = buildApp();

    const res = await app.request("/api/daily-target?day=2026-07-18");

    expect(res.status).toBe(401);
  });

  it("creates a diet entry from a dictionary item, persisted with source dict", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const banana = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "香蕉/1根",
      carbG: 30,
      proteinG: 0,
      fatG: 0,
      sugarG: 30,
      fiberG: 0,
      kcal: 120,
      staple: 0,
      meat: 0,
      fruit: 2,
      veg: 0,
      baseGrams: null,
    });
    const token = await validToken();

    const res = await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", food_item_id: banana.id }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { source: string; fruit: number; carb_g: number };
    expect(body.source).toBe("dict");
    expect(body.fruit).toBe(2);
    expect(body.carb_g).toBe(30);
  });

  it("scales a dictionary log by quantity (1.5x -> 6 staple, 90 g carbohydrate)", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const riceBowl = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "飯/1碗",
      carbG: 60,
      proteinG: 0,
      fatG: 0,
      sugarG: 0,
      fiberG: 0,
      kcal: 240,
      staple: 4,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseGrams: null,
    });
    const token = await validToken();

    const res = await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", food_item_id: riceBowl.id, quantity: 1.5 }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { staple: number; carb_g: number };
    expect(body.staple).toBe(6);
    expect(body.carb_g).toBe(90);
  });

  it("converts a gram-based dictionary log to a quantity via base_grams", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const riceGram = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "飯/50g",
      carbG: 15,
      proteinG: 0,
      fatG: 0,
      sugarG: 0,
      fiberG: 0,
      kcal: 60,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseGrams: 50,
    });
    const token = await validToken();

    const res = await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", food_item_id: riceGram.id, grams: 33 }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { staple: number };
    expect(body.staple).toBeCloseTo(0.66);
  });

  it("rejects a gram-based dictionary log when the item has no base_grams, as 400", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const riceBowl = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "飯/1碗",
      carbG: 60,
      proteinG: 0,
      fatG: 0,
      sugarG: 0,
      fiberG: 0,
      kcal: 240,
      staple: 4,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseGrams: null,
    });
    const token = await validToken();

    const res = await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", food_item_id: riceBowl.id, grams: 33 }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a dictionary log supplying both grams and quantity, as 400", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    const riceBowl = foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "飯/1碗",
      carbG: 60,
      proteinG: 0,
      fatG: 0,
      sugarG: 0,
      fiberG: 0,
      kcal: 240,
      staple: 4,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseGrams: 50,
    });
    const token = await validToken();

    const res = await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", food_item_id: riceBowl.id, grams: 33, quantity: 1.5 }),
    });

    expect(res.status).toBe(400);
  });

  it("includes base_grams in a dictionary item's JSON response", async () => {
    const { app, foodDictionaryRepository } = buildApp();
    foodDictionaryRepository.seed({
      ownerUserId: null,
      name: "飯/50g",
      carbG: 15,
      proteinG: 0,
      fatG: 0,
      sugarG: 0,
      fiberG: 0,
      kcal: 60,
      staple: 1,
      meat: 0,
      fruit: 0,
      veg: 0,
      baseGrams: 50,
    });
    const token = await validToken();

    const res = await app.request("/api/food-items?q=%E9%A3%AF", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { base_grams: number | null }[];
    expect(body[0]?.base_grams).toBe(50);
  });

  it("orders a day's entries by eaten_at: a back-dated breakfast sorts before an earlier-logged dinner", async () => {
    const { app } = buildApp();
    const token = await validToken();

    await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        day: "2026-07-18",
        meal: "dinner",
        portions: { staple: 1, meat: 0, fruit: 0, veg: 0 },
        eaten_at: "2026-07-18T19:00:00.000Z",
      }),
    });
    await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        day: "2026-07-18",
        meal: "breakfast",
        portions: { staple: 1, meat: 0, fruit: 0, veg: 0 },
        eaten_at: "2026-07-18T08:00:00.000Z",
      }),
    });

    const res = await app.request("/api/diet-entries?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { meals: { meal: string }[] };
    expect(body.meals.map((m) => m.meal)).toEqual(["breakfast", "dinner"]);
  });

  it("returns a day's diet log grouped by meal", async () => {
    const { app } = buildApp();
    const token = await validToken();

    await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }),
    });
    await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "lunch", portions: { staple: 2, meat: 0, fruit: 0, veg: 0 } }),
    });

    const res = await app.request("/api/diet-entries?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { meals: { meal: string; entries: unknown[] }[] };
    expect(body.meals.map((m) => m.meal)).toEqual(["breakfast", "lunch"]);
  });

  it("reflects logged entries in the daily target's remaining view", async () => {
    const { app } = buildApp();
    const token = await validToken();

    await app.request("/api/daily-target", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", base_staple: 12, base_meat: 7, base_fruit: 2, base_veg: 2 }),
    });
    await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", portions: { staple: 9, meat: 0, fruit: 0, veg: 0 } }),
    });

    const res = await app.request("/api/daily-target?day=2026-07-18", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { remaining: { staple: number } };
    expect(body.remaining.staple).toBe(3);
  });

  it("rejects a custom food item with a missing name as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/food-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ carb_g: 15, protein_g: 0, fat_g: 0, sugar_g: 0, fiber_g: 0, kcal: 60 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_request" });
  });

  it("rejects a custom food item with a non-numeric nutrient as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/food-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", carb_g: "abc", protein_g: 0, fat_g: 0, sugar_g: 0, fiber_g: 0, kcal: 60 }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a diet entry with a missing day as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ meal: "breakfast", portions: { staple: 1 } }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a diet entry with a non-numeric portion as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", portions: { staple: "lots" } }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a day diet log request without a day as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/diet-entries", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(400);
  });

  it("rejects a daily target request without a day as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/daily-target", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(400);
  });

  it("rejects setting a daily target with a non-numeric base goal as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/daily-target", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-07-18", base_staple: "abc", base_meat: 7, base_fruit: 2, base_veg: 2 }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects a diet entry with an invalid calendar day as 400", async () => {
    const { app } = buildApp();
    const token = await validToken();

    const res = await app.request("/api/diet-entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-02-30", meal: "breakfast", portions: { staple: 1 } }),
    });

    expect(res.status).toBe(400);
  });

  describe("GET /api/diet-entries/logged-days", () => {
    it("requires auth", async () => {
      const { app } = buildApp();

      const res = await app.request("/api/diet-entries/logged-days?month=2026-07");

      expect(res.status).toBe(401);
    });

    it("returns the distinct logged days in the requested month, ascending, not a single-entry shape", async () => {
      const { app } = buildApp();
      const token = await validToken();
      await app.request("/api/diet-entries", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-04", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }),
      });
      await app.request("/api/diet-entries", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-01", meal: "breakfast", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }),
      });

      const res = await app.request("/api/diet-entries/logged-days?month=2026-07", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { days: string[] };
      expect(body).toEqual({ days: ["2026-07-01", "2026-07-04"] });
      // Confirms the static "logged-days" segment isn't captured by the ":id" param route
      // (which would instead 404/entry-not-found on this path).
      expect(body).not.toHaveProperty("error");
    });

    it("rejects a missing month as 400", async () => {
      const { app } = buildApp();
      const token = await validToken();

      const res = await app.request("/api/diet-entries/logged-days", { headers: { Authorization: `Bearer ${token}` } });

      expect(res.status).toBe(400);
    });

    it("rejects a malformed month as 400", async () => {
      const { app } = buildApp();
      const token = await validToken();

      const res = await app.request("/api/diet-entries/logged-days?month=2026-13", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/diet-entries/:id", () => {
    it("requires auth", async () => {
      const { app } = buildApp();

      const res = await app.request("/api/diet-entries/entry-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meal: "lunch" }),
      });

      expect(res.status).toBe(401);
    });

    it("updating portions recomputes nutrients and clears unclassified", async () => {
      const { app } = buildApp();
      const token = await validToken();
      const created = await app.request("/api/diet-entries", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "snack", nutrients: { carb_g: 5, protein_g: 0, fat_g: 0, sugar_g: 0, fiber_g: 0, kcal: 20 } }),
      });
      const { id } = (await created.json()) as { id: string };

      const res = await app.request(`/api/diet-entries/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ portions: { staple: 2 } }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { staple: number; carb_g: number; unclassified: boolean };
      expect(body.staple).toBe(2);
      expect(body.carb_g).toBe(30);
      expect(body.unclassified).toBe(false);
    });

    it("updating only meal leaves other fields unchanged", async () => {
      const { app } = buildApp();
      const token = await validToken();
      const created = await app.request("/api/diet-entries", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", name: "oatmeal", portions: { staple: 1, meat: 0, fruit: 0, veg: 0 } }),
      });
      const original = (await created.json()) as { id: string; carb_g: number; eaten_at: string };

      const res = await app.request(`/api/diet-entries/${original.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ meal: "lunch" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { meal: string; name: string; carb_g: number; eaten_at: string };
      expect(body.meal).toBe("lunch");
      expect(body.name).toBe("oatmeal");
      expect(body.carb_g).toBe(original.carb_g);
      expect(body.eaten_at).toBe(original.eaten_at);
    });

    it("updating eaten_at to another calendar date moves the entry's day", async () => {
      const { app } = buildApp();
      const token = await validToken();
      const created = await app.request("/api/diet-entries", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          day: "2026-07-18",
          meal: "dinner",
          portions: { staple: 1, meat: 0, fruit: 0, veg: 0 },
          eaten_at: "2026-07-18T23:00:00.000Z",
        }),
      });
      const { id } = (await created.json()) as { id: string };

      const res = await app.request(`/api/diet-entries/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ eaten_at: "2026-07-19T01:00:00.000Z" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { day: string; eaten_at: string };
      expect(body.day).toBe("2026-07-19");
      expect(body.eaten_at).toBe("2026-07-19T01:00:00.000Z");
    });

    it("rejects an empty patch as 400", async () => {
      const { app } = buildApp();
      const token = await validToken();
      const created = await app.request("/api/diet-entries", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", portions: { staple: 1 } }),
      });
      const { id } = (await created.json()) as { id: string };

      const res = await app.request(`/api/diet-entries/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 for another user's entry", async () => {
      const { app } = buildApp();
      const token = await validToken("uid-1");
      const created = await app.request("/api/diet-entries", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ day: "2026-07-18", meal: "breakfast", portions: { staple: 1 } }),
      });
      const { id } = (await created.json()) as { id: string };
      const otherToken = await validToken("uid-2");

      const res = await app.request(`/api/diet-entries/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ meal: "lunch" }),
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });

    it("returns 404 for a missing entry", async () => {
      const { app } = buildApp();
      const token = await validToken();

      const res = await app.request("/api/diet-entries/does-not-exist", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ meal: "lunch" }),
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });
  });
});
