/**
 * Rate limits on the logins and the public forms.
 *
 * A real Nest app with the real ThrottlerModule options and the real `trust proxy` setting,
 * sent real requests. Each request carries the X-Forwarded-For nginx would send, because that
 * is what the limit keys on in production; requests without it come from loopback, which is
 * deliberately not limited (the DB gates and local development).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { AddressInfo } from "node:net";
import { AdminAuthController } from "../admin/admin-auth.controller";
import { AdminAuthService } from "../admin/auth/admin-auth.service";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { AcademyAuthController } from "../academy-auth/academy-auth.controller";
import { AcademyAuthService } from "../academy-auth/academy-auth.service";
import { AcademyAuthGuard } from "../academy-auth/guards/academy-auth.guard";
import { HomeController } from "../home/home.controller";
import { HomeService } from "../home/home.service";
import { AdsConfigService } from "../ads/ads-config.service";
import { SupportController } from "../support/support.controller";
import { SupportService } from "../support/support.service";
import { isLoopback, THROTTLE_MODULE_OPTIONS, TRUSTED_PROXIES } from "./throttle";

const home = {
  register: vi.fn(async () => ({ ok: true })),
  submitContact: vi.fn(async () => ({ ok: true })),
  subscribeNewsletter: vi.fn(async () => ({ ok: true })),
  featuredPlayers: vi.fn(async () => []),
};

let app: NestExpressApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(THROTTLE_MODULE_OPTIONS)],
    controllers: [AdminAuthController, AcademyAuthController, HomeController, SupportController],
    providers: [
      { provide: AdminAuthService, useValue: { login: vi.fn(async () => ({ token: "t" })) } },
      { provide: AdminAuthGuard, useValue: { canActivate: () => true } },
      { provide: AcademyAuthService, useValue: { login: vi.fn(async () => ({ token: "t" })) } },
      { provide: AcademyAuthGuard, useValue: { canActivate: () => true } },
      { provide: HomeService, useValue: home },
      { provide: AdsConfigService, useValue: {} },
      { provide: SupportService, useValue: { createReport: vi.fn(async () => ({ id: "r1" })) } },
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set("trust proxy", TRUSTED_PROXIES);
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app?.close();
});

/** A POST as nginx forwards it: the visitor's address last in X-Forwarded-For. */
const post = (path: string, visitor?: string, forwardedFor?: string) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(visitor ? { "X-Forwarded-For": forwardedFor ?? visitor } : {}),
    },
    body: JSON.stringify({ email: "a@b.test", username: "a", password: "wrong" }),
  });

async function statuses(path: string, times: number, visitor?: string): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < times; i++) out.push((await post(path, visitor)).status);
  return out;
}

describe.each(["/admin/auth/login", "/academy/auth/login"])("%s", (path) => {
  // Each describe gets its own address, so one route's count never leaks into another's.
  const visitor = path.startsWith("/admin") ? "203.0.113.10" : "203.0.113.20";

  it("allows 10 attempts a minute from one address, then answers 429", async () => {
    const results = await statuses(path, 11, visitor);
    expect(results.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(results[10]).toBe(429);
  });

  it("counts each address on its own", async () => {
    const res = await post(path, path.startsWith("/admin") ? "203.0.113.11" : "203.0.113.21");
    expect(res.status).not.toBe(429);
  });

  it("is not fooled by a forged address in front of the one nginx appended", async () => {
    // The visitor writes their own X-Forwarded-For; nginx appends the real one after it.
    const res = await post(path, visitor, `198.51.100.99, ${visitor}`);
    expect(res.status).toBe(429);
  });
});

describe.each([
  ["/home/register", "203.0.113.30"],
  ["/home/contact", "203.0.113.31"],
  ["/home/newsletter", "203.0.113.32"],
  ["/support/reports", "203.0.113.33"],
])("public form %s", (path, visitor) => {
  it("allows 5 a minute from one address, then answers 429", async () => {
    const results = await statuses(path, 6, visitor);
    expect(results.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(results[5]).toBe(429);
  });
});

describe("what is not limited", () => {
  it("requests from the machine itself (the DB gates, local development)", async () => {
    const results = await statuses("/admin/auth/login", 15);
    expect(results.every((s) => s !== 429)).toBe(true);
  });

  it("routes without the decorator, such as public reads", async () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${base}/home/featured-players`, { headers: { "X-Forwarded-For": "203.0.113.40" } });
      results.push(res.status);
    }
    expect(results.every((s) => s === 200)).toBe(true);
  });
});

describe("isLoopback", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.1.1"])("%s is the machine itself", (ip) => {
    expect(isLoopback(ip)).toBe(true);
  });

  it.each(["203.0.113.10", "172.18.0.5", "::ffff:10.0.0.1", "", undefined])("%s is not", (ip) => {
    expect(isLoopback(ip)).toBe(false);
  });
});
