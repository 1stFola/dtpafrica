import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateOffset, resetServerClock, serverNow, serverOffsetMs, syncServerClock } from "./server-clock";

afterEach(() => {
  resetServerClock();
  vi.useRealTimers();
});

describe("estimateOffset", () => {
  it("takes the fastest exchange and assumes the server read its clock halfway through", () => {
    expect(
      estimateOffset([
        { sentAt: 1_000, receivedAt: 1_900, serverNow: 61_000 }, // slow: 900 ms round trip
        { sentAt: 2_000, receivedAt: 2_100, serverNow: 62_050 }, // fast: server 60 s ahead
      ])
    ).toBe(60_000);
  });

  it("is negative when this device runs ahead of the server", () => {
    expect(estimateOffset([{ sentAt: 100_000, receivedAt: 100_200, serverNow: 40_100 }])).toBe(-60_000);
  });

  it("has nothing to say without a usable sample", () => {
    expect(estimateOffset([])).toBeNull();
    expect(estimateOffset([{ sentAt: 10, receivedAt: 5, serverNow: 7 }])).toBeNull();
  });
});

const answering = (serverAheadMs: number) =>
  vi.fn(async () => new Response(JSON.stringify({ now: Date.now() + serverAheadMs }), { status: 200 }));

describe("syncServerClock", () => {
  it("moves serverNow() onto the server's clock", async () => {
    const fetcher = answering(90_000);
    await syncServerClock(fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/time", expect.objectContaining({ cache: "no-store" }));
    expect(Math.abs(serverOffsetMs() - 90_000)).toBeLessThan(50);
    expect(Math.abs(serverNow() - (Date.now() + 90_000))).toBeLessThan(50);
  });

  it("keeps the device clock when the server cannot be asked", async () => {
    await syncServerClock(vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(serverOffsetMs()).toBe(0);
    await syncServerClock(vi.fn(async () => new Response("nope", { status: 503 })));
    expect(serverOffsetMs()).toBe(0);
  });

  it("measures once for everyone asking at the same time, and not again for a while", async () => {
    const fetcher = answering(5_000);
    await Promise.all([syncServerClock(fetcher), syncServerClock(fetcher), syncServerClock(fetcher)]);
    const calls = fetcher.mock.calls.length;
    expect(calls).toBe(3); // one measurement of three samples, not three measurements
    await syncServerClock(fetcher);
    expect(fetcher.mock.calls.length).toBe(calls);
  });
});
