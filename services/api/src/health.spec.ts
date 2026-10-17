import { describe, it, expect, vi, afterEach } from "vitest";
import * as allure from "allure-js-commons";
import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController, READY_DB_TIMEOUT_MS } from "./health.controller";
import type { PrismaService } from "./prisma/prisma.service";

function withDb(queryRaw: () => Promise<unknown>) {
  return new HealthController({ $queryRaw: vi.fn(queryRaw) } as unknown as PrismaService);
}

describe("HealthController", () => {
  const controller = withDb(async () => [{ "?column?": 1 }]);

  afterEach(() => {
    vi.useRealTimers();
  });

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

  describe("GET /api/v1/health/ready", () => {
    it("is ok when Postgres answers", async () => {
      await allure.epic("API");
      await allure.feature("Health Check");
      await allure.story("GET /health/ready");
      await allure.description(
        "Readiness pings the database. The external uptime check watches it, so a " +
        "running API with an unreachable Postgres shows as down."
      );

      const result = await controller.ready();

      expect(result.status).toBe("ok");
      expect(result.db).toBe("ok");
      expect(typeof result.dbLatencyMs).toBe("number");
    });

    it("is 503 when the query fails", async () => {
      const down = withDb(async () => {
        throw new Error("connection refused");
      });

      await expect(down.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("is 503, not a hang, when Postgres never answers", async () => {
      vi.useFakeTimers();
      const hung = withDb(() => new Promise(() => undefined));

      const pending = hung.ready();
      const settled = expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);
      await vi.advanceTimersByTimeAsync(READY_DB_TIMEOUT_MS);
      await settled;
    });

    it("does not touch the database for liveness", () => {
      const untouched = withDb(async () => {
        throw new Error("should not be called");
      });

      expect(untouched.health().status).toBe("ok");
    });
  });
});
