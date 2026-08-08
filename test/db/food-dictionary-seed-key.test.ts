import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleFoodDictionaryRepository } from "../../src/contexts/health/adapters/drizzle-food-dictionary-repository";
import { foodItem } from "../../src/shared/db/schema";
import { createTestDb, insertUser, type TestDb } from "./harness";

/**
 * `seed_key` never leaves the database.
 *
 * It is the column the seeder uses to recognise its own rows, and nothing
 * outside the seeder has any business seeing it. The guard for this lived in
 * `admin-food-dictionary.test.ts` as `not.toHaveProperty("seed_key")` against
 * a route driven by an in-memory fake — and that assertion is green whatever
 * the code does, because neither the fake nor the domain type has the field.
 * There was nothing to leak in the pipeline the test exercised.
 *
 * The place a leak could actually happen is `toDomain`, which maps a row
 * fetched with `select()` — every column — into the domain object. So the
 * guard belongs here, against a real Postgres, with a row that really carries
 * the value.
 */
const USER = "11111111-1111-1111-1111-111111111111";

describe("the food dictionary's seed key stays in the database (real Postgres)", () => {
  let harness: TestDb;
  let repository: DrizzleFoodDictionaryRepository;

  beforeAll(async () => {
    harness = await createTestDb();
    repository = new DrizzleFoodDictionaryRepository(() => harness.db);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.resetDb();
    await insertUser(harness.db, USER, "a@example.com", "Ann");
    await harness.db.insert(foodItem).values({
      id: "f1111111-1111-1111-1111-111111111111",
      ownerUserId: null,
      name: "白飯",
      carbG: "40",
      proteinG: "4",
      fatG: "0.5",
      sugarG: "0",
      fiberG: "0.5",
      kcal: "180",
      staple: "1",
      meat: "0",
      fruit: "0",
      veg: "0",
      // A real value, which is the whole point: with this null there is
      // nothing for a leak to carry out.
      seedKey: "seed:rice",
    });
  });

  it("search does not hand the seed key out", async () => {
    const [item] = await repository.search(USER, "白飯");

    expect(item).toBeDefined();
    expect(item).not.toHaveProperty("seedKey");
    expect(item).not.toHaveProperty("seed_key");
    // The row really did carry one — otherwise the two assertions above are
    // satisfied by an empty pipeline rather than by the mapping.
    const [row] = await harness.db.select().from(foodItem);
    expect(row?.seedKey).toBe("seed:rice");
  });

  it("findById does not hand it out either", async () => {
    const item = await repository.findById(USER, "f1111111-1111-1111-1111-111111111111");

    expect(item).toBeDefined();
    expect(item).not.toHaveProperty("seedKey");
    expect(item).not.toHaveProperty("seed_key");
  });
});
