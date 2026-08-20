import { describe, it, expect } from "vitest";
import * as allure from "allure-js-commons";
import { normalizeClubName } from "./normalize-club-name";

describe("normalizeClubName", () => {
  it("maps known alias 'ikorodu city' to official name", async () => {
    await allure.epic("Engines");
    await allure.feature("Scoreboard Utilities");
    await allure.story("Club name normalisation");
    await allure.severity("critical");

    expect(normalizeClubName("ikorodu city")).toBe("Ikorodu City FC");
  });

  it("maps case-insensitive alias 'Ikorodu City FC'", async () => {
    await allure.epic("Engines");
    await allure.feature("Scoreboard Utilities");

    expect(normalizeClubName("Ikorodu City FC")).toBe("Ikorodu City FC");
  });

  it("maps 'fc bethel' alias", async () => {
    await allure.epic("Engines");
    await allure.feature("Scoreboard Utilities");

    expect(normalizeClubName("fc bethel")).toBe("FC Bethel Sporting");
  });

  it("maps 'klassisch fc' alias", async () => {
    await allure.epic("Engines");
    await allure.feature("Scoreboard Utilities");

    expect(normalizeClubName("klassisch fc")).toBe("Klassisch FA");
  });

  it("passes through unknown club names unchanged", async () => {
    await allure.epic("Engines");
    await allure.feature("Scoreboard Utilities");

    expect(normalizeClubName("Lagos United")).toBe("Lagos United");
  });

  it("strips zero-width characters from input", async () => {
    await allure.epic("Engines");
    await allure.feature("Scoreboard Utilities");

    // zero-width space before 'fc'
    expect(normalizeClubName("fc\u200B bethel")).toBe("FC Bethel Sporting");
  });

  it("collapses multiple spaces", async () => {
    await allure.epic("Engines");
    await allure.feature("Scoreboard Utilities");

    expect(normalizeClubName("ikorodu  city")).toBe("Ikorodu City FC");
  });

  it("returns empty string for empty input", async () => {
    await allure.epic("Engines");
    await allure.feature("Scoreboard Utilities");

    expect(normalizeClubName("")).toBe("");
  });
});
