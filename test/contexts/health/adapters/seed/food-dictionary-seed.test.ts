import { describe, expect, it } from "vitest";
import type { Db } from "../../../../../src/shared/db/client";
import { FOOD_SEED_ROWS } from "../../../../../src/contexts/health/adapters/seed/food-dictionary-seed-data";
import { seedFoodDictionary, seedRowToFoodItem } from "../../../../../src/contexts/health/adapters/seed/food-dictionary-seed";
import type { FoodSeedRow } from "../../../../../src/contexts/health/adapters/seed/food-dictionary-seed";

describe("seedRowToFoodItem", () => {
  it("converts a 主食 1 份 row to ~15 g carbohydrate, storing both the portion and the derived nutrient", () => {
    const item = seedRowToFoodItem({ id: 1, name: "飯/1碗", staple: 1, meat: 0, fruit: 0, veg: 0 });

    expect(item.staple).toBe(1);
    expect(item.carbG).toBeCloseTo(15);
  });

  it("converts a 肉類 1 份 row to 7 g protein", () => {
    const item = seedRowToFoodItem({ id: 2, name: "熟肉(雞豬牛羊魚)/30g", staple: 0, meat: 1, fruit: 0, veg: 0 });

    expect(item.meat).toBe(1);
    expect(item.proteinG).toBe(7);
  });

  it("derives sugar_g for a fruit row equal to the fruit-derived carbohydrate (subset of carb_g, per D6)", () => {
    const item = seedRowToFoodItem({ id: 3, name: "香蕉/1根", staple: 0, meat: 0, fruit: 2, veg: 0 });

    expect(item.fruit).toBe(2);
    expect(item.carbG).toBe(30);
    expect(item.sugarG).toBe(30);
    // sugar is a subset of carb, so it must not double-count into kcal.
    expect(item.kcal).toBe(item.carbG * 4 + item.proteinG * 4 + item.fatG * 9);
  });

  it("does not derive sugar_g for a non-fruit row", () => {
    const item = seedRowToFoodItem({ id: 4, name: "蔬菜/1份", staple: 0, meat: 0, fruit: 0, veg: 1 });

    expect(item.sugarG).toBe(0);
  });

  it("backfills a gram measure basis from a bare gram unit token in the name", () => {
    const item = seedRowToFoodItem({ id: 5, name: "飯/50g", staple: 1, meat: 0, fruit: 0, veg: 0 });

    expect(item.baseAmount).toBe(50);
    expect(item.measureUnit).toBe("g");
  });

  it("backfills a gram measure basis for a parenthesized gram unit", () => {
    const item = seedRowToFoodItem({ id: 6, name: "熟肉(雞豬牛羊魚)/30g", staple: 0, meat: 1, fruit: 0, veg: 0 });

    expect(item.baseAmount).toBe(30);
    expect(item.measureUnit).toBe("g");
  });

  it("backfills a countable household quantifier basis (碗)", () => {
    const item = seedRowToFoodItem({ id: 7, name: "飯/1碗", staple: 4, meat: 0, fruit: 0, veg: 0 });

    expect(item.baseAmount).toBe(1);
    expect(item.measureUnit).toBe("碗");
  });

  it("backfills other whitelisted household quantifiers verbatim (根, 個, 湯匙)", () => {
    const banana = seedRowToFoodItem({ id: 8, name: "香蕉/1根", staple: 0, meat: 0, fruit: 2, veg: 0 });
    const bun = seedRowToFoodItem({ id: 9, name: "肉包掌心大/1個", staple: 3, meat: 1, fruit: 0, veg: 0 });
    const oats = seedRowToFoodItem({ id: 10, name: "麥片/2湯匙", staple: 1, meat: 0, fruit: 0, veg: 0 });

    expect(banana.baseAmount).toBe(1);
    expect(banana.measureUnit).toBe("根");
    expect(bun.baseAmount).toBe(1);
    expect(bun.measureUnit).toBe("個");
    expect(oats.baseAmount).toBe(2);
    expect(oats.measureUnit).toBe("湯匙");
  });

  it("backfills a gram measure basis from a Chinese 克 gram unit", () => {
    const dumplings = seedRowToFoodItem({ id: 11, name: "雞胸肉水餃/140克", staple: 2, meat: 1.5, fruit: 0, veg: 0 });
    const lotusRoot = seedRowToFoodItem({ id: 12, name: "蓮藕/100克", staple: 1, meat: 0, fruit: 0, veg: 0 });

    expect(dumplings.baseAmount).toBe(140);
    expect(dumplings.measureUnit).toBe("g");
    expect(lotusRoot.baseAmount).toBe(100);
    expect(lotusRoot.measureUnit).toBe("g");
  });

  it("does not mistake a 克 inside a brand name for a gram unit; uses the anchored 杯 quantifier instead", () => {
    const item = seedRowToFoodItem({ id: 13, name: "星巴克拿鐵(大杯)/1杯", staple: 0, meat: 3, fruit: 0, veg: 0 });

    expect(item.baseAmount).toBe(1);
    expect(item.measureUnit).toBe("杯");
  });

  it("backfills a millilitre measure basis from an mL unit token", () => {
    const soymilk = seedRowToFoodItem({ id: 14, name: "無糖豆漿/240mL", staple: 0, meat: 1, fruit: 0, veg: 0 });

    expect(soymilk.baseAmount).toBe(240);
    expect(soymilk.measureUnit).toBe("ml");
  });

  it("backfills a millilitre measure basis from a lowercase ml unit token", () => {
    const beer = seedRowToFoodItem({ id: 15, name: "啤酒/100ml", staple: 1, meat: 0, fruit: 0, veg: 0 });

    expect(beer.baseAmount).toBe(100);
    expect(beer.measureUnit).toBe("ml");
  });

  it("backfills a millilitre measure basis with a space before the unit token", () => {
    const tea = seedRowToFoodItem({ id: 16, name: "muji 草莓紅茶罐裝/ 315ml", staple: 0, meat: 0, fruit: 2, veg: 0 });

    expect(tea.baseAmount).toBe(315);
    expect(tea.measureUnit).toBe("ml");
  });

  it("does not mistake an mL substring inside the name for the unit when the unit token after / is a household count", () => {
    const oatDrink = seedRowToFoodItem({ id: 17, name: "喝的桂格燕麥飲290mL/1瓶", staple: 2, meat: 0, fruit: 0, veg: 0 });
    const granolaDrink = seedRowToFoodItem({ id: 18, name: "顆粒燕麥飲290mL/1瓶", staple: 2, meat: 0, fruit: 0, veg: 0 });
    const soyOatDrink = seedRowToFoodItem({ id: 19, name: "桂格豆漿燕麥飲290mL/1瓶", staple: 1, meat: 1, fruit: 0, veg: 0 });

    for (const item of [oatDrink, granolaDrink, soyOatDrink]) {
      expect(item.baseAmount).toBeNull();
      expect(item.measureUnit).toBeNull();
    }
  });

  it("the measure basis is always both-present or both-null (never one without the other)", () => {
    const rows = [
      { id: 20, name: "飯/50g", staple: 1, meat: 0, fruit: 0, veg: 0 },
      { id: 21, name: "無糖豆漿/240mL", staple: 0, meat: 1, fruit: 0, veg: 0 },
      { id: 22, name: "飯/1碗", staple: 4, meat: 0, fruit: 0, veg: 0 },
    ];

    for (const row of rows) {
      const item = seedRowToFoodItem(row);
      expect(item.baseAmount === null).toBe(item.measureUnit === null);
    }
  });
});

/**
 * Anchored measure parsing (design.md D2/G2): `/\/\s*(\d+(?:\.\d+)?)\s*(unit)/`
 * — slash, number, then the unit immediately after. g/克->'g', ml/mL/毫升/cc->'ml',
 * whitelisted quantifiers (個顆碗片杯條隻根湯匙球圈截) kept verbatim; anything else null.
 */
describe("seedRowToFoodItem measure parsing (anchored quantifier whitelist)", () => {
  const base = (name: string) => {
    const item = seedRowToFoodItem({ id: 1, name, staple: 0, meat: 0, fruit: 0, veg: 0 });
    return { amount: item.baseAmount, unit: item.measureUnit };
  };

  it.each([
    ["櫻桃/9顆", 9, "顆"],
    ["飯/1碗", 1, "碗"],
    ["芭樂/1顆", 1, "顆"],
    ["星巴克拿鐵(大杯)/1杯", 1, "杯"],
    ["花枝/墨魚/3圈", 3, "圈"],
    ["熟麵/1碗(陽春麵…)", 1, "碗"],
    ["吐司/1片三角形", 1, "片"],
    ["地瓜/1個雞蛋大小", 1, "個"],
    ["飯/50g", 50, "g"],
    ["雞胸肉水餃/140克", 140, "g"],
    ["無糖豆漿/240mL", 240, "ml"],
    ["啤酒/100ml", 100, "ml"],
  ])("parses %s -> (%d, %s)", (name, amount, unit) => {
    expect(base(name)).toEqual({ amount, unit });
  });

  it.each([
    ["馬鈴薯/3分之2碗"], // fraction: slash is followed by 3 then 分 (not whitelisted); "2碗" has no leading slash
    ["290mL/1瓶"], // packaging count 瓶 not whitelisted (mL substring earlier must not be mistaken)
    ["養樂多(紅)/1罐"], // packaging count 罐
    ["中華嫩豆腐/1盒"], // packaging count 盒
    ["POP CORNERS…/1份"], // 份 not whitelisted
    ["熟肉/掌心大"], // vague size, no leading number
    ["營養標示卡路里/60卡"], // 卡 not whitelisted
  ])("leaves %s null (both base_amount and measure_unit)", (name) => {
    expect(base(name)).toEqual({ amount: null, unit: null });
  });
});

/**
 * Coverage over the full seeded catalog (design.md D4). Generalizing the parser
 * from g/ml only to the household quantifier whitelist moves the previous 195
 * null rows down to 63; the rest gain a base measure. Counts verified against
 * the current `food-dictionary-seed-data.ts`.
 */
describe("seed measure-basis coverage over the 271-row catalog", () => {
  it("tallies g / ml / quantifier-with-base / still-null exactly", () => {
    const counts = { g: 0, ml: 0, quantifier: 0, nul: 0 };
    for (const row of FOOD_SEED_ROWS) {
      const { measureUnit } = seedRowToFoodItem(row);
      if (measureUnit === null) counts.nul++;
      else if (measureUnit === "g") counts.g++;
      else if (measureUnit === "ml") counts.ml++;
      else counts.quantifier++;
    }

    expect(FOOD_SEED_ROWS.length).toBe(271);
    expect(counts).toEqual({ g: 61, ml: 15, quantifier: 132, nul: 63 });
    expect(counts.g + counts.ml + counts.quantifier + counts.nul).toBe(FOOD_SEED_ROWS.length);
  });
});

/**
 * Hand-rolled Db double (no real database), following
 * test/contexts/notifications/adapters/drizzle-care-item-repository.test.ts:10-21.
 * `select().from().where()` returns the given existing shared items' seed
 * keys (each `null | string`, matching a real row's `seedKey` column, since
 * an administrator-created shared row has a null seed_key); `insert().values()`
 * records what was inserted rather than writing anywhere. There is
 * deliberately no `update`/`delete` implementation, so a re-run that ever
 * touched an existing row would throw instead of silently passing.
 */
function fakeDbWithExistingSeedKeys(existingSeedKeys: (string | null)[], onInsertValues: (values: unknown[]) => void): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => existingSeedKeys.map((seedKey) => ({ seedKey })),
      }),
    }),
    insert: () => ({
      values: (values: unknown[]) => {
        onInsertValues(values);
        return Promise.resolve();
      },
    }),
  } as unknown as Db;
}

describe("seedFoodDictionary", () => {
  const rows: FoodSeedRow[] = [
    { id: 1, name: "飯/1碗", staple: 4, meat: 0, fruit: 0, veg: 0 },
    { id: 2, name: "香蕉/1根", staple: 0, meat: 0, fruit: 2, veg: 0 },
    { id: 3, name: "熟肉(雞豬牛羊魚)/30g", staple: 0, meat: 1, fruit: 0, veg: 0 },
  ];

  it("inserts only the rows whose seed key is not already among the existing shared items' seed keys", async () => {
    let inserted: unknown[] = [];
    const db = fakeDbWithExistingSeedKeys(["飯/1碗"], (values) => {
      inserted = values;
    });

    const result = await seedFoodDictionary(db, rows);

    expect(inserted).toHaveLength(2);
    expect((inserted as { name: string }[]).map((v) => v.name)).toEqual(["香蕉/1根", "熟肉(雞豬牛羊魚)/30g"]);
    expect(result).toEqual({ inserted: 2, skipped: 1 });
  });

  it("skips a shared row whose seed_key matches a seed row even though its name has since been changed (the regression this change fixes)", async () => {
    let insertCalled = false;
    // The shared row's current `name` is irrelevant here — the fake never
    // models it, because the production query no longer selects `name` at
    // all — only its seed_key ("飯/1碗") is compared.
    const db = fakeDbWithExistingSeedKeys(["飯/1碗"], () => {
      insertCalled = true;
    });

    const result = await seedFoodDictionary(db, [rows[0]]);

    expect(insertCalled).toBe(false);
    expect(result).toEqual({ inserted: 0, skipped: 1 });
  });

  it("does not suppress a seed row when an existing shared row's seed_key is null, even though its name matches (name is no longer the key)", async () => {
    let inserted: unknown[] = [];
    const db = fakeDbWithExistingSeedKeys([null], (values) => {
      inserted = values;
    });

    const result = await seedFoodDictionary(db, [rows[0]]);

    expect(inserted).toHaveLength(1);
    expect(result).toEqual({ inserted: 1, skipped: 0 });
  });

  it("every inserted row carries seedKey equal to its seed row's name", async () => {
    let inserted: unknown[] = [];
    const db = fakeDbWithExistingSeedKeys([], (values) => {
      inserted = values;
    });

    await seedFoodDictionary(db, rows);

    expect((inserted as { name: string; seedKey: string }[]).map((v) => ({ name: v.name, seedKey: v.seedKey }))).toEqual(
      rows.map((row) => ({ name: row.name, seedKey: row.name })),
    );
  });

  it("leaves every existing shared row untouched: no insert call at all when every seed key already exists", async () => {
    let insertCalled = false;
    const db = fakeDbWithExistingSeedKeys(
      rows.map((row) => row.name),
      () => {
        insertCalled = true;
      },
    );

    const result = await seedFoodDictionary(db, rows);

    expect(insertCalled).toBe(false);
    expect(result).toEqual({ inserted: 0, skipped: 3 });
  });

  it("inserts every row, and reports zero skipped, when none already exist", async () => {
    let inserted: unknown[] = [];
    const db = fakeDbWithExistingSeedKeys([], (values) => {
      inserted = values;
    });

    const result = await seedFoodDictionary(db, rows);

    expect(inserted).toHaveLength(3);
    expect(result).toEqual({ inserted: 3, skipped: 0 });
  });
});
