import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACKNOWLEDGED, alertWords, waitsForAdmin } from "./alerts";

describe("the Edge's alerts in the console", () => {
  it("offers acknowledgement for exactly the alerts the Edge lets an admin acknowledge", () => {
    const api = readFileSync(resolve(__dirname, "../../../services/fairplay-edge/fairplay_edge/api.py"), "utf8");
    const edge = api.match(/ACKNOWLEDGED_ALERTS = \(([^)]*)\)/)![1].match(/"([a-z_]+)"/g)!.map((s) => s.slice(1, -1));
    expect([...ACKNOWLEDGED].sort()).toEqual(edge.sort());
  });
  it("words each alert, and falls back to its name", () => {
    expect(alertWords("segment_partial")).toContain("repaired");
    expect(alertWords("something_new")).toBe("something new");
    expect(waitsForAdmin("segment_mismatch") && !waitsForAdmin("disk_full")).toBe(true);
  });
});
