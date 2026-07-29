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
 * Default behavior inserts only the rows not already present among the
 * existing shared items, leaving every existing shared row (including
 * administrator corrections and administrator-created shared items) untouched
 * (D11 in design.md). The old destructive delete-then-reinsert behavior is
 * still available, but only behind an explicit `--force` flag, for refreshing
 * seed data on a disposable database. User-custom items are never touched
 * either way.
 *
 * Run with `npm run db:seed` (or `npm run db:seed -- --force`).
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

  if (process.argv.includes("--force")) {
    await db.delete(foodItem).where(isNull(foodItem.ownerUserId));
    const result = await seedFoodDictionary(db, SEED_ROWS);
    console.log(`Force-refreshed the shared catalog: inserted ${result.inserted}, skipped ${result.skipped}.`);
    return;
  }

  const result = await seedFoodDictionary(db, SEED_ROWS);
  console.log(`Seeded the shared food dictionary: inserted ${result.inserted}, skipped ${result.skipped} (already present).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
