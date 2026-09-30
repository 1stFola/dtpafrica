"""The benchmark harness: the arithmetic behind S0's exit number.

The number this produces goes into pricing and investor conversations, so the ways it
could be quietly wrong are worth pinning down: a one-off cost scaled as if it were
per-match, a projection presented as a measurement, a synthetic clip's detection counts
read as if they meant something.

FFmpeg and torch are both absent here, so `Pipeline` is injected whole. That is why it is
injectable.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest

from dtp_vision_worker import bench


# --------------------------------------------------------------------------------------
# Arithmetic
# --------------------------------------------------------------------------------------


def test_scales_a_clip_to_a_match() -> None:
    # 12s of work on a 120s clip is 96 minutes' worth at the same rate.
    assert bench.scale_to_match(12, 120) == pytest.approx(12 * (96 * 60 / 120))


def test_refuses_to_scale_from_a_clip_of_no_length() -> None:
    """Dividing by zero here would produce `inf` minutes and an `inf` price, and the
    report would print it without complaint."""
    with pytest.raises(ValueError, match="positive"):
        bench.scale_to_match(10, 0)


def test_cost_is_wall_clock_not_gpu_busy_time() -> None:
    assert bench.cost_usd(3600, 0.79) == 0.79
    assert bench.cost_usd(900, 0.79) == pytest.approx(0.1975)


def test_budget_rounds_cents_up() -> None:
    """A budget is a ceiling. Rounding 0.4 cents down to zero would make the job
    unaffordable by its own budget the moment anything used this number."""
    assert bench.budget_cents(0.004) == 1
    assert bench.budget_cents(0.20) == 20
    assert bench.budget_cents(0.201) == 21


def test_a_run_that_cost_something_never_gets_a_zero_budget() -> None:
    """Found by this suite going flaky: a fast synthetic clip on a cheap card costs a few
    hundred-thousandths of a dollar, and a budget of 0 cents refuses the very job that
    produced the measurement. Only a genuinely free run is free."""
    assert bench.budget_cents(0.000004) == 1
    assert bench.budget_cents(0.0) == 0


@pytest.mark.parametrize("seconds", [3600.0, 1.0, 0.01, 0.002, 0.0005, 1e-9])
def test_a_positive_runtime_never_costs_nothing(seconds: float) -> None:
    """The half of that bug the first fix missed, and the reason CI failed where three
    local runs passed.

    `budget_cents` was guarded, but `cost_usd` rounded to six places, so below about 2.3ms
    of billed time a positive cost became exactly 0.0 before the budget ever saw it. A
    hosted runner does the stubbed pipeline fast enough to cross that line; a Windows
    laptop does not. Asserting it on the arithmetic rather than through wall clock is what
    makes it a test instead of a coin toss."""
    usd = bench.cost_usd(seconds, 0.79)
    assert usd > 0, "a run that took time did not cost anything"
    assert bench.budget_cents(usd) >= 1


def test_only_a_zero_runtime_is_free() -> None:
    assert bench.cost_usd(0, 0.79) == 0.0
    assert bench.budget_cents(0.0) == 0


def test_one_off_cost_is_amortised_not_charged_to_every_match() -> None:
    assert bench.amortise(60, 1) == 60
    assert bench.amortise(60, 10) == 6


def test_a_pod_processes_at_least_one_match() -> None:
    with pytest.raises(ValueError):
        bench.amortise(60, 0)


def test_exit_statement_reads_as_the_phase_plan_asks() -> None:
    said = bench.exit_statement(
        14 * 60, "RTX A6000", 0.1975, measured=True, clip_seconds=96 * 60
    )
    assert said == (
        "A 96-minute match takes 14.0 minutes to process and costs $0.20 on GPU RTX A6000."
    )


def test_a_projection_says_so() -> None:
    """The failure mode this exists to stop: a two-minute clip's extrapolation being
    quoted as a measured unit cost."""
    said = bench.exit_statement(
        840, "L4", 0.05, measured=False, clip_seconds=120
    )
    assert "Projected from a 120s clip" in said


def test_an_unpriced_run_does_not_invent_a_price() -> None:
    said = bench.exit_statement(840, "L4", None, measured=True, clip_seconds=96 * 60)
    assert "unpriced" in said
    assert "$" not in said


# --------------------------------------------------------------------------------------
# A whole run, with every step stubbed
# --------------------------------------------------------------------------------------


class FakeProbe:
    def __init__(self, duration_ms: int | None) -> None:
        self.duration_ms = duration_ms

    def as_summary(self) -> dict[str, Any]:
        return {"durationMs": self.duration_ms}


def pipeline(
    tmp_path: Path, *, frames: int = 4, duration_ms: int | None = 120_000
) -> bench.Pipeline:
    def obtain(work_dir: Path) -> tuple[Path, int]:
        source = work_dir / "source.mp4"
        source.write_bytes(b"x" * 2048)
        return source, 2048

    def transcode(_source: Path, target: Path) -> dict:
        target.write_bytes(b"proxy")
        return {"bytes": 5}

    def sample(_source: Path, out_dir: Path, _fps: float) -> list[Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        made = []
        for i in range(1, frames + 1):
            path = out_dir / f"frame_{i:06d}.jpg"
            path.write_bytes(b"jpeg")
            made.append(path)
        return made

    return bench.Pipeline(
        obtain=obtain,
        probe=lambda _p: FakeProbe(duration_ms),
        transcode=transcode,
        sample=sample,
        load_detector=lambda: (lambda batch: [[] for _ in batch]),
    )


class NoGpu(bench.GpuSampler):
    """A box with no NVIDIA driver, which is every box this suite runs on."""

    @property
    def available(self) -> bool:
        return False


def test_reports_every_stage_and_the_exit_sentence(tmp_path: Path) -> None:
    report = bench.benchmark(
        pipeline(tmp_path),
        tmp_path / "work",
        usd_per_hour=0.79,
        gpu_label="RTX A6000",
        sampler=NoGpu(),
    )

    assert set(report["secondsByStage"]) == {
        "obtain",
        "probe",
        "transcode",
        "sample",
        "loadDetector",
        "detect",
    }
    assert report["sampling"]["frames"] == 4
    assert "RTX A6000" in report["exit"]
    assert report["cost"]["usdPerMatch"] is not None
    # The same invariant as `test_a_positive_runtime_never_costs_nothing`, end to end. This
    # is the assertion CI failed on: the stubbed pipeline is fast enough on a hosted runner
    # that the projected match cost rounded to zero.
    assert report["cost"]["budgetCents"] >= 1
    # Serialisable, because it is written to a file and pasted into a spreadsheet.
    json.loads(json.dumps(report, default=str))


def test_a_short_clip_is_not_claimed_as_measured(tmp_path: Path) -> None:
    report = bench.benchmark(
        pipeline(tmp_path, duration_ms=120_000), tmp_path / "work", sampler=NoGpu()
    )
    assert report["totals"]["measuredEndToEnd"] is False
    assert report["clip"]["seconds"] == 120.0
    assert "Projected" in report["exit"]


def test_a_full_match_is_claimed_as_measured(tmp_path: Path) -> None:
    report = bench.benchmark(
        pipeline(tmp_path, duration_ms=96 * 60 * 1000), tmp_path / "work", sampler=NoGpu()
    )
    assert report["totals"]["measuredEndToEnd"] is True
    assert "Projected" not in report["exit"]


def test_clip_length_falls_back_to_the_frames_that_exist(tmp_path: Path) -> None:
    """ffprobe not reporting a duration is common on a stream copy or a truncated
    download. The frames are still on disk at a known rate, and that beats dividing by
    zero."""
    report = bench.benchmark(
        pipeline(tmp_path, frames=10, duration_ms=None),
        tmp_path / "work",
        fps=2.0,
        sampler=NoGpu(),
    )
    assert report["clip"]["seconds"] == 5.0


def test_model_load_is_not_scaled_with_the_clip(tmp_path: Path) -> None:
    """The bug this guards: a 60s weight download on a 120s clip, scaled linearly, adds
    48 minutes of imaginary work to every match and roughly quadruples the quoted cost.
    """
    plan = pipeline(tmp_path, duration_ms=120_000)
    slow = bench.Pipeline(
        obtain=plan.obtain,
        probe=plan.probe,
        transcode=plan.transcode,
        sample=plan.sample,
        load_detector=plan.load_detector,
    )
    report = bench.benchmark(slow, tmp_path / "work", matches_per_pod=1, sampler=NoGpu())

    totals = report["totals"]
    one_off = report["secondsByStage"]["loadDetector"]
    per_clip = totals["perClipSeconds"]
    expected = bench.scale_to_match(per_clip, 120.0) + one_off
    assert totals["projectedMatchSeconds"] == pytest.approx(round(expected, 1), abs=0.2)


def test_more_matches_per_pod_lowers_the_per_match_number(tmp_path: Path) -> None:
    """A pod that processes twenty matches pays for its weights once.

    The detector load is made deliberately slow here, and this took two goes to get right.
    With the stubbed pipeline the load costs microseconds, so the amortised difference sat
    inside the scheduling noise of two runs and the comparison decided itself on a coin
    toss. At 50ms it then sat below the report's own resolution -- `projectedMatchSeconds`
    is rounded to a tenth, which is ample for a 96-minute match and useless here. Half a
    second clears both, so what is compared is the arithmetic rather than the machine.

    The cost is a second of suite time. Worth it: a test that fails on a busy runner and
    passes on a quiet one teaches nobody anything."""
    load = 0.5

    def slow(work: Path) -> bench.Pipeline:
        plan = pipeline(work)

        def load_detector():
            time.sleep(load)
            return lambda batch: [[] for _ in batch]

        return bench.Pipeline(
            obtain=plan.obtain,
            probe=plan.probe,
            transcode=plan.transcode,
            sample=plan.sample,
            load_detector=load_detector,
        )

    once = bench.benchmark(
        slow(tmp_path / "a"), tmp_path / "a", matches_per_pod=1, sampler=NoGpu()
    )
    shared = bench.benchmark(
        slow(tmp_path / "b"), tmp_path / "b", matches_per_pod=20, sampler=NoGpu()
    )

    saved = (
        once["totals"]["projectedMatchSeconds"]
        - shared["totals"]["projectedMatchSeconds"]
    )
    # 19/20ths of the one-off. The tolerance covers the report rounding to a tenth at both
    # ends plus whatever the sleep overshoots by.
    assert saved == pytest.approx(load * 19 / 20, abs=0.12)


def test_a_synthetic_run_says_its_detection_counts_mean_nothing(tmp_path: Path) -> None:
    """The whole reason a synthetic clip is safe to use: the report refuses to let its
    detection numbers be read as a finding about Nigerian footage."""
    report = bench.benchmark(
        pipeline(tmp_path), tmp_path / "work", synthetic=True, sampler=NoGpu()
    )
    assert report["detection"]["qualityMeaningful"] is False
    assert any("meaningless" in c for c in report["caveats"])


def test_a_run_with_no_nvidia_smi_admits_it_measured_no_gpu(tmp_path: Path) -> None:
    """Otherwise a CPU fallback on a mispriced pod reads as a GPU benchmark."""
    report = bench.benchmark(pipeline(tmp_path), tmp_path / "work", sampler=NoGpu())
    assert report["gpu"] is None
    assert any("nvidia-smi" in c for c in report["caveats"])


def test_detection_counts_come_from_the_stage_and_not_a_copy(tmp_path: Path) -> None:
    """The summary keys are the stage's, because the harness calls the stage's loop. If
    `detect_frames` changes shape, this fails rather than the benchmark drifting from the
    thing it claims to measure."""
    report = bench.benchmark(pipeline(tmp_path), tmp_path / "work", sampler=NoGpu())
    for key in ("framesSampled", "detections", "people", "balls", "framesWithBall"):
        assert key in report["detection"]


def test_a_missing_local_clip_fails_before_any_pod_time_is_spent(tmp_path: Path) -> None:
    plan = bench.default_pipeline(str(tmp_path / "absent.mp4"), synthetic_seconds=None)
    with pytest.raises(Exception, match="no such clip"):
        plan.obtain(tmp_path)
