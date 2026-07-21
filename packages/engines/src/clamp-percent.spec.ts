import { describe, it, expect } from "vitest";
import * as allure from "allure-js-commons";
import { clampPercent } from "./clamp-percent";

describe("clampPercent", () => {
  it("clamps values above 100 to 100", async () => {
    await allure.epic("Engines");
    await allure.feature("Score Utilities");
    await allure.story("clampPercent");

    expect(clampPercent(150)).toBe(100);
  });

  it("clamps negative values to 0", async () => {
    await allure.epic("Engines");
    await allure.feature("Score Utilities");

    expect(clampPercent(-10)).toBe(0);
  });

  it("returns 0 for NaN and Infinity", async () => {
    await allure.epic("Engines");
    await allure.feature("Score Utilities");

    expect(clampPercent(NaN)).toBe(0);
    expect(clampPercent(Infinity)).toBe(0);
  });

  it("rounds to 0 decimal places by default", async () => {
    await allure.epic("Engines");
    await allure.feature("Score Utilities");

    expect(clampPercent(72.6)).toBe(73);
    expect(clampPercent(72.4)).toBe(72);
  });

  it("rounds to specified decimal places", async () => {
    await allure.epic("Engines");
    await allure.feature("Score Utilities");

    expect(clampPercent(72.567, 1)).toBe(72.6);
    expect(clampPercent(72.567, 2)).toBe(72.57);
  });

  it("preserves values in valid range", async () => {
    await allure.epic("Engines");
    await allure.feature("Score Utilities");

    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(100)).toBe(100);
  });
});
