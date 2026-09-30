"""The benchmark harness: the arithmetic behind S0's exit number.

The number this produces goes into pricing and investor conversations, so the ways it
could be quietly wrong are worth pinning down: a one-off cost scaled as if it were
per-match, a projection presented as a measurement, a synthetic clip's detection counts
read as if they meant something.

FFmpeg and torch are both absent here, so `Pipeline` is injected whole. That is why it is
injectable.
"""

from __future__ import annotations

import itertools
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


def test_the_timer_keeps_a_step_too_fast_to_print() -> None:
    """Where the zero-cost bug actually lived, and the one place it can be caught without
    a fast machine.

    `Timer` rounded each span to a millisecond as it recorded it. A step finishing in 400
    microseconds was stored as exactly 0.0, so on a hosted runner the whole stubbed
    pipeline measured zero seconds -- and zero seconds costs zero dollars and gets a zero
    budget, however carefully the arithmetic downstream is guarded. Rounding a measurement
    is a thing to do on the way out, not on the way in.

    This reproduces on any machine, which the two assertions it replaces did not."""
    timer = bench.Timer()
    timer.time("instant", lambda: None)

    assert timer.spans["instant"] > 0, "a step that ran was recorded as taking no time"
    # And the report still prints something a human can read.
    assert timer.rounded()["instant"] == 0.0


def test_a_runner_faster_than_this_machine_still_bills(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The hosted runner, simulated deterministically instead of hoped for.

    This bug reached CI twice because the only thing that reproduced it was a machine
    quick enough to finish the stubbed pipeline inside a millisecond, and the machine it
    was written on is not. Pinning the clock removes the hardware from the question: every
    step here takes ten microseconds, which is faster than anything real and exactly the
    regime where rounding used to eat the measurement."""
    ticks = itertools.count(0.0, 1e-5)
    monkeypatch.setattr(bench.time, "perf_counter", lambda: next(ticks))

    report = bench.benchmark(
        pipeline(tmp_path), tmp_path / "work", usd_per_hour=0.79, sampler=NoGpu()
    )

    # `wallClockSeconds` legitimately rounds to 0.0 for display at this speed. What must
    # not be zero is anything the arithmetic or the invoice is built from.
    assert report["totals"]["projectedMatchSeconds"] > 0
    assert report["cost"]["usdPerMatch"] > 0
    assert report["cost"]["budgetCents"] >= 1


def test_an_instant_pipeline_still_costs_something(tmp_path: Path) -> None:
    """The end of the same chain: every step below a millisecond, and the run still bills.

    This is the CI failure in one assertion. It passed locally and failed on a hosted
    runner twice, because the stubbed pipeline there completes in under half a
    millisecond."""
    report = bench.benchmark(
        pipeline(tmp_path), tmp_path / "work", usd_per_hour=0.79, sampler=NoGpu()
    )
    assert report["totals"]["projectedMatchSeconds"] > 0
    assert report["cost"]["usdPerMatch"] > 0
    assert report["cost"]["budgetCents"] >= 1


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


def test_model_load_is_not_scaled_with_the_clip(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The bug this guards: a 60s weight download on a 120s clip, scaled linearly, adds 48
    minutes of imaginary work to every match and roughly quadruples the quoted cost.

    On a pinned clock the whole thing is exact arithmetic. Every reading is a second apart,
    so the run measures 13 seconds of wall clock, of which the detector load is 1 and the
    remaining 12 are per-clip work. A 120s clip scales by 48, so the right answer is
    12*48 + 1 = 577 seconds. Scaling the load along with everything else would give
    13*48 = 624, and no tolerance can hide that."""
    ticks = itertools.count(0.0, 1.0)
    monkeypatch.setattr(bench.time, "perf_counter", lambda: next(ticks))

    report = bench.benchmark(
        pipeline(tmp_path, duration_ms=120_000),
        tmp_path / "work",
        matches_per_pod=1,
        sampler=NoGpu(),
    )

    totals = report["totals"]
    one_off = report["secondsByStage"]["loadDetector"]
    per_clip = totals["perClipSeconds"]
    assert one_off == pytest.approx(1.0)

    expected = bench.scale_to_match(per_clip, 120.0) + one_off
    assert totals["projectedMatchSeconds"] == pytest.approx(expected, abs=1e-6)
    # Spelled out, so a future reader sees the arithmetic without re-deriving it.
    assert per_clip == pytest.approx(12.0)
    assert totals["projectedMatchSeconds"] == pytest.approx(577.0, abs=1e-6)

def test_more_matches_per_pod_lowers_the_per_match_number(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A pod that processes twenty matches pays for its weights once.

    Third attempt, and the first that is a test rather than a race. Comparing two
    wall-clock runs cannot work here however slow the injected work is made: `per_clip` is
    multiplied by the 96-minute scale factor, so three milliseconds of file-system jitter
    between the runs becomes 0.14 seconds of difference and swamps the amortisation being
    measured. Injecting a 500ms load narrowed it to about one failure in six.

    Pinning the clock removes wall clock from the question entirely: every reading is one
    second apart, both runs measure identically, and the only difference left between them
    is the arithmetic under test. It is also a second faster than the sleep it replaces."""
    step = 1.0
    ticks = itertools.count(0.0, step)
    monkeypatch.setattr(bench.time, "perf_counter", lambda: next(ticks))

    once = bench.benchmark(
        pipeline(tmp_path), tmp_path / "a", matches_per_pod=1, sampler=NoGpu()
    )
    shared = bench.benchmark(
        pipeline(tmp_path), tmp_path / "b", matches_per_pod=20, sampler=NoGpu()
    )

    saved = (
        once["totals"]["projectedMatchSeconds"]
        - shared["totals"]["projectedMatchSeconds"]
    )
    # The one-off costs one tick, and nineteen twentieths of it stop being charged.
    assert saved == pytest.approx(step * 19 / 20, abs=1e-6)
    assert once["totals"]["oncePerPodSeconds"] == pytest.approx(step)

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
