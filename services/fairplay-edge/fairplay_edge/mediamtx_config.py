"""Render MediaMTX's configuration from the sources file and the environment.

MediaMTX 1.21.3's defaults are written for a lab, not a venue: an anonymous user may
publish, read and play back from any IP; RTSP, RTMP, HLS, WebRTC, SRT and MoQ listeners
are all on, three of them with `AllowOrigins: ["*"]`; `overridePublisher: true` lets a
second client take over a path; and `recordDeleteAfter: 1d` deletes recordings after a day.
Every one of those is set here explicitly, because a key left out falls back to that
default. See docs/fairplay/architecture.md §3.

The output is JSON, which is valid YAML, so no YAML library is needed.
"""

from __future__ import annotations

import json
import secrets
from pathlib import Path

from cryptography.exceptions import InvalidKey
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id

from .config import ConfigError, Settings, require_secret

MEDIAMTX_VERSION = "1.21.3"
RECORD_NAME = "%Y-%m-%d_%H-%M-%S-%f_%z"

# Listeners FairPlay never uses. Named so a test can assert each is off.
ALWAYS_OFF = ("webrtc", "moq", "metrics", "pprof")


# Argon2id cost for MediaMTX's `argon2:` form. MediaMTX checks the hash on every
# authenticated request, including each live-preview part the Edge fetches, so the cost is
# the one MediaMTX's own documentation uses rather than a login-page setting. The secrets
# themselves are random tokens of 24+ characters; the hash keeps them out of the file.
ARGON2_MEMORY_KIB = 4096
ARGON2_ITERATIONS = 3
ARGON2_LANES = 1


def hashed(secret: str) -> str:
    """MediaMTX's `argon2:` form: an Argon2id PHC string with a random salt."""
    kdf = Argon2id(salt=secrets.token_bytes(16), length=32, iterations=ARGON2_ITERATIONS,
                   lanes=ARGON2_LANES, memory_cost=ARGON2_MEMORY_KIB)
    return "argon2:" + kdf.derive_phc_encoded(secret.encode())


def matches(secret: str, stored: str) -> bool:
    """True if `stored` (as written by `hashed`) is the hash of `secret`."""
    if not stored.startswith("argon2:"):
        return False
    try:
        Argon2id.verify_phc_encoded(secret.encode(), stored[len("argon2:"):])
        return True
    except InvalidKey:
        return False


def render(settings: Settings, env: dict[str, str], *, mode: str = "docker") -> dict:
    if mode not in ("docker", "native"):
        raise ConfigError(f"mode {mode!r}: expected docker or native")
    if not settings.publish_allowed_cidrs:
        raise ConfigError(
            "FAIRPLAY_PUBLISH_ALLOWED_CIDRS is empty; MediaMTX reads an empty list as "
            "'any IP', so the networks cameras publish from must be named"
        )
    protocols = {s.protocol for s in settings.sources}
    # Docker: other containers must reach the API, so it listens on the compose network
    # and only the Edge's fixed address may use it. Native: loopback only.
    control_host = "" if mode == "docker" else "127.0.0.1"
    edge_ips = [settings.edge_ip] if mode == "docker" else ["127.0.0.1", "::1"]
    record_root = "/recordings" if mode == "docker" else settings.recordings_dir.as_posix()

    users = [
        {
            "user": source.publish_user,
            "pass": hashed(require_secret(env, source.password_env)),
            "ips": list(settings.publish_allowed_cidrs),
            "permissions": [{"action": "publish", "path": source.name}],
        }
        for source in settings.sources
    ]
    users.append(
        {
            "user": settings.mediamtx_user,
            "pass": hashed(settings.mediamtx_password),
            "ips": edge_ips,
            # `read` is for the live preview over HLS, which the Edge proxies after its own
            # authorisation; no browser ever talks to MediaMTX.
            "permissions": [{"action": "api"}, {"action": "playback"}, {"action": "read"}],
        }
    )

    return {
        "logLevel": "info",
        "logDestinations": ["stdout"],
        "logStructured": True,
        "readTimeout": "10s",
        "writeTimeout": "10s",
        "authMethod": "internal",
        "authInternalUsers": users,
        "api": True,
        "apiAddress": f"{control_host}:9997",
        "apiEncryption": False,
        "apiAllowOrigins": [],
        "apiTrustedProxies": [],
        "playback": True,
        "playbackAddress": f"{control_host}:9996",
        "playbackEncryption": False,
        "playbackAllowOrigins": [],
        "playbackTrustedProxies": [],
        "metrics": False,
        "pprof": False,
        # Live preview (Phase 2). Reachable only on the compose network (Docker) or loopback
        # (native), only with the Edge's credentials, never published, no cross-origin reads.
        # fMP4 segments, because the console's player appends them with Media Source Extensions.
        "hls": True,
        "hlsAddress": f"{control_host}:8888",
        "hlsEncryption": False,
        "hlsAllowOrigins": [],
        "hlsTrustedProxies": [],
        "hlsAlwaysRemux": False,
        "hlsVariant": "fmp4",
        "hlsSegmentCount": 7,
        "hlsSegmentDuration": "1s",
        "hlsMuxerCloseAfter": "60s",
        "webrtc": False,
        "moq": False,
        "rtsp": "rtsp" in protocols,
        # TCP only: survives NAT (Docker Desktop, venue routers) and needs one port.
        "rtspTransports": ["tcp"],
        "rtspEncryption": "no",
        "rtspAddress": ":8554",
        "rtspAuthMethods": ["basic"],
        "rtmp": "rtmp" in protocols,
        "rtmpEncryption": "no",
        "rtmpAddress": ":1935",
        "srt": "srt" in protocols,
        "srtAddress": ":8890",
        "pathDefaults": {
            "source": "publisher",
            # Record whenever a configured source publishes, whatever the Edge is doing:
            # an Edge restart must never stop a recording (ADR-0011).
            "record": True,
            "recordPath": f"{record_root}/%path/{RECORD_NAME}",
            "recordFormat": "fmp4",
            "recordPartDuration": settings.part_duration,
            "recordMaxPartSize": "50M",
            "recordSegmentDuration": settings.segment_duration,
            # Retention is the Edge's, because only it knows which segments are protected.
            "recordDeleteAfter": "0s",
            "overridePublisher": False,
            "useAbsoluteTimestamp": False,
        },
        # Only configured sources exist; a publish to any other path is refused.
        "paths": {source.name: {} for source in settings.sources},
    }


def write(settings: Settings, env: dict[str, str], target: Path, *, mode: str = "docker") -> None:
    body = render(settings, env, mode=mode)
    header = (
        f"# Generated by `fairplay-edge render-mediamtx` for MediaMTX {MEDIAMTX_VERSION}.\n"
        "# Do not edit: change sources.toml or the environment and render again.\n"
        "# Passwords are stored as Argon2id hashes; none appears in plain text.\n"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".tmp")
    tmp.write_text(header + json.dumps(body, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target)
