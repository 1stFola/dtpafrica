import { describe, expect, it } from "vitest";
import {
  clampToWindow,
  describePosition,
  formatClock,
  frameIndexAt,
  frameStartMs,
  isInWindow,
  proxyOffsetMs,
  stepFrames,
  toProxyMs,
  toSourceMs,
  windowDurationMs,
} from "./annotation-time";

/**
 * The arithmetic that decides whether a label means what it says.
 *
 * A proxy that starts five seconds into the source is the normal case, not an edge
 * case, and an ignored offset puts every label in a task five seconds out — an error
 * that survives review because the labels stay consistent with each other.
 */

/** A task 60s–120s into the match, on a proxy that starts 5s in. */
const SOURCE = { startMs: 60_000, endMs: 120_000 };
const PROXY = { windowStartMs: 55_000, windowEndMs: 115_000, fps: 25 };

describe("source time versus proxy time", () => {
  it("derives the offset from the two windows", () => {
    expect(proxyOffsetMs(SOURCE, PROXY)).toBe(5_000);
  });

  it("round-trips a time through both clocks", () => {
    const offset = proxyOffsetMs(SOURCE, PROXY);
    expect(toSourceMs(toProxyMs(72_500, offset), offset)).toBe(72_500);
  });

  it("maps the window's start correctly in both directions", () => {
    const offset = proxyOffsetMs(SOURCE, PROXY);
    expect(toProxyMs(SOURCE.startMs, offset)).toBe(PROXY.windowStartMs);
    expect(toSourceMs(PROXY.windowEndMs, offset)).toBe(SOURCE.endMs);
  });

  it("handles a proxy that starts at source zero", () => {
    const aligned = { windowStartMs: 60_000, windowEndMs: 120_000, fps: 25 };
    expect(proxyOffsetMs(SOURCE, aligned)).toBe(0);
  });

  it("handles a proxy that starts after the source window", () => {
    // A clip cut from later in the match: the offset is negative, and the maths must
    // not assume the proxy always lags.
    const later = { windowStartMs: 65_000, windowEndMs: 125_000, fps: 25 };
    const offset = proxyOffsetMs(SOURCE, later);
    expect(offset).toBe(-5_000);
    expect(toSourceMs(later.windowStartMs, offset)).toBe(SOURCE.startMs);
  });
});

describe("frame indexing", () => {
  it("floors rather than rounds", () => {
    // A time is inside a frame until the next begins. Rounding would push roughly
    // half of all labels onto the following frame.
    expect(frameIndexAt(1_000, 25)).toBe(25);
    expect(frameIndexAt(1_039, 25)).toBe(25);
    expect(frameIndexAt(1_040, 25)).toBe(26);
  });

  it("returns frame zero at time zero", () => {
    expect(frameIndexAt(0, 25)).toBe(0);
  });

  it("never returns a negative frame", () => {
    expect(frameIndexAt(-500, 25)).toBe(0);
  });

  it("refuses to guess a frame rate", () => {
    // Guessing 25 produces labels that look precise and are wrong, which is worse
    // than labels that admit to being only millisecond-accurate.
    expect(frameIndexAt(1_000, null)).toBeNull();
    expect(frameIndexAt(1_000, 0)).toBeNull();
    expect(frameIndexAt(1_000, Number.NaN)).toBeNull();
  });

  it("gives the exact start of a frame", () => {
    expect(frameStartMs(25, 25)).toBe(1_000);
    expect(frameStartMs(0, 25)).toBe(0);
  });

  it("is self-consistent: the start of frame N indexes back to N", () => {
    for (const fps of [25, 30, 50]) {
      for (const frame of [0, 1, 7, 99, 2_500]) {
        const ms = frameStartMs(frame, fps)!;
        expect(frameIndexAt(ms, fps)).toBe(frame);
      }
    }
  });

  it("handles a fractional frame rate without drifting", () => {
    // 29.97 is real, and a naive integer assumption drifts by a frame a second.
    const ms = frameStartMs(300, 29.97)!;
    expect(frameIndexAt(ms, 29.97)).toBe(300);
  });
});

describe("stepping", () => {
  it("moves exactly one frame", () => {
    const at = frameStartMs(1_500, 25)!;
    expect(stepFrames(at, 1, 25, PROXY)).toBeCloseTo(frameStartMs(1_501, 25)!, 6);
  });

  it("moves backwards", () => {
    const at = frameStartMs(1_500, 25)!;
    expect(stepFrames(at, -1, 25, PROXY)).toBeCloseTo(frameStartMs(1_499, 25)!, 6);
  });

  it("lands on a frame boundary even when starting mid-frame", () => {
    // Otherwise the browser decides which neighbouring frame to show, and the frame
    // stored is not the frame seen.
    const midFrame = frameStartMs(1_500, 25)! + 17;
    const stepped = stepFrames(midFrame, 1, 25, PROXY);
    expect(frameIndexAt(stepped, 25)).toBe(1_501);
  });

  it("stops at the start of the window rather than running off the front", () => {
    expect(stepFrames(PROXY.windowStartMs, -50, 25, PROXY)).toBe(PROXY.windowStartMs);
  });

  it("stops at the end of the window", () => {
    expect(stepFrames(PROXY.windowEndMs, 50, 25, PROXY)).toBe(PROXY.windowEndMs);
  });

  it("still steps without a frame rate, so the keyboard keeps working", () => {
    const noFps = { ...PROXY, fps: null };
    expect(stepFrames(60_000, 1, null, noFps)).toBe(60_100);
    expect(stepFrames(60_000, -1, null, noFps)).toBe(59_900);
  });
});

describe("the window", () => {
  it("clamps into range", () => {
    expect(clampToWindow(0, PROXY)).toBe(PROXY.windowStartMs);
    expect(clampToWindow(999_999, PROXY)).toBe(PROXY.windowEndMs);
    expect(clampToWindow(70_000, PROXY)).toBe(70_000);
  });

  it("knows what is inside it", () => {
    expect(isInWindow(PROXY.windowStartMs, PROXY)).toBe(true);
    expect(isInWindow(PROXY.windowEndMs, PROXY)).toBe(true);
    expect(isInWindow(PROXY.windowStartMs - 1, PROXY)).toBe(false);
  });

  it("reports the source duration", () => {
    expect(windowDurationMs(SOURCE)).toBe(60_000);
  });
});

describe("the clock display", () => {
  it("always shows milliseconds", () => {
    // Event boundaries are sub-second; hiding milliseconds hides what is being judged.
    expect(formatClock(0)).toBe("00:00.000");
    expect(formatClock(1)).toBe("00:00.001");
    expect(formatClock(72_480)).toBe("01:12.480");
  });

  it("omits hours until there are hours", () => {
    expect(formatClock(2_832_480)).toBe("47:12.480");
    expect(formatClock(3_600_000)).toBe("1:00:00.000");
  });

  it("shows a negative time rather than wrapping it", () => {
    expect(formatClock(-1_500)).toBe("-00:01.500");
  });
});

describe("describePosition", () => {
  it("reports both clocks together", () => {
    // The failure this guards against is a reviewer reading one clock and believing
    // the other, so they are computed and surfaced as one object.
    const at = describePosition(55_000, SOURCE, PROXY);
    expect(at.proxyClock).toBe("00:55.000");
    expect(at.sourceClock).toBe("01:00.000");
    expect(at.sourceMs).toBe(60_000);
  });

  it("reports the frame and that it is accurate", () => {
    const at = describePosition(frameStartMs(1_500, 25)!, SOURCE, PROXY);
    expect(at.frameIndex).toBe(1_500);
    expect(at.frameAccurate).toBe(true);
  });

  it("admits when it is not frame-accurate", () => {
    const at = describePosition(60_000, SOURCE, { ...PROXY, fps: null });
    expect(at.frameIndex).toBeNull();
    expect(at.frameAccurate).toBe(false);
  });

  it("reports progress through the window, clamped", () => {
    expect(describePosition(55_000, SOURCE, PROXY).progress).toBe(0);
    expect(describePosition(85_000, SOURCE, PROXY).progress).toBeCloseTo(0.5, 6);
    expect(describePosition(115_000, SOURCE, PROXY).progress).toBe(1);
    expect(describePosition(0, SOURCE, PROXY).progress).toBe(0);
  });

  it("does not divide by zero on a zero-length window", () => {
    const empty = { windowStartMs: 55_000, windowEndMs: 55_000, fps: 25 };
    expect(describePosition(55_000, SOURCE, empty).progress).toBe(0);
  });
});

describe("frame arithmetic at exact boundaries", () => {
  it("does not floor a frame early on floating-point noise", () => {
    // (1160 / 1000) * 25 is 28.999999999999996; the frame is 29. The export and the
    // worker guard the same way, and the three copies must agree.
    expect(frameIndexAt(1160, 25)).toBe(29);
    for (let i = 0; i < 10; i += 1) expect(frameIndexAt(1000 + 40 * i, 25)).toBe(25 + i);
  });
});
