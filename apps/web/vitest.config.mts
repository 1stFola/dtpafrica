import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The web app's first tests.
 *
 * Added with the annotation workstation, because its time and frame arithmetic
 * decides whether a stored label means what it says — and a proxy offset applied
 * wrongly corrupts every label in a task while leaving them consistent with each
 * other, so nothing downstream notices.
 *
 * `node` environment: what is tested here is pure logic, deliberately kept out of
 * the React tree so it needs no DOM.
 */
export default defineConfig({
  // The same source alias the app is built with (vite.config.ts).
  resolve: { alias: { "@dtp/vision-contracts": path.resolve(here, "../../packages/vision-contracts/src/index.ts") } },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
  },
});
