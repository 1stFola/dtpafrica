import { describe, expect, it } from "vitest";
import type { ClockState } from "./api";
import { clockBanner, clockNote, errorLabel } from "./clock";

const clock = (ntpState: string, maxErrorMs: number | null = null): ClockState => ({
  edgeUtc: "2026-10-30T15:00:00.000Z", ntpState, recentSteps: [], cloudOffsetMs: null,
  sync: { state: ntpState, maxErrorMs, estErrorMs: null, source: "kernel", boundMs: 1000 },
});

describe("the Edge clock's warning", () => {
  it("says nothing while the clock is synchronised", () => {
    expect(clockBanner(clock("synced", 40))).toBeNull();
    expect(clockNote(clock("synced", 40))).toBeNull();
  });
  it("is a banner when the clock has no time source, and says camera offsets still hold", () => {
    const text = clockBanner(clock("unsynced"))!;
    expect(text).toContain("no time source");
    expect(text).toContain("match console");
    expect(text).toContain("Offsets between cameras");
  });
  it("gives the possible error of a drifting clock, rounded up", () => {
    expect(clockBanner(clock("drifting", 1640))).toContain("off by up to 1.7 s");
    expect(errorLabel(1640)).toBe("1.7 s");
    expect(errorLabel(45_200)).toBe("46 s");
    expect(errorLabel(600_001)).toBe("11 min");
  });
  it("is a quiet note when the state cannot be read, or is still being checked", () => {
    expect(clockBanner(clock("unknown"))).toBeNull();
    expect(clockNote(clock("unknown"))).toContain("could not be checked");
    const settling = clock("unknown");
    settling.sync = { ...settling.sync!, settling: true };
    expect(clockNote(settling)).toContain("is being checked");
  });
});
