import { describe, it, expect } from "vitest";
import * as allure from "allure-js-commons";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  const controller = new HealthController();

  describe("GET /api/v1/health", () => {
    it("returns status ok", async () => {
      await allure.epic("API");
      await allure.feature("Health Check");
      await allure.story("GET /health");
      await allure.severity("blocker");
      await allure.description(
        "The health endpoint must return HTTP 200 with status ok. " +
        "This is used by the CD pipeline smoke test to verify a successful deployment."
      );

      const result = controller.health();

      expect(result.status).toBe("ok");
      expect(result.service).toBe("@dtp/api");
    });

    it("includes the service phase identifier", async () => {
      await allure.epic("API");
      await allure.feature("Health Check");

      const result = controller.health();
      expect(result.phase).toBeDefined();
      expect(typeof result.phase).toBe("string");
    });
  });

  describe("GET /api/v1/", () => {
    it("returns root info with module list", async () => {
      await allure.epic("API");
      await allure.feature("Health Check");
      await allure.story("GET / (root)");

      const result = controller.root();

      expect(result.status).toBe("ok");
      expect(result.service).toBe("@dtp/api");
      expect(Array.isArray(result.modules)).toBe(true);
      expect(result.modules).toContain("home");
      expect(result.modules).toContain("scoreboard");
      expect(result.modules).toContain("admin");
    });

    it("includes a health endpoint path", async () => {
      await allure.epic("API");
      await allure.feature("Health Check");

      const result = controller.root();
      expect(result.health).toBe("/api/v1/health");
    });
  });
});
