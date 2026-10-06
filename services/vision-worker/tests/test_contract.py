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
from dtp_vision_worker.ball_trajectory import VERSION, INDEX_ROLE, CHUNK_ROLE, LOST_REASONS
from dtp_vision_worker import possession
from dtp_vision_worker import possession_constraints

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "vision-contracts" / "src"


def test_possession_contract_roles_version_and_unknown_reasons_match():
    source = _read("possession.ts")
    for name, value in (("POSSESSION_VERSION", possession.VERSION), ("POSSESSION_INDEX_ROLE", possession.INDEX_ROLE), ("POSSESSION_CHUNK_ROLE", possession.CHUNK_ROLE)):
        assert re.search(rf'{name}\s*=\s*"{value}"', source)
    assert _typescript_list(source, "POSSESSION_UNKNOWN_REASONS") == set(possession.UNKNOWN_REASONS)
    assert f'CALIBRATED_POSSESSION_VERSION = "{possession_constraints.VERSION}"' in source
    assert _typescript_list(source, "POSSESSION_CALIBRATED_REASONS") == set(possession_constraints.REASONS)


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


def test_ball_trajectory_states_and_artifact_roles_match_typescript() -> None:
    source = _read("ball-trajectory.ts")
    for name, value in [("BALL_TRAJECTORY_VERSION", VERSION), ("BALL_TRAJECTORY_INDEX_ROLE", INDEX_ROLE), ("BALL_TRAJECTORY_CHUNK_ROLE", CHUNK_ROLE)]:
        assert re.search(rf'{name}\s*=\s*"{value}"', source)
    block = re.search(r'BALL_LOST_REASONS\s*=\s*\[(.*?)\]', source, re.S)
    assert block and tuple(re.findall(r'"([a-z_]+)"', block.group(1))) == LOST_REASONS


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


def test_every_model_bound_job_type_the_contract_names_is_a_stage_here() -> None:
    """`MODEL_TASK_BY_JOB_TYPE` must only name stages this image implements. Naming
    one that does not exist would be S0-1 again: a job the control plane dispatches
    with a model version and no worker can claim. GPU or CPU is the stage's business:
    a detector needs a card, a tracker links stored boxes and does not."""
    source = _read("jobs.ts")
    block = re.search(r"MODEL_TASK_BY_JOB_TYPE[^=]*=\s*\{(.*?)\n\};", source, re.S)
    assert block, "MODEL_TASK_BY_JOB_TYPE not found in jobs.ts"
    bound = set(re.findall(r'(\w+):\s*"[a-z]+"', block.group(1)))
    assert bound, "the contract binds no job type to a model"
    assert bound <= set(STAGES), f"bound to a model but not implemented here: {bound - set(STAGES)}"


# ── which control plane this image serves (docs/vision/58) ──────────────────


def test_this_image_serves_a_control_plane_of_its_major_at_or_after_its_own_version() -> None:
    from dtp_vision_worker.config import contract_compatible

    assert contract_compatible("1.12.0", "1.12.0")
    # The control plane moved on and this image did not: it still serves, and the control
    # plane does not hand it the stages that changed.
    assert contract_compatible("1.13.0", "1.12.0")
    assert contract_compatible("1.12.1", "1.12.0")
    # As numbers: 1.9.0 is older than 1.12.0.
    assert not contract_compatible("1.9.0", "1.12.0")
    # A control plane behind this image has never heard of what it may send.
    assert not contract_compatible("1.11.0", "1.12.0")
    # Another major is another protocol.
    assert not contract_compatible("2.0.0", "1.12.0")
    assert not contract_compatible("0.12.0", "1.12.0")
    for unreadable in (None, "", "latest", "1.12", "1.12.0-rc1", 1.12, "v1.12.0"):
        assert not contract_compatible(unreadable, "1.12.0")
    assert contract_compatible(CONTRACT_VERSION)


def test_every_stage_in_the_compatibility_table_is_served_by_this_image() -> None:
    """The table says which version each stage last changed in. An image built from this
    commit must be at or past every entry, or the control plane would refuse it a stage."""
    source = _read("jobs.ts")
    block = re.search(r"STAGE_CONTRACT_SINCE[^=]*=\s*\{(.*?)\};", source, re.S)
    assert block, "STAGE_CONTRACT_SINCE not found in jobs.ts"
    entries = dict(re.findall(r'(\w+):\s*"(\d+\.\d+\.\d+)"', block.group(1)))
    assert entries, "no entries read from STAGE_CONTRACT_SINCE"
    mine = tuple(int(p) for p in CONTRACT_VERSION.split("."))
    for stage, since in entries.items():
        assert tuple(int(p) for p in since.split(".")) <= mine, f"{stage} changed in {since}; this image speaks {CONTRACT_VERSION}"
