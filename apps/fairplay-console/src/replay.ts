/*
 * Replay loading and its measurement. A replay is a window of recorded video fetched from
 * the Edge (/edge/v1/media/...), which proxies MediaMTX's playback server after checking
 * the session. Every load is timed in this browser, from the request to the video's
 * `canplay`, and reported to the Edge: that is the "time to playable" the PID's p95 target
 * is about, measured where the operator sits, never estimated.
 */

import { post } from "./api";
import { mediaPath } from "./time";

export type LoadResult = { ok: boolean; toFirstFrameMs: number | null; toPlayableMs: number | null; error?: string };

export function loadWindow(video: HTMLVideoElement, source: string, startIngestMs: number, durationMs: number,
                           seekToS = 0, timeoutMs = 30_000): Promise<LoadResult> {
  const started = performance.now();
  let firstFrame: number | null = null;
  return new Promise((resolve) => {
    const done = (result: LoadResult) => {
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", onData);
      video.removeEventListener("canplay", onPlayable);
      video.removeEventListener("error", onError);
      resolve(result);
    };
    const onData = () => {
      firstFrame = Math.round(performance.now() - started);
    };
    const onPlayable = () => {
      if (seekToS > 0 && Math.abs(video.currentTime - seekToS) > 0.25) {
        video.currentTime = Math.min(seekToS, Math.max(0, (video.duration || seekToS) - 0.1));
      }
      done({ ok: true, toFirstFrameMs: firstFrame, toPlayableMs: Math.round(performance.now() - started) });
    };
    const onError = () => {
      done({ ok: false, toFirstFrameMs: firstFrame, toPlayableMs: null, error: video.error?.message || "no recording for this window" });
    };
    const timer = window.setTimeout(() => done({ ok: false, toFirstFrameMs: firstFrame, toPlayableMs: null, error: "timed out" }), timeoutMs);
    video.addEventListener("loadeddata", onData);
    video.addEventListener("canplay", onPlayable);
    video.addEventListener("error", onError);
    video.src = mediaPath(source, startIngestMs, durationMs);
    video.load();
  });
}

export async function report(source: string, startIngestIso: string, durationMs: number, result: LoadResult, note?: string) {
  try {
    await post("/edge/v1/metrics/replay", {
      source,
      windowStartUtc: startIngestIso,
      durationMs: Math.round(durationMs),
      toFirstFrameMs: result.toFirstFrameMs,
      toPlayableMs: result.toPlayableMs,
      outcome: result.ok ? "playable" : "error",
      note: note ?? result.error,
    });
  } catch {
    /* a lost measurement must never disturb replay */
  }
}

/*
 * Is 0.25× real on this device? Play the loaded window at 0.25× in a hidden, muted copy for
 * two seconds and see how far it moved. Some decoders accept the rate and then stall or
 * skip; if the movement is not within ±40 % of 0.5 s, 0.25× is not offered.
 */
export async function measureSlowRate(src: string): Promise<{ supported: boolean; advancedS: number | null }> {
  const probe = document.createElement("video");
  probe.muted = true;
  probe.preload = "auto";
  probe.src = src;
  try {
    await new Promise<void>((resolve, reject) => {
      probe.addEventListener("canplay", () => resolve(), { once: true });
      probe.addEventListener("error", () => reject(new Error("probe failed")), { once: true });
      window.setTimeout(() => reject(new Error("probe timed out")), 15_000);
    });
    probe.playbackRate = 0.25;
    const from = probe.currentTime;
    await probe.play();
    await new Promise((r) => window.setTimeout(r, 2000));
    const advanced = probe.currentTime - from;
    return { supported: advanced > 0.3 && advanced < 0.7, advancedS: advanced };
  } catch {
    return { supported: false, advancedS: null };
  } finally {
    probe.pause();
    probe.removeAttribute("src");
    probe.load();
  }
}

/** Plain-language warnings for a window's flags. Order matters: the worst first. */
export function warningsFor(sourceLabel: string, flags: string[], uncertaintyMs: number): string[] {
  const out: string[] = [];
  if (flags.includes("no_footage")) out.push(`No recording of ${sourceLabel} covers this moment.`);
  if (flags.includes("gap")) out.push(`Part of this window was not recorded on ${sourceLabel}.`);
  if (flags.includes("stale_after_reconnect")) out.push(`${sourceLabel} reconnected after it was calibrated — recalibrate before trusting its timing.`);
  if (flags.includes("uncalibrated")) out.push(`${sourceLabel} is not calibrated: its timing is uncertain by ±${uncertaintyMs} ms or more.`);
  if (flags.includes("uncertainty_high")) out.push(`${sourceLabel} timing uncertainty is high (±${uncertaintyMs} ms).`);
  return out;
}
