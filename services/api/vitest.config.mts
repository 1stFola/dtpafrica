import { defineConfig } from "vitest/config";
import { resolve } from "path";

const repoRoot = resolve(__dirname, "../..");

export default defineConfig({
  /**
   * Resolve the workspace packages to their **source**, exactly as
   * tsconfig.build.json's `paths` already does.
   *
   * Their package.json points at `dist/`, which is gitignored — so in CI there was
   * nothing to resolve and every Vision suite failed to load, while locally a `dist`
   * left over from an earlier build made it pass. That is the worse half of the bug:
   * a stale `dist` means vitest tests yesterday's contracts while tsc checks today's
   * source, and the two can disagree silently.
   *
   * Pointing both at source removes the build step and the staleness together.
   */
  resolve: {
    alias: {
      "@dtp/vision-contracts": resolve(repoRoot, "packages/vision-contracts/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    reporters: [
      "verbose",
      ["allure-vitest/reporter", {
        resultsDir: resolve(repoRoot, "allure-results", "api"),
      }],
    ],
  },
});
