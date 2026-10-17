import type { AddressInfo } from "node:net";
import { NestFactory } from "@nestjs/core";
import { Controller, Get, Module } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { corsOrigins, DEVELOPMENT_ORIGINS, PRODUCTION_ORIGINS } from "./cors";

describe("corsOrigins", () => {
  it("is the production pair alone in production", () => {
    expect(corsOrigins({ NODE_ENV: "production" })).toEqual([...PRODUCTION_ORIGINS]);
  });

  it("adds the Vite origins outside production", () => {
    expect(corsOrigins({ NODE_ENV: "development" })).toEqual([...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS]);
    expect(corsOrigins({})).toContain("http://localhost:5173");
  });

  it("lets CORS_ORIGINS replace the production pair, normalised to bare origins", () => {
    expect(
      corsOrigins({ NODE_ENV: "production", CORS_ORIGINS: " https://staging.dtp.africa/ , https://dtp.africa/some/path" })
    ).toEqual(["https://staging.dtp.africa", "https://dtp.africa"]);
  });

  it("ignores an empty CORS_ORIGINS", () => {
    expect(corsOrigins({ NODE_ENV: "production", CORS_ORIGINS: " , " })).toEqual([...PRODUCTION_ORIGINS]);
  });

  it("refuses an entry that is not an origin, rather than starting with a list that matches nothing", () => {
    expect(() => corsOrigins({ CORS_ORIGINS: "dtp.africa" })).toThrow(/not an origin/);
  });
});

@Controller("ping")
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

@Module({ controllers: [PingController] })
class PingModule {}

/** The list as main.ts hands it to Nest, on a real socket: what a browser would be told. */
describe("enableCors with the allow-list", () => {
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const app = await NestFactory.create(PingModule, { logger: false });
    app.enableCors({ origin: corsOrigins({ NODE_ENV: "production" }) });
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    close = () => app.close();
  });
  afterAll(() => close());

  it("tells dtp.africa it may read the response", async () => {
    const res = await fetch(`${base}/ping`, { headers: { Origin: "https://dtp.africa" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://dtp.africa");
  });

  it("tells any other site nothing, which the browser treats as a refusal", async () => {
    const res = await fetch(`${base}/ping`, { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a preflight from an allowed origin and not from another", async () => {
    const preflight = (origin: string) =>
      fetch(`${base}/ping`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
      });
    expect((await preflight("https://www.dtp.africa")).headers.get("access-control-allow-origin")).toBe(
      "https://www.dtp.africa"
    );
    expect((await preflight("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves a request with no Origin, as servers and workers send", async () => {
    const res = await fetch(`${base}/ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
