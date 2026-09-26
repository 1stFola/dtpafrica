import { defineConfig } from "vitest/config";

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
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
