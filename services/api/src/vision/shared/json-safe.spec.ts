import { describe, expect, it } from "vitest";
import { jsonSafe } from "./json-safe";

describe("jsonSafe", () => {
  // The failure it exists for: an endpoint returning a row with a BigInt column
  // threw inside JSON.stringify and surfaced as a 500.
  it("makes a BigInt survive JSON.stringify", () => {
    const row = { bytesRead: BigInt(6_000_000_000), gpuSeconds: 12.5 };
    expect(() => JSON.stringify(jsonSafe(row))).not.toThrow();
    expect(JSON.parse(JSON.stringify(jsonSafe(row)))).toEqual({
      bytesRead: 6_000_000_000,
      gpuSeconds: 12.5,
    });
  });

  it("keeps a byte count as a number, which is what a client does arithmetic on", () => {
    expect(jsonSafe(BigInt(1024))).toBe(1024);
  });

  // Degrading rather than silently losing precision.
  it("falls back to a string beyond MAX_SAFE_INTEGER", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(10);
    expect(jsonSafe(huge)).toBe(huge.toString());
  });

  it("handles negatives on both sides of the boundary", () => {
    expect(jsonSafe(BigInt(-1024))).toBe(-1024);
    expect(jsonSafe(-(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(10)))).toBe(
      (-(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(10))).toString()
    );
  });

  it("walks nested objects and arrays", () => {
    const input = { cost: { bytesWritten: BigInt(5) }, artifacts: [{ bytes: BigInt(7) }] };
    expect(jsonSafe(input)).toEqual({ cost: { bytesWritten: 5 }, artifacts: [{ bytes: 7 }] });
  });

  it("serialises dates to ISO strings", () => {
    expect(jsonSafe(new Date("2026-09-25T00:00:00.000Z"))).toBe("2026-09-25T00:00:00.000Z");
  });

  it("leaves ordinary values and null alone", () => {
    expect(jsonSafe({ a: 1, b: "x", c: null, d: true })).toEqual({ a: 1, b: "x", c: null, d: true });
  });

  it("does not patch the BigInt prototype", () => {
    // A global patch would change serialisation for every other module in the
    // process to fix a problem local to Vision.
    expect((BigInt.prototype as { toJSON?: unknown }).toJSON).toBeUndefined();
  });
});
