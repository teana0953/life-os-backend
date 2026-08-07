import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/contexts/**/*.test.ts", "test/architecture/**/*.test.ts"],
        },
      },
      {
        // `test/db/**/*.test.ts`, not `test/db/**`: the latter collects
        // `harness.ts` as a test file and the run fails with
        // "No test suite found in file".
        test: {
          name: "db",
          include: ["test/db/**/*.test.ts"],
        },
      },
      "vitest.workers.config.ts",
    ],
  },
});
