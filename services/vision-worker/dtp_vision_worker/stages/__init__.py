"""Pipeline stages.

Each stage is a pure-ish function of (job spec, a working directory, the control
plane client) returning artifacts plus a small structured summary. Bulk output
goes to object storage; only the summary comes back over HTTP.

Increment 2 shipped the three CPU stages; `detect` is the first GPU one. They are what turn an uploaded file into
something reproducibly analysable, and none of them needs a GPU — routing them to
one would mean paying GPU rates for FFmpeg.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from .benchmark import run_benchmark
from .ball_trajectory import run_ball_trajectory
from .possession import run_possession
from .events import run_events
from .cuts import run_cuts
from .detect import run_detect
from .fingerprint import run_fingerprint
from .gamestate import run_gamestate
from .identify import run_identify
from .probe import run_probe
from .track import run_track
from .transcode import run_transcode

if TYPE_CHECKING:  # pragma: no cover
    from ..runner import StageContext, StageResult

StageHandler = Callable[["StageContext"], "StageResult"]

STAGES: dict[str, StageHandler] = {
    "probe": run_probe,
    "fingerprint": run_fingerprint,
    "transcode": run_transcode,
    # CPU: compares stored predictions with stored truth. The predictions needed a
    # card; the comparison does not.
    "benchmark": run_benchmark,
    # CPU: links stored detections frame to frame. No model stack; an algorithm
    # registered as one, so every track names its tracker.
    "track": run_track,
    # CPU: a few decoded frames per track, a colour histogram each, two clusters.
    "identify": run_identify,
    # CPU: FFmpeg's scene-change score over the proxy, proposing camera segments.
    "cuts": run_cuts,
    # CPU: every track's foot point in metres through the declared calibrations, as Parquet.
    "gamestate": run_gamestate,
    "ball_trajectory": run_ball_trajectory,
    "possession": run_possession,
    "events": run_events,
    # GPU. Imports torch lazily inside the handler, so the CPU image can load this
    # registry without the model stack installed.
    "detect": run_detect,
}

#: Stages that never touch a GPU.
#:
#: Named rather than inferred, because the consequence of getting it wrong is a cost
#: rather than an error: FFmpeg on a GPU pod works perfectly and bills at GPU rates.
#: `tests/test_contract.py` checks both of these against the contract's routing table.
CPU_STAGES = frozenset({"probe", "fingerprint", "transcode", "benchmark", "track", "identify", "cuts", "gamestate", "ball_trajectory", "possession", "events"})

#: Stages that need CUDA and the model stack, and so only run on the GPU image.
GPU_STAGES = frozenset({"detect"})

# Every stage is one or the other. A stage in neither would be routed by whatever the
# contract happened to say, unchecked.
assert set(STAGES) == CPU_STAGES | GPU_STAGES

__all__ = [
    "CPU_STAGES",
    "GPU_STAGES",
    "STAGES",
    "StageHandler",
    "run_benchmark",
    "run_ball_trajectory",
    "run_possession",
    "run_events",
    "run_cuts",
    "run_detect",
    "run_fingerprint",
    "run_gamestate",
    "run_identify",
    "run_probe",
    "run_track",
    "run_transcode",
]
