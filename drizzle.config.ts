import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Load DATABASE_URL from the untracked .dev.vars file so migrations can run
// locally without ever passing the secret on the command line. process.env
// still wins if the variable is already set (e.g. in CI).
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .dev.vars is optional; drizzle-kit will error clearly if the url is empty.
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shared/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
