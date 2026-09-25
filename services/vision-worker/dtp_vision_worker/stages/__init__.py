"""Pipeline stages.

Each stage is a pure-ish function of (job spec, a working directory, the control
plane client) returning artifacts plus a small structured summary. Bulk output
goes to object storage; only the summary comes back over HTTP.

Increment 2 ships the three CPU stages. They are what turn an uploaded file into
something reproducibly analysable, and none of them needs a GPU — routing them to
one would mean paying GPU rates for FFmpeg.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from .fingerprint import run_fingerprint
from .probe import run_probe
from .transcode import run_transcode

if TYPE_CHECKING:  # pragma: no cover
    from ..runner import StageContext, StageResult

StageHandler = Callable[["StageContext"], "StageResult"]

STAGES: dict[str, StageHandler] = {
    "probe": run_probe,
    "fingerprint": run_fingerprint,
    "transcode": run_transcode,
}

__all__ = ["STAGES", "StageHandler", "run_probe", "run_fingerprint", "run_transcode"]
