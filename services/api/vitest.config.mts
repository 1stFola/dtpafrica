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
    /* `scripts/` too: the gate-litter patterns decide what a purge deletes from a
       real database, so they are tested rather than trusted, and they belong beside
       the script that uses them rather than in the shipped source tree. */
    include: ["src/**/*.spec.ts", "scripts/**/*.spec.ts"],
    reporters: [
      "verbose",
      ["allure-vitest/reporter", {
        resultsDir: resolve(repoRoot, "allure-results", "api"),
      }],
    ],
  },
});
