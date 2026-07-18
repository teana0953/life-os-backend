import { readFileSync } from "node:fs";
import { isNull } from "drizzle-orm";
import { createDbClient } from "../../../../shared/db/client";
import { foodItem } from "../../../../shared/db/schema";
import { SEED_ROWS, seedFoodDictionary } from "./food-dictionary-seed";

/**
 * Standalone runner that seeds the shared food dictionary into the configured
 * database. Reads DATABASE_URL from the environment or the untracked `.dev.vars`
 * (same convention as `drizzle.config.ts`), so the secret never touches the CLI.
 *
 * Idempotent: it clears existing shared (owner_user_id IS NULL) items before
 * re-inserting, so it is safe to re-run after the seed data file is refreshed.
 * User-custom items are never touched.
 *
 * Run with `npm run db:seed`.
 */
function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match && match[1] === "DATABASE_URL") {
        return match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .dev.vars is optional; fall through to the explicit error below.
  }
  throw new Error("DATABASE_URL is not set (checked env and .dev.vars)");
}

async function main(): Promise<void> {
  const db = createDbClient(loadDatabaseUrl());
  await db.delete(foodItem).where(isNull(foodItem.ownerUserId));
  await seedFoodDictionary(db, SEED_ROWS);
  console.log(`Seeded ${SEED_ROWS.length} shared food items.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
