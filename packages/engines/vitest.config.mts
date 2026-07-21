import { defineConfig } from "vitest/config";
import AllureVitest from "allure-vitest/reporter";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    reporters: [
      "verbose",
      new AllureVitest({
        resultsDir: "../../allure-results/engines",
      }),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    },
  },
});
