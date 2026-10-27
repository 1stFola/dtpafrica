"""Edge configuration: environment for settings and secrets, a TOML file for sources.

Every setting has one name, `FAIRPLAY_*`, listed in `.env.example`. The service refuses to
start on a missing or placeholder secret rather than running open: a venue network is
shared with spectators, so "works without a password" is the failure to prevent.
"""

from __future__ import annotations

import ipaddress
import os
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

ROLES = ("ground", "drone", "programme")
PROTOCOLS = ("rtsp", "srt", "rtmp")
_NAME = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
_DURATION = re.compile(r"^\d+(ms|s|m|h)$")
_PLACEHOLDER = re.compile(r"change[-_ ]?me|replace[-_ ]?me|example|placeholder", re.IGNORECASE)
MIN_SECRET_LENGTH = 24


class ConfigError(ValueError):
    """The configuration would leave the Edge unsafe or unusable; it must not start."""


@dataclass(frozen=True)
class Source:
    """One camera feed. `name` is also its MediaMTX path and its recordings folder."""

    name: str
    role: str
    required: bool
    protocol: str
    label: str

    @property
    def publish_user(self) -> str:
        return f"pub-{self.name}"

    @property
    def password_env(self) -> str:
        return f"FAIRPLAY_PUBLISH_PASSWORD_{self.name.upper().replace('-', '_')}"


@dataclass(frozen=True)
class Settings:
    sources: tuple[Source, ...]
    data_dir: Path
    recordings_dir: Path
    mediamtx_api_url: str
    mediamtx_playback_url: str
    mediamtx_user: str
    mediamtx_password: str
    api_token: str
    host_bind: str
    tls_cert: Path | None
    tls_key: Path | None
    segment_duration: str = "5m"
    part_duration: str = "1s"
    publish_allowed_cidrs: tuple[str, ...] = ()
    edge_ip: str = "127.0.0.1"
    poll_seconds: float = 2.0
    finalize_quiet_seconds: float = 10.0
    record_stall_seconds: float = 6.0
    disk_soft_free_bytes: int = 20 * 1024**3
    disk_hard_free_bytes: int = 5 * 1024**3
    retention_days: int | None = None
    retention_max_deletions: int = 50
    device_label: str = "edge"
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def manifests_dir(self) -> Path:
        return self.data_dir / "manifests"

    @property
    def repaired_dir(self) -> Path:
        return self.data_dir / "repaired"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "edge.sqlite3"

    def source(self, name: str) -> Source | None:
        return next((s for s in self.sources if s.name == name), None)


def load_sources(path: Path) -> tuple[Source, ...]:
    """Read `[[source]]` tables. Exactly one `ground` source is required (PID §5.1)."""
    try:
        doc = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"sources file not found: {path}") from exc
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"sources file is not valid TOML: {exc}") from exc
    raw = doc.get("source", [])
    if not isinstance(raw, list) or not raw:
        raise ConfigError("sources file declares no [[source]] tables")
    sources: list[Source] = []
    for entry in raw:
        name = str(entry.get("name", ""))
        role = str(entry.get("role", ""))
        protocol = str(entry.get("protocol", "rtsp"))
        if not _NAME.match(name):
            raise ConfigError(f"source name {name!r}: expected 1-32 chars of [a-z0-9_-], starting with a letter")
        if role not in ROLES:
            raise ConfigError(f"source {name}: role {role!r} is not one of {', '.join(ROLES)}")
        if protocol not in PROTOCOLS:
            raise ConfigError(f"source {name}: protocol {protocol!r} is not one of {', '.join(PROTOCOLS)}")
        sources.append(
            Source(
                name=name,
                role=role,
                required=bool(entry.get("required", role == "ground")),
                protocol=protocol,
                label=str(entry.get("label", name)),
            )
        )
    names = [s.name for s in sources]
    if len(set(names)) != len(names):
        raise ConfigError("source names must be unique")
    grounds = [s for s in sources if s.role == "ground"]
    if len(grounds) != 1:
        raise ConfigError(f"exactly one ground source is required, found {len(grounds)}")
    if not grounds[0].required:
        raise ConfigError("the ground source must be required")
    return tuple(sources)


def require_secret(env: dict[str, str], name: str) -> str:
    value = env.get(name, "")
    if not value:
        raise ConfigError(f"{name} is not set")
    if len(value) < MIN_SECRET_LENGTH:
        raise ConfigError(f"{name} is shorter than {MIN_SECRET_LENGTH} characters")
    if _PLACEHOLDER.search(value):
        raise ConfigError(f"{name} still holds the placeholder from .env.example")
    return value


def _duration(env: dict[str, str], name: str, default: str) -> str:
    value = env.get(name, default)
    if not _DURATION.match(value):
        raise ConfigError(f"{name}={value!r}: expected a duration such as 1s, 5m")
    return value


def _cidrs(value: str) -> tuple[str, ...]:
    out = []
    for part in filter(None, (p.strip() for p in value.split(","))):
        try:
            out.append(str(ipaddress.ip_network(part, strict=False)))
        except ValueError as exc:
            raise ConfigError(f"FAIRPLAY_PUBLISH_ALLOWED_CIDRS: {part!r} is not a network") from exc
    return tuple(out)


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def load_settings(env: dict[str, str] | None = None, *, need_api_token: bool = True) -> Settings:
    env = dict(os.environ if env is None else env)
    sources = load_sources(Path(env.get("FAIRPLAY_SOURCES_FILE", "/etc/fairplay/sources.toml")))
    data_dir = Path(env.get("FAIRPLAY_DATA_DIR", "/var/lib/fairplay/data"))
    recordings_dir = Path(env.get("FAIRPLAY_RECORDINGS_DIR", "/var/lib/fairplay/recordings"))
    host_bind = env.get("FAIRPLAY_EDGE_HOST_BIND", "127.0.0.1")
    tls_cert = Path(env["FAIRPLAY_EDGE_TLS_CERT"]) if env.get("FAIRPLAY_EDGE_TLS_CERT") else None
    tls_key = Path(env["FAIRPLAY_EDGE_TLS_KEY"]) if env.get("FAIRPLAY_EDGE_TLS_KEY") else None
    if bool(tls_cert) != bool(tls_key):
        raise ConfigError("set both FAIRPLAY_EDGE_TLS_CERT and FAIRPLAY_EDGE_TLS_KEY, or neither")
    # The API carries footage. Reachable only from this machine unless it is encrypted.
    if not is_loopback(host_bind) and tls_cert is None:
        raise ConfigError(
            f"FAIRPLAY_EDGE_HOST_BIND={host_bind} exposes the Edge API beyond this machine; "
            "that requires FAIRPLAY_EDGE_TLS_CERT and FAIRPLAY_EDGE_TLS_KEY"
        )
    retention = env.get("FAIRPLAY_RETENTION_DAYS", "").strip()
    retention_days = None
    if retention:
        if not retention.isdigit() or int(retention) < 1:
            raise ConfigError("FAIRPLAY_RETENTION_DAYS must be a whole number of days, at least 1")
        retention_days = int(retention)
    return Settings(
        sources=sources,
        data_dir=data_dir,
        recordings_dir=recordings_dir,
        mediamtx_api_url=env.get("FAIRPLAY_MEDIAMTX_API_URL", "http://127.0.0.1:9997").rstrip("/"),
        mediamtx_playback_url=env.get("FAIRPLAY_MEDIAMTX_PLAYBACK_URL", "http://127.0.0.1:9996").rstrip("/"),
        mediamtx_user=env.get("FAIRPLAY_MEDIAMTX_USER", "fairplay-edge"),
        mediamtx_password=require_secret(env, "FAIRPLAY_MEDIAMTX_PASSWORD"),
        api_token=require_secret(env, "FAIRPLAY_EDGE_API_TOKEN") if need_api_token else "",
        host_bind=host_bind,
        tls_cert=tls_cert,
        tls_key=tls_key,
        segment_duration=_duration(env, "FAIRPLAY_RECORD_SEGMENT_DURATION", "5m"),
        part_duration=_duration(env, "FAIRPLAY_RECORD_PART_DURATION", "1s"),
        publish_allowed_cidrs=_cidrs(env.get("FAIRPLAY_PUBLISH_ALLOWED_CIDRS", "")),
        edge_ip=env.get("FAIRPLAY_EDGE_IP", "127.0.0.1"),
        poll_seconds=float(env.get("FAIRPLAY_POLL_SECONDS", "2")),
        finalize_quiet_seconds=float(env.get("FAIRPLAY_FINALIZE_QUIET_SECONDS", "10")),
        record_stall_seconds=float(env.get("FAIRPLAY_RECORD_STALL_SECONDS", "6")),
        disk_soft_free_bytes=int(float(env.get("FAIRPLAY_DISK_SOFT_FREE_GB", "20")) * 1024**3),
        disk_hard_free_bytes=int(float(env.get("FAIRPLAY_DISK_HARD_FREE_GB", "5")) * 1024**3),
        retention_days=retention_days,
        retention_max_deletions=int(env.get("FAIRPLAY_RETENTION_MAX_DELETIONS", "50")),
        device_label=env.get("FAIRPLAY_DEVICE_LABEL", "edge"),
    )
