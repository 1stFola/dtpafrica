"""FFmpeg and FFprobe wrappers.

Everything here runs in the worker container, never on the control plane. FFmpeg
on a 90-minute match pins a CPU for a long time, and the control plane is a
2 vCPU box that also serves dtp.africa — see docs/vision/01-ARCHITECTURE.md.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

#: The proxy is constant-frame-rate by construction. That is what makes frame
#: seeking deterministic, and therefore what makes an annotation point at the
#: same moment after a re-transcode.
PROXY_FPS = 25
PROXY_HEIGHT = 720
PROXY_CRF = 23


class MediaError(RuntimeError):
    pass


@dataclass
class ProbeResult:
    container: str | None
    video_codec: str | None
    width: int | None
    height: int | None
    fps_numerator: int | None
    fps_denominator: int | None
    is_variable_frame_rate: bool
    duration_ms: int | None
    raw: dict

    def as_summary(self) -> dict:
        return {
            "container": self.container,
            "videoCodec": self.video_codec,
            "width": self.width,
            "height": self.height,
            "fpsNumerator": self.fps_numerator,
            "fpsDenominator": self.fps_denominator,
            "isVariableFrameRate": self.is_variable_frame_rate,
            "durationMs": self.duration_ms,
        }


#: What a child process may inherit. FFmpeg decodes untrusted media, so it gets the
#: names it needs to find itself, its libraries and a temp dir, and nothing else: no
#: worker token, no bootstrap token, no operator key (docs/vision/50, PR-1).
SUBPROCESS_ENV_KEYS = (
    "PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "TEMP", "TMP",
    "LD_LIBRARY_PATH", "SYSTEMROOT", "CUDA_VISIBLE_DEVICES",
    "NVIDIA_VISIBLE_DEVICES", "NVIDIA_DRIVER_CAPABILITIES",
)


def subprocess_env(source: dict[str, str] | None = None) -> dict[str, str]:
    """The environment for ffmpeg, ffprobe and nvidia-smi: an allow-list, never a copy."""
    source = os.environ if source is None else source
    return {key: source[key] for key in SUBPROCESS_ENV_KEYS if key in source}


def _run(cmd: list[str], timeout: float) -> subprocess.CompletedProcess[bytes]:
    log.debug("running %s", " ".join(cmd[:6]))
    try:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, check=True, env=subprocess_env())
    except FileNotFoundError as exc:
        raise MediaError(f"{cmd[0]} is not installed in this image") from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaError(f"{cmd[0]} timed out after {timeout}s") from exc
    except subprocess.CalledProcessError as exc:
        tail = (exc.stderr or b"").decode("utf-8", "replace")[-2000:]
        raise MediaError(f"{cmd[0]} exited {exc.returncode}: {tail}") from exc


def probe(path: Path, timeout: float = 300.0) -> ProbeResult:
    """Read container metadata without decoding the whole file."""
    out = _run(
        [
            "ffprobe",
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        timeout,
    )
    data = json.loads(out.stdout or b"{}")
    fmt = data.get("format") or {}
    video = next(
        (s for s in data.get("streams", []) if s.get("codec_type") == "video"),
        {},
    )

    num, den = _parse_rate(video.get("r_frame_rate"))
    avg_num, avg_den = _parse_rate(video.get("avg_frame_rate"))

    # A nominal rate that disagrees with the measured average means the source is
    # variable-frame-rate. Annotating VFR footage against wall-clock time is how
    # timestamps silently drift, so it is flagged rather than quietly accepted.
    vfr = False
    if num and den and avg_num and avg_den:
        vfr = abs(Fraction(num, den) - Fraction(avg_num, avg_den)) > Fraction(1, 100)

    duration = fmt.get("duration")
    duration_ms = int(float(duration) * 1000) if duration not in (None, "N/A") else None

    return ProbeResult(
        container=(fmt.get("format_name") or None),
        video_codec=video.get("codec_name"),
        width=_int(video.get("width")),
        height=_int(video.get("height")),
        fps_numerator=num,
        fps_denominator=den,
        is_variable_frame_rate=vfr,
        duration_ms=duration_ms,
        raw=data,
    )


def transcode_proxy(source: Path, target: Path, timeout: float = 14_400.0) -> dict:
    """Normalise to a constant-frame-rate H.264 proxy.

    Deliberately not a faithful copy: the proxy is sized for reviewability and
    model input, not fidelity. Ball detection uses a tiled high-resolution path
    over selected windows instead of a high-resolution proxy throughout, which is
    both cheaper and better.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-i", str(source),
            # Constant frame rate, and drop anything that is not the main video
            # and audio — subtitle and data streams break some decoders later.
            "-r", str(PROXY_FPS),
            "-vsync", "cfr",
            "-vf", f"scale=-2:{PROXY_HEIGHT}",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", str(PROXY_CRF),
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            str(target),
        ],
        timeout,
    )
    if not target.exists() or target.stat().st_size == 0:
        raise MediaError("ffmpeg reported success but produced no output")

    return {
        "fps": PROXY_FPS,
        "height": PROXY_HEIGHT,
        "crf": PROXY_CRF,
        "bytes": target.stat().st_size,
        # A settings hash lets a re-run be skipped rather than producing a subtly
        # different proxy that invalidates existing annotations.
        "settingsHash": settings_hash(),
        # Provenance, not identity: see settings_hash() for why this is recorded rather
        # than hashed.
        "encoder": encoder_version(),
    }


#: Frames per second sampled for detection.
#:
#: Two, not twenty-five. A detector does not need every frame to establish where
#: players are: at 2 fps a 96-minute match is about 11,500 frames rather than 144,000,
#: which is the difference between a spike that costs cents and one that costs dollars.
#: Tracking needs denser sampling and gets its own job type; S0 is measuring the floor.
DETECT_SAMPLE_FPS = 2


def sample_frames(
    source: Path,
    out_dir: Path,
    fps: float = DETECT_SAMPLE_FPS,
    timeout: float = 7_200.0,
) -> list[Path]:
    """Decode the proxy to still frames at a fixed rate.

    Written to disk rather than piped, because the detector reads them in batches and a
    failed run should leave the frames behind: re-sampling a 96-minute proxy to retry a
    model is the expensive half done twice.

    Names are zero-padded and ordered, and the index maps back to a proxy timestamp by
    `index / fps` -- which is only true because the proxy is constant-frame-rate by
    construction. On variable-frame-rate source this arithmetic silently drifts, which
    is why `probe` flags VFR and `transcode` forces CFR.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-i", str(source),
            "-vf", f"fps={fps}",
            # JPEG rather than PNG: a detector does not care about the last few percent
            # of fidelity, and PNG frames for a full match are gigabytes of disk.
            "-q:v", "2",
            str(out_dir / "frame_%06d.jpg"),
        ],
        timeout,
    )
    frames = sorted(out_dir.glob("frame_*.jpg"))
    if not frames:
        raise MediaError("ffmpeg reported success but sampled no frames")
    return frames


def frame_timestamp_ms(index: int, fps: float = DETECT_SAMPLE_FPS) -> int:
    """The proxy timestamp of a sampled frame, from its 1-based index.

    `frame_000001.jpg` is the frame at t=0, so the index is 1-based and the first frame
    sits at zero rather than at one interval in. Off by one here would put every
    detection half a second late for the whole match.
    """
    return int(round(((index - 1) / fps) * 1000))


def settings_hash() -> str:
    """The recipe, and deliberately only the recipe.

    It does **not** cover the encoder that runs the recipe, which matters more than it
    reads: the CPU image ships FFmpeg 5.1.9 (bookworm) and the GPU image 4.4.2 (jammy), so
    two workers can produce byte-different proxies under an identical hash -- the exact
    thing this hash exists to prevent. Folding the build string in here would be the
    obvious fix and the wrong one: every FFmpeg upgrade would invalidate every proxy and
    force a re-transcode of the whole corpus.

    So the encoder is recorded as provenance instead, by `encoder_version()`, and travels
    with the variant. What made a proxy is then answerable without asserting that any two
    proxies are identical.
    """
    recipe = f"h264:crf={PROXY_CRF}:fps={PROXY_FPS}:height={PROXY_HEIGHT}:pix=yuv420p"
    return hashlib.sha256(recipe.encode()).hexdigest()[:16]


def _parse_encoder_version(banner: str) -> str | None:
    """Pull the version out of `ffmpeg -version`, dropping the copyright tail.

    Separated from the subprocess call so it can be tested against the banners the two
    images actually print, neither of which this machine can produce.
    """
    first = banner.strip().splitlines()[0] if banner.strip() else ""
    match = re.match(r"^ffmpeg version (\S+)", first)
    if not match:
        return None
    return f"ffmpeg {match.group(1)}"


@lru_cache(maxsize=1)
def encoder_version() -> str | None:
    """Which FFmpeg build is in this image, e.g. `ffmpeg 5.1.9-0+deb12u1`.

    Cached: it cannot change while the process lives, and a transcode job should not pay
    for a subprocess to ask twice.

    libx264 has no separately reported build here -- `ffmpeg -version` names the library
    but not its version -- so the FFmpeg build string is the practical stand-in, and it is
    what changes when the base image changes.
    """
    try:
        out = subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, timeout=30, check=True, env=subprocess_env()
        ).stdout.decode("utf-8", "replace")
    except (OSError, subprocess.SubprocessError):
        # Not fatal. A proxy with no recorded encoder is worse than one with it, and far
        # better than a transcode that refused to run over a provenance detail.
        log.warning("could not read the ffmpeg version; the proxy will not record one")
        return None
    return _parse_encoder_version(out)


def thumbnail(source: Path, target: Path, at_ms: int, timeout: float = 120.0) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-ss", f"{at_ms / 1000:.3f}",
            "-i", str(source),
            "-frames:v", "1",
            "-q:v", "3",
            str(target),
        ],
        timeout,
    )


def frame_seek_seconds(frame_index: int, fps: float) -> float:
    """Where to seek so the first frame decoded is `frame_index`.

    FFmpeg keeps the first frame whose timestamp is at or after the seek point. A
    seek to exactly `n / fps` lands on frame n or n+1 depending on rounding in the
    container's timebase; a seek to half a frame before it lands on n every time.
    """
    return max(0.0, (frame_index - 0.5) / fps)


def decode_frame(source: Path, frame_index: int, fps: float, timeout: float = 120.0) -> tuple[int, int, bytes]:
    """One proxy frame at its native size as raw RGB bytes: (width, height, pixels).

    Native rather than scaled, because the boxes a caller brings are in the proxy's
    own pixels and the proxy's width is not written in a detect artifact; the frame
    itself says how wide it is. The caller samples a handful of frames per track,
    so a match costs hundreds of decodes rather than a hundred thousand.
    """
    probed = probe(source, timeout)
    width = probed.width
    if not width:
        raise MediaError("the proxy reports no width; its frames cannot be read")
    out = _run(
        [
            "ffmpeg",
            "-nostdin",
            "-ss", f"{frame_seek_seconds(frame_index, fps):.3f}",
            "-i", str(source),
            "-frames:v", "1",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-",
        ],
        timeout,
    )
    data = out.stdout
    if not data or len(data) % (width * 3) != 0:
        raise MediaError(f"ffmpeg returned {len(data)} bytes, not a whole {width}-wide RGB frame")
    return width, len(data) // (width * 3), data


def scene_changes(source: Path, threshold: float, timeout: float = 7_200.0) -> str:
    """FFmpeg's stderr with one `showinfo` line per frame whose scene-change score
    clears `threshold`, and a `metadata` line carrying the score.

    Nothing is encoded (`-f null`): the proxy is decoded once and the filter graph
    prints what it kept. `dtp_vision_worker.cuts.parse_showinfo` reads the result.
    """
    out = _run(
        [
            "ffmpeg",
            "-nostdin",
            "-i", str(source),
            "-vf", f"select='gt(scene,{threshold})',metadata=print,showinfo",
            "-an",
            "-f", "null",
            "-",
        ],
        timeout,
    )
    return (out.stderr or b"").decode("utf-8", "replace")


def sha256_file(path: Path, chunk: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(chunk):
            digest.update(block)
    return digest.hexdigest()


def perceptual_fingerprint(path: Path, samples: int = 16, timeout: float = 600.0) -> str | None:
    """A cheap content fingerprint, for grouping re-uploads of the same match.

    Samples evenly spaced frames, reduces each to an 8x8 grey thumbnail, and
    builds a difference hash. Survives re-encoding and rescaling, which is the
    point: the same match uploaded twice at different qualities must land in one
    duplicate cluster so it cannot be split across a train/test boundary.

    Returns None when the source is too short or unreadable to sample — an
    unknown fingerprint is better than a misleading one.
    """
    meta = probe(path)
    if not meta.duration_ms or meta.duration_ms < 2000:
        return None

    digest = hashlib.sha256()
    step = meta.duration_ms / (samples + 1)
    collected = 0

    for index in range(1, samples + 1):
        at_ms = int(step * index)
        try:
            out = _run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-ss", f"{at_ms / 1000:.3f}",
                    "-i", str(path),
                    "-frames:v", "1",
                    "-vf", "scale=9:8,format=gray",
                    "-f", "rawvideo",
                    "-",
                ],
                timeout,
            )
        except MediaError:
            continue

        frame = out.stdout
        if len(frame) < 72:
            continue

        # Difference hash: compare each pixel with its right-hand neighbour, so
        # the result depends on structure rather than absolute brightness.
        bits = bytearray()
        for row in range(8):
            base = row * 9
            acc = 0
            for col in range(8):
                acc = (acc << 1) | (1 if frame[base + col] > frame[base + col + 1] else 0)
            bits.append(acc)
        digest.update(bits)
        collected += 1

    if collected < max(3, samples // 4):
        return None
    return digest.hexdigest()


def _parse_rate(value: str | None) -> tuple[int | None, int | None]:
    if not value or "/" not in value:
        return None, None
    num, _, den = value.partition("/")
    try:
        n, d = int(num), int(den)
    except ValueError:
        return None, None
    return (n, d) if d else (None, None)


def _int(value: object) -> int | None:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
