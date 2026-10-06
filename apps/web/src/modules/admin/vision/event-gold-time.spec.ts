import { describe, expect, it } from "vitest";
import { goldPlayheadSourceMs } from "./event-gold-time";
describe("gold reference playhead", () => {
  it("never turns the real pilot's padded proxy tail into an evidence frame", () => {
    expect(goldPlayheadSourceMs(49_720, { fps: 25, sourceOffsetMs: 0, sourceDurationMs: 49_706 }, 49_706)).toBe(49_680);
  });
  it("excludes the end of the reference window and preserves source offsets", () => {
    expect(goldPlayheadSourceMs(5000, { fps: 25, sourceOffsetMs: 10_000, sourceDurationMs: 20_000 }, 15_000)).toBe(14_960);
    expect(goldPlayheadSourceMs(1040, { fps: 25, sourceOffsetMs: 10_000, sourceDurationMs: 20_000 }, 15_000)).toBe(11_040);
  });
});
