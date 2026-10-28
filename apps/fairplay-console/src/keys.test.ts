import { describe, expect, it } from "vitest";
import { actionFor, nextSpeed, SHORTCUTS } from "./keys";

describe("keyboard", () => {
  it("maps the documented keys", () => {
    expect(actionFor({ key: " " })).toBe("togglePlay");
    expect(actionFor({ key: "ArrowLeft" })).toBe("back10");
    expect(actionFor({ key: "3" })).toBe("back60");
    expect(actionFor({ key: "F" })).toBe("flag");
    expect(actionFor({ key: "l" })).toBe("live");
    expect(actionFor({ key: "d" })).toBe("source:drone");
    expect(actionFor({ key: "," })).toBe("nudgeBack");
    expect(actionFor({ key: "." })).toBe("nudgeForward");
  });

  it("does nothing while typing or with a modifier", () => {
    expect(actionFor({ key: "f", target: { tagName: "INPUT" } as unknown as EventTarget })).toBeNull();
    expect(actionFor({ key: "f", target: { tagName: "TEXTAREA" } as unknown as EventTarget })).toBeNull();
    expect(actionFor({ key: "s", ctrlKey: true })).toBeNull();
    expect(actionFor({ key: "x" })).toBeNull();
  });

  it("offers 0.25x only when measured", () => {
    expect(nextSpeed(1, false)).toBe(0.5);
    expect(nextSpeed(0.5, false)).toBe(1);
    expect(nextSpeed(0.5, true)).toBe(0.25);
    expect(nextSpeed(0.25, true)).toBe(1);
  });

  it("has no two actions on one key", () => {
    const keys = SHORTCUTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
