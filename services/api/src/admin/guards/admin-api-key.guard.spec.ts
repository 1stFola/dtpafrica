import { describe, it, expect, vi } from "vitest";
import * as allure from "allure-js-commons";
import { UnauthorizedException } from "@nestjs/common";
import { AdminApiKeyGuard } from "./admin-api-key.guard";

// ── Read the guard source to understand what header/env it checks ─────────────

const makeContext = (headerValue?: string) => ({
  switchToHttp: () => ({
    getRequest: () => ({
      headers: headerValue
        ? { "x-admin-api-key": headerValue }
        : {},
    }),
  }),
});

describe("AdminApiKeyGuard", () => {
  it("allows request when API key header matches env variable", async () => {
    await allure.epic("API");
    await allure.feature("Admin Auth");
    await allure.story("API key guard — valid key");
    await allure.severity("blocker");
    await allure.description(
      "Requests with a matching X-Admin-Api-Key header must be allowed through. " +
      "This guard protects all admin write endpoints."
    );

    process.env.ADMIN_API_KEY = "test-secret-key";
    const guard = new AdminApiKeyGuard();

    const result = guard.canActivate(makeContext("test-secret-key") as any);
    expect(result).toBe(true);
  });

  it("rejects request when API key header is wrong", async () => {
    await allure.epic("API");
    await allure.feature("Admin Auth");
    await allure.story("API key guard — invalid key");
    await allure.severity("blocker");

    process.env.ADMIN_API_KEY = "test-secret-key";
    const guard = new AdminApiKeyGuard();

    expect(() =>
      guard.canActivate(makeContext("wrong-key") as any)
    ).toThrow(UnauthorizedException);
  });

  it("rejects request when API key header is missing", async () => {
    await allure.epic("API");
    await allure.feature("Admin Auth");
    await allure.story("API key guard — missing key");
    await allure.severity("blocker");

    process.env.ADMIN_API_KEY = "test-secret-key";
    const guard = new AdminApiKeyGuard();

    expect(() =>
      guard.canActivate(makeContext() as any)
    ).toThrow(UnauthorizedException);
  });
});
