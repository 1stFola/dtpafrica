"""Cross-language contract guard.

The contract version and the job-type list exist in TypeScript
(`packages/vision-contracts`) and are mirrored here in Python. That duplication is
the drift risk the contracts package was created to prevent, so it is asserted
rather than trusted.

Until the JSON Schema emitter lands, this test IS the emitter's job: it reads the
TypeScript source and fails if the two sides disagree. A bumped
VISION_CONTRACT_VERSION that nobody mirrored here would otherwise show up as a
worker silently refusing every claim in production.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.stages import CPU_STAGES, GPU_STAGES, STAGES
from dtp_vision_worker.stages.detect import ARTIFACT_ROLE, CONTRACT_CLASSES, DETECTION_CLASS_BY_LABEL

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "vision-contracts" / "src"


def _read(name: str) -> str:
    """Read a TypeScript contract file, skipping only where it cannot exist.

    The skip is for the Docker image, which copies just this worker package and so
    has no monorepo to read. **In CI it must never fire**: this guard is the only
    thing checking the two languages agree, and a silent skip would let the pipeline
    go green having verified nothing.
    """
    path = CONTRACTS / name
    if not path.exists():  # pragma: no cover
        if os.environ.get("CI"):
            raise AssertionError(
                f"Contracts package not found at {path}, but CI is set. The "
                "cross-language guard must not be skipped here — check the checkout."
            )
        pytest.skip(f"contracts package not available at {path}")
    return path.read_text(encoding="utf-8")


def test_contract_version_matches_typescript() -> None:
    source = _read("jobs.ts")
    match = re.search(r'VISION_CONTRACT_VERSION\s*=\s*"([^"]+)"', source)
    assert match, "VISION_CONTRACT_VERSION not found in jobs.ts"
    assert CONTRACT_VERSION == match.group(1), (
        f"Python speaks {CONTRACT_VERSION}, TypeScript speaks {match.group(1)}. "
        "Bump dtp_vision_worker.config.CONTRACT_VERSION to match."
    )


def test_every_stage_is_a_declared_job_type() -> None:
    source = _read("jobs.ts")
    block = re.search(r"VISION_JOB_TYPES\s*=\s*\[(.*?)\]", source, re.S)
    assert block, "VISION_JOB_TYPES not found in jobs.ts"
    declared = set(re.findall(r'"([a-z_]+)"', block.group(1)))

    unknown = set(STAGES) - declared
    assert not unknown, f"This image implements job types the contract does not declare: {unknown}"


def _routing() -> dict[str, str]:
    source = _read("jobs.ts")
    block = re.search(r"DEFAULT_RESOURCE_CLASS[^=]*=\s*\{(.*?)\n\};", source, re.S)
    assert block, "DEFAULT_RESOURCE_CLASS not found in jobs.ts"
    return dict(re.findall(r"(\w+):\s*\"([a-z0-9_]+)\"", block.group(1)))


def test_cpu_stages_are_routed_to_a_cpu_class() -> None:
    """Routing FFmpeg to a GPU pod means paying GPU rates for work that never touches
    the GPU. That is a cost rather than an error: it would run perfectly and bill wrongly.

    This asserted that *every* implemented stage was CPU, which held while the package
    had only CPU stages. One package now serves both images — `detect` imports torch
    lazily so the CPU image can still load the registry — so the invariant is stated per
    class instead of assumed for all."""
    routing = _routing()
    for stage in CPU_STAGES:
        assert routing.get(stage) == "cpu_small", (
            f"{stage} never touches a GPU but the contract routes it to "
            f"{routing.get(stage)!r}"
        )


def test_gpu_stages_are_not_routed_to_a_cpu_class() -> None:
    """The other direction, which the old assertion could not catch.

    A GPU stage routed to `cpu_small` would be scheduled onto a pod with no CUDA, fall
    back to CPU inference and take hours — and the only symptom would be a job that
    looked slow."""
    routing = _routing()
    for stage in GPU_STAGES:
        assert routing.get(stage, "").startswith("gpu_"), (
            f"{stage} needs CUDA but the contract routes it to {routing.get(stage)!r}"
        )


def _typescript_list(source: str, name: str) -> set[str]:
    block = re.search(name + r"\s*=\s*\[(.*?)\]", source, re.S)
    assert block, f"{name} not found"
    return set(re.findall(r'"([a-z_]+)"', block.group(1)))


def test_detection_classes_mirror_the_contract() -> None:
    """The stage mirrors `DETECTION_CLASSES` so it can refuse a label the review UI has
    never heard of. A mirror that drifted would let the worker write a class nothing
    downstream can display -- or refuse one it should accept."""
    declared = _typescript_list(_read("prediction.ts"), "DETECTION_CLASSES")
    assert set(CONTRACT_CLASSES) == declared, (
        f"Python mirrors {sorted(CONTRACT_CLASSES)}, TypeScript declares {sorted(declared)}"
    )
    for cls in DETECTION_CLASS_BY_LABEL.values():
        assert cls in declared, f"the baseline maps onto {cls!r}, which the contract does not declare"


def test_ball_unknown_is_a_declared_quality_flag() -> None:
    """The stage flags a frame with no ball as `ball_unknown`. If the contract ever
    renames the flag, the artifact would carry a value the envelope rejects."""
    assert "ball_unknown" in _typescript_list(_read("prediction.ts"), "QUALITY_FLAGS")


def test_the_artifact_role_matches_the_contract() -> None:
    source = _read("prediction.ts")
    match = re.search(r'DETECTION_ARTIFACT_ROLE\s*=\s*"([a-z_]+)"', source)
    assert match, "DETECTION_ARTIFACT_ROLE not found in prediction.ts"
    assert ARTIFACT_ROLE == match.group(1)


def test_every_model_bound_job_type_the_contract_names_is_a_gpu_stage_here() -> None:
    """`MODEL_TASK_BY_JOB_TYPE` must only name stages this image implements on a GPU.
    Naming one that does not exist would be S0-1 again: a job the control plane
    dispatches with a model version and no worker can claim."""
    source = _read("jobs.ts")
    block = re.search(r"MODEL_TASK_BY_JOB_TYPE[^=]*=\s*\{(.*?)\n\};", source, re.S)
    assert block, "MODEL_TASK_BY_JOB_TYPE not found in jobs.ts"
    bound = set(re.findall(r'(\w+):\s*"[a-z]+"', block.group(1)))
    assert bound, "the contract binds no job type to a model"
    assert bound <= GPU_STAGES, f"bound to a model but not a GPU stage here: {bound - GPU_STAGES}"
