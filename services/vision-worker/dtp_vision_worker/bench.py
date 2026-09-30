"""Spike S0's benchmark harness: the thing that produces the exit number.

`docs/vision/11-PHASE-PLAN.md` sets S0's exit criterion as a sentence DTP can say out
loud — *"a 96-minute Nigerian match takes X minutes to process and costs $Y on GPU Z"* —
and insists the baseline GPU be chosen on measurement rather than assumption. This module
produces that sentence, plus the JSON behind it, for one clip on one pod.

It lives inside the worker package rather than in a scratch script for one blunt reason:
the measurement has to run **in the image being measured**, on the pod, and the pod gets
the package and nothing else. A harness on a laptop measures a laptop.

Three properties matter more than convenience here, because the number goes into pricing
and investor conversations:

1. **It measures the production code path.** Sampling is `media.sample_frames`, the proxy
   is `media.transcode_proxy`, and the detection loop is `stages.detect.detect_frames` —
   the same function the stage calls. A second implementation of the loop would be
   measuring a paraphrase.
2. **Projections are labelled as projections.** A two-minute clip cannot tell you what a
   96-minute match costs; it can tell you a per-second rate to multiply. The report says
   which it did, and the sentence says "projected from" when it projected.
3. **Nothing about money is invented.** There is no built-in price table, because a
   hardcoded $/hour would be a guess reprinted as a measurement every time the harness
   runs. The operator passes the rate they are actually being billed, or the report comes
   out with the timings and no cost line.

Synthetic clips are supported (`--synthetic-minutes`) and are the honest way to shake the
plumbing down before a rights-cleared match exists, but they measure throughput only. See
`SYNTHETIC_CAVEATS`.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import platform
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .media import (
    DETECT_SAMPLE_FPS,
    PROXY_FPS,
    PROXY_HEIGHT,
    MediaError,
    probe,
    sample_frames,
    transcode_proxy,
)
from .stages.detect import Detector, detect_frames

log = logging.getLogger(__name__)

#: The match length the exit sentence is stated in. 96 minutes is 90 plus stoppage, which
#: is what a Nigerian grassroots recording actually runs to; quoting 90 would understate
#: every number by 7%.
MATCH_SECONDS = 96 * 60

#: What a synthetic clip does and does not tell you. Carried into the report so the caveats
#: travel with the numbers — a JSON file gets pasted into a spreadsheet long after whoever
#: ran it has forgotten which clip it was.
SYNTHETIC_CAVEATS = [
    "Detection counts are meaningless: there are no people or footballs in the frames, so "
    "people/balls/ballVisibilityPct measure nothing. Only the timings are real.",
    "Transcode time is understated: the clip is generated already at proxy resolution and "
    "frame rate, while a real source is 1080p or 4K and often variable-frame-rate.",
    "Bytes are not representative: synthetic content compresses far better than grass, "
    "crowd and motion blur, so transfer times scaled from this will be optimistic.",
]


# --------------------------------------------------------------------------------------
# The arithmetic. Pure, and therefore the part that is tested.
# --------------------------------------------------------------------------------------


def scale_to_match(
    seconds: float, clip_seconds: float, match_seconds: float = MATCH_SECONDS
) -> float:
    """Scale a measured time to a full match, linearly in clip length.

    Linear is the right model for the stages here — decode, sample and per-frame inference
    are all per-frame costs with no term that grows with duration — but it is still a
    model, which is why anything derived from it is labelled `projected`.
    """
    if clip_seconds <= 0:
        raise ValueError("clip length must be positive to scale from it")
    return seconds * (match_seconds / clip_seconds)


def cost_usd(seconds: float, usd_per_hour: float) -> float:
    """Pod cost for a span of wall-clock time.

    Wall clock, not GPU-busy time: a pod bills while FFmpeg runs and while weights
    download. Billing by utilisation would be a cheaper and wrong number.
    """
    if usd_per_hour < 0:
        raise ValueError("a negative hourly rate is not a rate")
    # Six places, not four. A short clip on a cheap card costs a few ten-thousandths of a
    # dollar, and rounding that to 0.0 turns a real measurement into "free".
    return round(seconds / 3600 * usd_per_hour, 6)


def budget_cents(usd: float) -> int:
    """The job budget implied by a cost, in whole cents, rounded **up**.

    `maxCostUsdCents` is a ceiling the dispatcher refuses jobs against, so rounding a
    measured 0.4 cents down to zero would make every job unaffordable by its own budget.

    The `max(1, ...)` is that same rule at the bottom of the scale, and it is here because
    a flaky test found it: a sub-hundredth-of-a-cent run -- which is what a short synthetic
    clip costs -- ceils to 1 only while the float is above zero. Anything that cost
    something gets a budget of at least one cent.
    """
    if usd <= 0:
        return 0
    return max(1, math.ceil(usd * 100))


def amortise(one_off_seconds: float, matches_per_pod: int) -> float:
    """Spread a once-per-pod cost over the matches that pod will process.

    Model weight download and CUDA warm-up happen once, not per match. Charging them to
    every match overstates the unit cost; ignoring them hides a real minute of billed
    time. The default of one match per pod is the pessimistic end, and honest for a spike
    where each pod does process exactly one clip.
    """
    if matches_per_pod < 1:
        raise ValueError("a pod processes at least one match")
    return one_off_seconds / matches_per_pod


def exit_statement(
    per_match_seconds: float,
    gpu: str,
    usd: float | None,
    *,
    measured: bool,
    clip_seconds: float,
) -> str:
    """S0's exit criterion, as the sentence the phase plan asks for."""
    minutes = per_match_seconds / 60
    cost = f"costs ${usd:.2f}" if usd is not None else "costs an unpriced amount"
    sentence = (
        f"A {MATCH_SECONDS // 60}-minute match takes {minutes:.1f} minutes "
        f"to process and {cost} on GPU {gpu}."
    )
    if not measured:
        sentence += (
            f" (Projected from a {clip_seconds:.0f}s clip, not measured end to end.)"
        )
    return sentence


# --------------------------------------------------------------------------------------
# Measurement plumbing.
# --------------------------------------------------------------------------------------


@dataclass
class Timer:
    """Wall-clock spans, in the order they happened."""

    spans: dict[str, float] = field(default_factory=dict)

    def time(self, name: str, fn: Callable[[], Any]) -> Any:
        start = time.perf_counter()
        try:
            return fn()
        finally:
            self.spans[name] = round(time.perf_counter() - start, 3)


class GpuSampler:
    """Poll `nvidia-smi` on a background thread for utilisation and VRAM.

    The phase plan asks for GPU and VRAM utilisation, and `torch.cuda.max_memory_allocated`
    only knows about torch's own allocator — it cannot see driver overhead or what FFmpeg
    is doing. `nvidia-smi` sees the card. Absent on a machine with no NVIDIA driver, in
    which case this reports nothing rather than guessing.
    """

    QUERY = "utilization.gpu,memory.used,memory.total"

    def __init__(self, interval: float = 1.0) -> None:
        self.interval = interval
        self.samples: list[tuple[float, float, float]] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def available(self) -> bool:
        return shutil.which("nvidia-smi") is not None

    def _read(self) -> tuple[float, float, float] | None:
        try:
            out = subprocess.run(
                [
                    "nvidia-smi",
                    f"--query-gpu={self.QUERY}",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                timeout=10,
                check=True,
            ).stdout.decode()
        except (OSError, subprocess.SubprocessError):
            return None
        lines = out.strip().splitlines()
        if not lines:
            return None
        parts = [p.strip() for p in lines[0].split(",")]
        if len(parts) < 3:
            return None
        try:
            return (float(parts[0]), float(parts[1]), float(parts[2]))
        except ValueError:
            return None

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            sample = self._read()
            if sample is not None:
                self.samples.append(sample)

    def start(self) -> GpuSampler:
        if self.available:
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()
        return self

    def stop(self) -> dict[str, Any] | None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        if not self.samples:
            return None
        utils = [s[0] for s in self.samples]
        used = [s[1] for s in self.samples]
        return {
            "samples": len(self.samples),
            "gpuUtilPctMean": round(sum(utils) / len(utils), 1),
            "gpuUtilPctPeak": round(max(utils), 1),
            "vramUsedMibPeak": round(max(used), 1),
            "vramTotalMib": round(self.samples[0][2], 1),
        }


def synthetic_clip(
    target: Path, seconds: float, fps: int = PROXY_FPS, height: int = PROXY_HEIGHT
) -> Path:
    """Generate a clip with motion and grain, for shaking the pipeline down.

    Not football, and not pretending to be: high-contrast rectangles on a pitch-green
    field, plus a small one for a ball. The two filters that matter are the moving boxes
    and the noise — a flat colour encodes to almost nothing and decodes almost instantly,
    which would make every timing here a fantasy. Grain is what real footage has and what
    makes the encoder work.
    """
    width = int(height * 16 / 9) // 2 * 2
    boxes = []
    for i in range(10):
        phase = i * 0.7
        boxes.append(
            "drawbox="
            f"x='{80 + i * 100}+60*sin(t/2+{phase:.2f})'"
            f":y='{height // 2}+120*cos(t/3+{phase:.2f})'"
            ":w=22:h=54:color=white@0.9:t=fill"
        )
    boxes.append(
        "drawbox="
        f"x='{width // 2}+300*sin(t/1.5)'"
        f":y='{height // 2}+80*sin(t)'"
        ":w=10:h=10:color=yellow@0.95:t=fill"
    )
    chain = ",".join(boxes) + ",noise=alls=8:allf=t"

    target.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-y",
        "-f", "lavfi",
        "-i", f"color=c=0x1b5e20:s={width}x{height}:r={fps}:d={seconds}",
        "-vf", chain,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        str(target),
    ]
    try:
        subprocess.run(
            cmd, capture_output=True, timeout=max(600.0, seconds * 4), check=True
        )
    except FileNotFoundError as exc:
        raise MediaError("ffmpeg is not installed here; no clip can be generated") from exc
    except subprocess.CalledProcessError as exc:
        tail = (exc.stderr or b"").decode("utf-8", "replace")[-2000:]
        raise MediaError(f"ffmpeg exited {exc.returncode}: {tail}") from exc
    if not target.exists() or target.stat().st_size == 0:
        raise MediaError("ffmpeg produced no synthetic clip")
    return target


@dataclass
class Pipeline:
    """The steps, injected.

    Every one of them is replaced in the tests: this machine has neither FFmpeg nor torch
    (itself an S0 finding — see `docs/vision/27-SPIKE-S0-SURPRISES.md`), and a harness that
    can only be exercised on the hardware it measures is a harness nobody checks before
    spending pod time on it.
    """

    obtain: Callable[[Path], tuple[Path, int]]
    probe: Callable[[Path], Any]
    transcode: Callable[[Path, Path], dict]
    sample: Callable[[Path, Path, float], Sequence[Path]]
    load_detector: Callable[[], Detector]


def default_pipeline(source: str, *, synthetic_seconds: float | None) -> Pipeline:
    """The real steps: ffmpeg, httpx and torchvision, as the stages use them."""

    def obtain(work_dir: Path) -> tuple[Path, int]:
        target = work_dir / "source.mp4"
        if synthetic_seconds is not None:
            synthetic_clip(target, synthetic_seconds)
            return target, target.stat().st_size
        if source.startswith(("http://", "https://")):
            # Timed like any other step, which is how "R2 ↔ worker transfer" in the phase
            # plan gets a real number: point --source at a presigned R2 GET.
            import httpx  # noqa: PLC0415 — only needed on this branch

            with httpx.stream("GET", source, timeout=600.0, follow_redirects=True) as r:
                r.raise_for_status()
                with target.open("wb") as fh:
                    for chunk in r.iter_bytes(1024 * 1024):
                        fh.write(chunk)
            return target, target.stat().st_size
        local = Path(source)
        if not local.exists():
            raise MediaError(f"no such clip: {local}")
        shutil.copyfile(local, target)
        return target, target.stat().st_size

    def load_detector() -> Detector:
        from .stages.detect import _torchvision_detector  # noqa: PLC0415 — imports torch

        return _torchvision_detector()

    return Pipeline(
        obtain=obtain,
        probe=probe,
        transcode=transcode_proxy,
        sample=lambda src, out, fps: sample_frames(src, out, fps=fps),
        load_detector=load_detector,
    )


def environment() -> dict[str, Any]:
    """What produced the number. A benchmark that cannot say this is an anecdote."""
    info: dict[str, Any] = {
        "python": platform.python_version(),
        "platform": platform.platform(),
    }
    try:
        import torch  # noqa: PLC0415

        info["torch"] = torch.__version__
        info["torchCuda"] = torch.version.cuda
        info["cudaAvailable"] = bool(torch.cuda.is_available())
        if torch.cuda.is_available():
            info["device"] = torch.cuda.get_device_name(0)
    except Exception as exc:  # torch is absent on a CPU box, which is not an error here
        info["torch"] = None
        info["torchImportError"] = str(exc)
    if shutil.which("ffmpeg"):
        try:
            out = subprocess.run(
                ["ffmpeg", "-version"], capture_output=True, timeout=30, check=True
            ).stdout.decode()
            info["ffmpeg"] = out.splitlines()[0] if out else None
        except (OSError, subprocess.SubprocessError):
            info["ffmpeg"] = "present, version unreadable"
    else:
        info["ffmpeg"] = None
    return info


def benchmark(
    pipeline: Pipeline,
    work_dir: Path,
    *,
    fps: float = DETECT_SAMPLE_FPS,
    usd_per_hour: float | None = None,
    gpu_label: str | None = None,
    matches_per_pod: int = 1,
    synthetic: bool = False,
    sampler: GpuSampler | None = None,
) -> dict[str, Any]:
    """Run the pipeline once, timing every step, and return the report.

    Deliberately one pass, not an average of several: the first pass on a fresh pod is the
    one that pays for the weight download and a cold page cache, and that is the pass
    production sees for the first match of every pod.
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    timer = Timer()
    watcher = (sampler or GpuSampler()).start()

    started = time.perf_counter()

    source, source_bytes = timer.time("obtain", lambda: pipeline.obtain(work_dir))
    probed = timer.time("probe", lambda: pipeline.probe(source))
    proxy = work_dir / "proxy.mp4"
    proxy_info = timer.time("transcode", lambda: pipeline.transcode(source, proxy))
    frames_dir = work_dir / "frames"
    # The proxy, not the source — the frame-index-to-timestamp arithmetic is only true of
    # a constant-frame-rate file. If the transcode stub did not produce one, the source is
    # all there is, and the report's probe block shows whether that was VFR.
    to_sample = proxy if proxy.exists() else source
    frames = timer.time("sample", lambda: pipeline.sample(to_sample, frames_dir, fps))
    # Timed apart from inference because it is once per pod, not once per match. Folding a
    # cold weight download into the per-match rate and then scaling it is how a spike
    # produces a cost that is wrong by a factor.
    detector = timer.time("loadDetector", pipeline.load_detector)
    outcome = timer.time("detect", lambda: detect_frames(frames, detector, fps=fps))

    total = round(time.perf_counter() - started, 3)
    gpu = watcher.stop()

    duration_ms = getattr(probed, "duration_ms", None)
    clip_seconds = (duration_ms / 1000) if duration_ms else 0.0
    if clip_seconds <= 0:
        # Falls back to the sampled frames, which is the one duration that is certainly
        # true: they exist, and they were taken at a known rate.
        clip_seconds = len(frames) / fps if fps else 0.0

    one_off = timer.spans.get("loadDetector", 0.0)
    per_clip = total - one_off
    measured = clip_seconds >= MATCH_SECONDS * 0.95

    scaled = scale_to_match(per_clip, clip_seconds) if clip_seconds > 0 else per_clip
    per_match = scaled + amortise(one_off, matches_per_pod)

    usd = cost_usd(per_match, usd_per_hour) if usd_per_hour is not None else None
    env = environment()
    gpu_name = gpu_label or env.get("device") or "unknown"

    report: dict[str, Any] = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "environment": env,
        "clip": {
            "synthetic": synthetic,
            "seconds": round(clip_seconds, 2),
            "sourceBytes": source_bytes,
            "probe": probed.as_summary() if hasattr(probed, "as_summary") else probed,
            "proxy": proxy_info,
        },
        "sampling": {"fps": fps, "frames": len(frames)},
        "detection": dict(outcome.summary),
        "secondsByStage": timer.spans,
        "totals": {
            "wallClockSeconds": total,
            "oncePerPodSeconds": one_off,
            "perClipSeconds": round(per_clip, 3),
            "matchesPerPod": matches_per_pod,
            "projectedMatchSeconds": round(per_match, 1),
            "projectedMatchMinutes": round(per_match / 60, 2),
            "measuredEndToEnd": measured,
        },
        "cost": {
            "usdPerHour": usd_per_hour,
            "usdPerMatch": usd,
            "budgetCents": budget_cents(usd) if usd is not None else None,
        },
        "gpu": gpu,
        "exit": exit_statement(
            per_match, gpu_name, usd, measured=measured, clip_seconds=clip_seconds
        ),
    }
    if synthetic:
        report["caveats"] = list(SYNTHETIC_CAVEATS)
        # The counts are in `detection` and someone will paste them into a deck; say
        # plainly, in the same object, that they mean nothing on a synthetic clip.
        report["detection"]["qualityMeaningful"] = False
    if gpu is None:
        report.setdefault("caveats", []).append(
            "No nvidia-smi output: GPU and VRAM utilisation were not measured, and these "
            "timings may be a CPU fallback rather than the card."
        )
    return report


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="dtp-vision-bench",
        description="Spike S0: measure one clip end to end and state the cost per match.",
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "--source", help="local path, or an https URL such as a presigned R2 GET"
    )
    src.add_argument(
        "--synthetic-minutes",
        type=float,
        help="generate a synthetic clip of this length instead (throughput only)",
    )
    parser.add_argument("--work-dir", default=Path("/tmp/dtp-vision/bench"), type=Path)
    parser.add_argument("--sample-fps", type=float, default=DETECT_SAMPLE_FPS)
    parser.add_argument(
        "--usd-per-hour",
        type=float,
        help="the rate this pod is actually billed at. Omit it and the report carries no "
        "cost line - there is no built-in price table, on purpose.",
    )
    parser.add_argument("--gpu-label", help='e.g. "RTX A6000", "L4", "RTX 4090"')
    parser.add_argument("--matches-per-pod", type=int, default=1)
    parser.add_argument(
        "--out", type=Path, help="write the JSON report here as well as to stdout"
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    synthetic_seconds = args.synthetic_minutes * 60 if args.synthetic_minutes else None
    pipeline = default_pipeline(args.source or "", synthetic_seconds=synthetic_seconds)

    report = benchmark(
        pipeline,
        Path(args.work_dir),
        fps=args.sample_fps,
        usd_per_hour=args.usd_per_hour,
        gpu_label=args.gpu_label,
        matches_per_pod=args.matches_per_pod,
        synthetic=synthetic_seconds is not None,
    )

    text = json.dumps(report, indent=2, default=str)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    print(text)
    # On stderr and last, so it survives being tailed out of a pod log.
    print(report["exit"], file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
