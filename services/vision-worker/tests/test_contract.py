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
from dtp_vision_worker.stages import STAGES

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


def test_cpu_stages_are_routed_to_a_cpu_class() -> None:
    """Routing FFmpeg to a GPU pod means paying GPU rates for work that never
    touches the GPU. The contract's default must agree with what this image is."""
    source = _read("jobs.ts")
    block = re.search(r"DEFAULT_RESOURCE_CLASS[^=]*=\s*\{(.*?)\n\};", source, re.S)
    assert block, "DEFAULT_RESOURCE_CLASS not found in jobs.ts"
    routing = dict(re.findall(r"(\w+):\s*\"([a-z0-9_]+)\"", block.group(1)))

    for stage in STAGES:
        assert routing.get(stage) == "cpu_small", (
            f"{stage} is implemented in the CPU image but the contract routes it to "
            f"{routing.get(stage)!r}"
        )
