import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JSONWebKeySet, JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { DailyTarget } from "../../../src/contexts/health/domain/daily-target";
import type { DailyTargetRepository, SetDailyTargetInput } from "../../../src/contexts/health/domain/daily-target-repository";
import type { CreateFoodEntryInput, DietLogRepository } from "../../../src/contexts/health/domain/diet-log-repository";
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

  async findById(id: string): Promise<FoodItem | null> {
    return this.items.find((i) => i.id === id) ?? null;
  }

  async createCustom(input: CreateCustomFoodItemInput): Promise<FoodItem> {
    return this.seed({ ...input });
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
}

class InMemoryDailyTargetRepository implements DailyTargetRepository {
  private targetsByUserDay = new Map<string, DailyTarget>();
  private nextId = 1;

  async get(userId: string, day: string): Promise<DailyTarget | null> {
    return this.targetsByUserDay.get(`${userId}:${day}`) ?? null;
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
});
