import { defineConfig } from "vitest/config";
import { resolve } from "path";

const repoRoot = resolve(__dirname, "../..");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    reporters: [
      "verbose",
      ["allure-vitest/reporter", {
        resultsDir: resolve(repoRoot, "allure-results", "engines"),
      }],
    ],
  },
});
