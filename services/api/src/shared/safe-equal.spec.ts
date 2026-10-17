import { describe, expect, it } from "vitest";
import { safeEqual } from "./safe-equal";

describe("safeEqual", () => {
  it("is true for the same secret", () => {
    expect(safeEqual("dtp-dev-admin-1", "dtp-dev-admin-1")).toBe(true);
  });

  it("is false for a different secret of the same length", () => {
    expect(safeEqual("dtp-dev-admin-1", "dtp-dev-admin-2")).toBe(false);
  });

  it("is false, without throwing, when the lengths differ", () => {
    expect(safeEqual("short", "a-much-longer-expected-key")).toBe(false);
    expect(safeEqual("", "key")).toBe(false);
  });
});
