import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerates the food dictionary seed data (`food-dictionary-seed-data.ts`)
 * from the version-controlled tab-separated source `scripts/food-seed-source.tsv`.
 *
 * Workflow to refresh the catalog from the Google Drive sheet:
 *   1. In the sheet, select the data (with the `id name staple meat fruit veg`
 *      header row) and copy, or File -> Download -> Tab-separated values.
 *   2. Paste/save it over `scripts/food-seed-source.tsv`.
 *   3. `npm run seed:gen`   (regenerates the TS data file, validating as it goes)
 *   4. `npm run db:seed`    (idempotently re-seeds the database)
 *
 * TSV (not CSV) is used deliberately: food names contain commas and full-width
 * punctuation but never tabs, so parsing stays trivial and quote-free.
 */
const scriptDir = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(scriptDir, "food-seed-source.tsv");
const OUTPUT = join(
  scriptDir,
  "..",
  "src",
  "contexts",
  "health",
  "adapters",
  "seed",
  "food-dictionary-seed-data.ts",
);

const COLUMNS = ["id", "name", "staple", "meat", "fruit", "veg"] as const;

function fail(message: string): never {
  console.error(`gen-food-seed: ${message}`);
  process.exit(1);
}

function parseNumber(raw: string, field: string, line: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) fail(`row ${line}: ${field} is not a finite number (${JSON.stringify(raw)})`);
  return n;
}

const text = readFileSync(SOURCE, "utf8");
const lines = text.split("\n").filter((l) => l.trim().length > 0);
if (lines.length === 0) fail(`${SOURCE} is empty`);

const header = lines[0].split("\t").map((h) => h.trim());
if (header.length !== COLUMNS.length || COLUMNS.some((c, i) => header[i] !== c)) {
  fail(`header must be exactly "${COLUMNS.join("\\t")}", got "${header.join("\\t")}"`);
}

interface Row {
  id: number;
  name: string;
  staple: number;
  meat: number;
  fruit: number;
  veg: number;
}

const rows: Row[] = lines.slice(1).map((line, i) => {
  const lineNo = i + 2; // 1-based, accounting for header
  const cols = line.split("\t");
  if (cols.length !== COLUMNS.length) {
    fail(`row ${lineNo}: expected ${COLUMNS.length} tab-separated columns, got ${cols.length}`);
  }
  const name = cols[1].trim();
  if (name.length === 0) fail(`row ${lineNo}: name is empty`);
  return {
    id: parseNumber(cols[0], "id", lineNo),
    name,
    staple: parseNumber(cols[2], "staple", lineNo),
    meat: parseNumber(cols[3], "meat", lineNo),
    fruit: parseNumber(cols[4], "fruit", lineNo),
    veg: parseNumber(cols[5], "veg", lineNo),
  };
});

// Integrity: ids must be a contiguous 1..N sequence (catches dropped/duplicated rows).
rows.forEach((row, i) => {
  if (row.id !== i + 1) fail(`ids must be contiguous 1..N; row ${i + 2} has id ${row.id}, expected ${i + 1}`);
});

const body = rows
  .map(
    (r) =>
      `  { id: ${r.id}, name: ${JSON.stringify(r.name)}, ` +
      `staple: ${r.staple}, meat: ${r.meat}, fruit: ${r.fruit}, veg: ${r.veg} },`,
  )
  .join("\n");

const output = `import type { FoodSeedRow } from "./food-dictionary-seed";

/**
 * The user's household-unit food -> portion reference table (${rows.length} rows).
 *
 * GENERATED FILE — do not hand-edit. Source of truth is
 * \`scripts/food-seed-source.tsv\`; regenerate with \`npm run seed:gen\`.
 * Atomic nutrients are derived at seed time by \`seedRowToFoodItem\`.
 */
export const FOOD_SEED_ROWS: FoodSeedRow[] = [
${body}
];
`;

writeFileSync(OUTPUT, output, "utf8");
console.log(`gen-food-seed: wrote ${rows.length} rows to ${OUTPUT}`);
