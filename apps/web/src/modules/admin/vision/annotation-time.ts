/**
 * Time and frame mathematics for the annotation workstation.
 *
 * Pure, and separated from the React tree on purpose: this is where labels get
 * silently corrupted, and it needs to be testable without a DOM or a video element.
 *
 * Three distinct clocks, never interchangeable:
 *
 *   - **source time** — milliseconds into the original match file. What the database
 *     stores, and what every label means.
 *   - **proxy time** — milliseconds into the transcoded clip the annotator is
 *     actually watching. Differs from source time by the proxy's offset.
 *   - **match clock** — what a viewer would call it. `47:12` on the match clock is
 *     not `47:12` in the file, and conflating them corrupts events.
 *
 * See docs/vision/08-FRONTEND.md § Non-negotiable behaviours.
 */

export type ProxyWindow = {
  /** Proxy-time bounds of the task's window, as the server computed them. */
  windowStartMs: number;
  windowEndMs: number;
  /** Constant frame rate of the proxy. Null when the transcode did not report it. */
  fps: number | null;
};

/** Source-time bounds, straight off the task row. */
export type SourceWindow = { startMs: number; endMs: number };

/**
 * How far the proxy is shifted from the source.
 *
 * Derived rather than passed separately, so the two can never disagree: the server
 * already computed proxy time from source time, and re-deriving the offset from both
 * is the only way to keep one source of truth.
 */
export function proxyOffsetMs(source: SourceWindow, proxy: ProxyWindow): number {
  return source.startMs - proxy.windowStartMs;
}

export function toProxyMs(sourceMs: number, offsetMs: number): number {
  return sourceMs - offsetMs;
}

export function toSourceMs(proxyMs: number, offsetMs: number): number {
  return proxyMs + offsetMs;
}

/**
 * The frame index a time falls on.
 *
 * `floor`, not `round`: a time is *inside* a frame until the next one begins, and
 * rounding would put a label on the following frame for anything past the halfway
 * point — a one-frame error on roughly half of all labels.
 *
 * Returns null without an fps rather than guessing 25. A guessed frame rate produces
 * labels that look precise and are wrong, which is worse than labels that admit they
 * are only millisecond-accurate.
 */
export function frameIndexAt(proxyMs: number, fps: number | null): number | null {
  if (!fps || fps <= 0 || !Number.isFinite(fps)) return null;
  return Math.max(0, Math.floor((proxyMs / 1000) * fps));
}

/**
 * The exact start of a frame, in proxy milliseconds.
 *
 * Seeking here rather than to an arbitrary millisecond is what makes the frame shown
 * the frame stored. Without it a seek lands mid-frame and the browser decides which
 * neighbour to display.
 */
export function frameStartMs(frameIndex: number, fps: number | null): number | null {
  if (!fps || fps <= 0 || !Number.isFinite(fps)) return null;
  return (frameIndex / fps) * 1000;
}

/** Steps whole frames, staying inside the window. */
export function stepFrames(
  proxyMs: number,
  frames: number,
  fps: number | null,
  window: ProxyWindow
): number {
  const current = frameIndexAt(proxyMs, fps);
  if (current === null) {
    // No frame rate: fall back to a tenth of a second per "frame" so the keyboard
    // still works, and let the caller's display say it is not frame-accurate.
    return clampToWindow(proxyMs + frames * 100, window);
  }
  const target = frameStartMs(Math.max(0, current + frames), fps);
  return clampToWindow(target ?? proxyMs, window);
}

export function clampToWindow(proxyMs: number, window: ProxyWindow): number {
  return Math.min(Math.max(proxyMs, window.windowStartMs), window.windowEndMs);
}

/** Whether a proxy time is inside the task's window at all. */
export function isInWindow(proxyMs: number, window: ProxyWindow): boolean {
  return proxyMs >= window.windowStartMs && proxyMs <= window.windowEndMs;
}

/**
 * `mm:ss.mmm`, with milliseconds always shown.
 *
 * Event boundaries are sub-second, so a display that hides milliseconds hides the
 * thing being judged. Hours appear only when there are hours, since a 90-minute
 * match reads better as `47:12.480` than `00:47:12.480`.
 */
export function formatClock(ms: number): string {
  const negative = ms < 0;
  const total = Math.abs(Math.round(ms));
  const millis = total % 1000;
  const seconds = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / 60_000) % 60;
  const hours = Math.floor(total / 3_600_000);

  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const body = hours
    ? `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`
    : `${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
  return negative ? `-${body}` : body;
}

/** A window's length, for the "how much footage is this" question. */
export function windowDurationMs(source: SourceWindow): number {
  return source.endMs - source.startMs;
}

/**
 * Everything the workstation needs to render one position, computed once.
 *
 * Both clocks are returned together and always displayed together, because the
 * failure this guards against is a reviewer reading one and believing the other.
 */
export type Position = {
  proxyMs: number;
  sourceMs: number;
  frameIndex: number | null;
  proxyClock: string;
  sourceClock: string;
  /** False when the proxy reported no frame rate, so the UI can say so. */
  frameAccurate: boolean;
  /** 0–1 through the task's window, for the scrubber. */
  progress: number;
};

export function describePosition(
  proxyMs: number,
  source: SourceWindow,
  proxy: ProxyWindow
): Position {
  const offset = proxyOffsetMs(source, proxy);
  const span = proxy.windowEndMs - proxy.windowStartMs;
  return {
    proxyMs,
    sourceMs: toSourceMs(proxyMs, offset),
    frameIndex: frameIndexAt(proxyMs, proxy.fps),
    proxyClock: formatClock(proxyMs),
    sourceClock: formatClock(toSourceMs(proxyMs, offset)),
    frameAccurate: Boolean(proxy.fps && proxy.fps > 0),
    progress: span > 0 ? Math.min(Math.max((proxyMs - proxy.windowStartMs) / span, 0), 1) : 0,
  };
}
