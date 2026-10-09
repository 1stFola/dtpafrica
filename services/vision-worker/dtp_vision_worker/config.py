"""Worker configuration, entirely from the environment.

A worker learns three things and nothing else: where to call back, a token to get
started, and which resource classes it may claim. No storage credentials, no
database connection, no provider SDK configuration — see
docs/vision/06-JOBS-AND-COMPUTE.md.

That is the portability requirement in practice: the same image runs on any CUDA
host, or none, because it knows nothing about whose hardware it is on.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

CONTRACT_VERSION = "1.19.0"

DEFAULT_POLL_SECONDS = 5.0
DEFAULT_HEARTBEAT_SECONDS = 30.0


class ConfigError(RuntimeError):
    """Raised at startup so a misconfigured worker dies loudly, not mid-job."""


@dataclass(frozen=True)
class WorkerConfig:
    callback_url: str
    bootstrap_token: str
    resource_classes: tuple[str, ...]
    image: str
    poll_seconds: float = DEFAULT_POLL_SECONDS
    heartbeat_seconds: float = DEFAULT_HEARTBEAT_SECONDS
    # Drain the queue then exit. The commonest way to burn GPU budget is a pod
    # nobody noticed, so idling is a deliberate decision with a deadline.
    idle_shutdown_seconds: float = 120.0
    work_dir: str = "/tmp/dtp-vision"
    verify_tls: bool = True
    extra: dict[str, str] = field(default_factory=dict)


def _require(env: dict[str, str], key: str, problems: list[str]) -> str:
    value = env.get(key, "").strip()
    if not value:
        problems.append(f"{key} is required")
    return value


def _float(env: dict[str, str], key: str, default: float, problems: list[str]) -> float:
    raw = env.get(key, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        problems.append(f"{key} must be a number, got {raw!r}")
        return default
    if value <= 0:
        problems.append(f"{key} must be positive, got {value}")
        return default
    return value


def load_config(env: dict[str, str] | None = None) -> WorkerConfig:
    env = dict(os.environ if env is None else env)
    problems: list[str] = []

    callback = _require(env, "VISION_WORKER_CALLBACK_URL", problems)
    bootstrap = _require(env, "VISION_BOOTSTRAP_TOKEN", problems)

    raw_classes = env.get("VISION_RESOURCE_CLASS", "").strip()
    classes = tuple(c.strip() for c in raw_classes.split(",") if c.strip())
    if not classes:
        problems.append("VISION_RESOURCE_CLASS is required (comma-separated)")

    config = WorkerConfig(
        callback_url=callback.rstrip("/"),
        bootstrap_token=bootstrap,
        resource_classes=classes,
        image=env.get("VISION_WORKER_IMAGE", "dtp-vision-engine:dev").strip(),
        poll_seconds=_float(env, "VISION_POLL_SECONDS", DEFAULT_POLL_SECONDS, problems),
        heartbeat_seconds=_float(
            env, "VISION_HEARTBEAT_SECONDS", DEFAULT_HEARTBEAT_SECONDS, problems
        ),
        idle_shutdown_seconds=_float(env, "VISION_IDLE_SHUTDOWN_SECONDS", 120.0, problems),
        work_dir=env.get("VISION_WORK_DIR", "/tmp/dtp-vision").strip() or "/tmp/dtp-vision",
        # Only ever disabled against a local control plane with a self-signed cert.
        verify_tls=env.get("VISION_VERIFY_TLS", "true").strip().lower() not in {"0", "false", "no"},
    )

    if problems:
        raise ConfigError("Invalid worker configuration:\n  - " + "\n  - ".join(problems))
    return config


def _parse_version(version: object) -> tuple[int, int, int] | None:
    if not isinstance(version, str):
        return None
    parts = version.split(".")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    return int(parts[0]), int(parts[1]), int(parts[2])


def contract_compatible(control_version: object, worker_version: str = CONTRACT_VERSION) -> bool:
    """Whether a control plane speaking `control_version` can be served by this image.

    The worker's half of the rule in `packages/vision-contracts` (`workerCompatibility`,
    docs/vision/58): the same major version, and the control plane no older than this
    image. It used to be exact equality, which retired every image at every bump,
    including the bumps that changed no stage.

    A control plane *ahead* of this image is fine: it knows which stages have changed
    since this image was built and does not hand them over. A control plane *behind* it
    is not, because this image may send what that control plane has never heard of.
    """
    control = _parse_version(control_version)
    worker = _parse_version(worker_version)
    if control is None or worker is None:
        return False
    return control[0] == worker[0] and control >= worker
