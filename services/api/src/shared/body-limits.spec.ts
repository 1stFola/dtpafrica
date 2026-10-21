import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyBodyLimits, MATCH_SHEET_ROUTE_PREFIX, WORKER_ROUTE_PREFIX } from "./body-limits";

type Handler = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

/** The parsers on a real socket, in order, the way Express runs them. */
function serve(): Server {
  const handlers: Handler[] = [];
  applyBodyLimits({ use: (h: unknown) => handlers.push(h as Handler) });
  return createServer((req, res) => {
    const step = (i: number, err?: unknown) => {
      if (err) {
        const status = (err as { status?: number }).status ?? 500;
        res.writeHead(status).end(JSON.stringify({ status, type: (err as { type?: string }).type }));
        return;
      }
      if (i === handlers.length) {
        const body = (req as IncomingMessage & { body?: unknown }).body;
        res.writeHead(200).end(JSON.stringify({ bytes: JSON.stringify(body ?? null).length }));
        return;
      }
      handlers[i]!(req, res, (e) => step(i + 1, e));
    };
    step(0);
  });
}

describe("body limits", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = serve();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  // A completion the size a 2 min 25 s clip's track rows reached, and some.
  const big = JSON.stringify({ summary: { trackRows: Array.from({ length: 4000 }, (_, i) => ({ localId: i, startFrame: i, endFrame: i + 50, frames: 50, meanScore: 0.91 })) } });
  const post = (path: string, body: string) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body });

  it("lets a worker's completion past 100 kB through", async () => {
    expect(big.length).toBeGreaterThan(100 * 1024);
    const res = await post(`${WORKER_ROUTE_PREFIX}jobs/j-1/complete`, big);
    expect(res.status).toBe(200);
    expect((await res.json()).bytes).toBe(big.length);
  });

  it("keeps every other route at 100 kB", async () => {
    const res = await post("/api/v1/vision/jobs", big);
    expect(res.status).toBe(413);
    expect((await res.json()).type).toBe("entity.too.large");
  });

  it("does not stretch to a path that only looks like the worker's", async () => {
    expect((await post("/api/v1/vision/workers/provision", big)).status).toBe(413);
    expect((await post("/api/v1/vision/worker-extra", big)).status).toBe(413);
  });

  it("still parses small bodies everywhere, once", async () => {
    for (const path of ["/api/v1/vision/jobs", `${WORKER_ROUTE_PREFIX}heartbeat`]) {
      const res = await post(path, JSON.stringify({ ok: true }));
      expect(res.status).toBe(200);
      expect((await res.json()).bytes).toBe(JSON.stringify({ ok: true }).length);
    }
  });

  it("lets a recorder save a long match's event log past 100 kB", async () => {
    const events = Array.from({ length: 900 }, (_, i) => ({
      id: `accurate_cross-17925462758${i}-6qr1t`,
      type: "accurate_cross",
      minute: i % 90,
      addedMinute: null,
      side: "away",
      playerNumber: 11,
      secondaryPlayerNumber: null,
      half: 2,
    }));
    const sheet = JSON.stringify({ tallies: {}, events });
    expect(sheet.length).toBeGreaterThan(100 * 1024);
    const res = await fetch(`${base}${MATCH_SHEET_ROUTE_PREFIX}match-1`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: sheet,
    });
    expect(res.status).toBe(200);
  });

  it("keeps the rest of the admin API at 100 kB", async () => {
    expect((await post("/api/v1/admin/scoreboard/matches", big)).status).toBe(413);
    expect((await post("/api/v1/admin/scoreboard/match-statsx/1", big)).status).toBe(413);
  });

  it("refuses a worker body past its own limit", async () => {
    const huge = JSON.stringify({ pad: "x".repeat(17 * 1024 * 1024) });
    expect((await post(`${WORKER_ROUTE_PREFIX}jobs/j-1/complete`, huge)).status).toBe(413);
  });
});
