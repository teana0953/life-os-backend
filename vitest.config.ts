import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/contexts/**/*.test.ts"],
        },
      },
      "vitest.workers.config.ts",
    ],
  },
});
