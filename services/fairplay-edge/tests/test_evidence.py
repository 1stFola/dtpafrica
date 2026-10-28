"""Phase 3: evidence clips.

Two kinds of test. Those marked `needs_ffmpeg` cut real H.264 recordings with the real
ffmpeg (they run in the Edge image and skip where ffmpeg is absent). The rest use a fake
cutter, so the job and integrity logic is tested everywhere, CI included.
"""

import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest

from fairplay_edge import audit, evidence, incidents, timing
from fairplay_edge.audit import Actor
from fairplay_edge.manifest import Scanner
from fairplay_edge.probe import Probe, sha256_file

from .conftest import at, fmp4, segment_name, write_segment
from .schema_check import errors

OP = Actor("u-op", "Operator", "operator")
SCHEMA = json.loads(evidence.SCHEMA_FILE.read_text(encoding="utf-8"))
needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg (runs in the Edge image)")


class FakeCutter:
    """Concatenates the input files and reports the requested duration. Never in production."""

    name = "fake"

    def version(self) -> str:
        return "fake 1"

    def __init__(self, first_keyframe: float = 0.0):
        self.calls = 0
        self.fail_with: Exception | None = None
        self.first_keyframe = first_keyframe
        self.drop: tuple[float, float] | None = None  # a hole to leave in the output, in clip seconds
        self.extra_frames = 0  # footage repeated in the output

    def cut(self, pieces, target):
        self.calls += 1
        if self.fail_with:
            raise self.fail_with
        target.write_bytes(b"".join(Path(p["path"]).read_bytes() for p in pieces))
        self._ms = round(sum(p["spanS"] for p in pieces) * 1000)
        return ["fake", str(len(pieces))]

    def probe(self, path):
        return Probe(codec="h264", profile="High", width=1280, height=720, fps="25/1", time_base="1/90000",
                     start_pts=0, start_time_s=0.0, duration_ms=self._ms, has_audio=False, raw={})

    def first_keyframe_s(self, path):
        return self.first_keyframe

    def keyframe_before_s(self, path, at_s):
        return at_s

    def video_pts(self, path):
        frames = [i * 0.04 for i in range(round(self._ms / 40) + self.extra_frames)]
        if self.drop:
            frames = [p for p in frames if not self.drop[0] <= p < self.drop[1]]
        return frames


@pytest.fixture
def session(store):
    return timing.create_session(store, "Lions v Eagles", "match-123", "shadow", "u-op")


def finalise_all(settings, store):
    Scanner(settings, store).scan({})  # nothing publishing, quiet period 0: every file is final


def flag(store, settings, session, seconds=40):
    return incidents.create(store, settings, session["id"], OP, event_utc=at(seconds), basis="manual", category="foul")


# ── fake cutter: the job and integrity rules ──────────────────────────────

@pytest.fixture
def ten_second_segments(settings, store, fake_probe):
    """Ground recorded 0-60 s in six 10 s segments (the fake probe says 10 s each)."""
    for t in range(0, 60, 10):
        write_segment(settings.recordings_dir, "ground", at(t), fmp4(3))
    finalise_all(settings, store)


def test_clip_names_exact_sources_and_hashes(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    job, created = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    assert created and job["window_start_utc"] == "2026-10-27T14:00:20.000Z" and job["window_duration_ms"] == 30_000
    done = evidence.run_job(store, settings, FakeCutter(), job["id"])
    assert done["state"] == "succeeded"
    ev = evidence.get(store, done["evidence_id"])
    expected = store.query("SELECT id, sha256 FROM segments WHERE start_utc >= ? AND start_utc < ? ORDER BY start_utc",
                           ("2026-10-27T14:00:20.000Z", "2026-10-27T14:00:50.000Z"))
    assert ev["source_segment_ids"] == [r["id"] for r in expected]
    manifest = json.loads(evidence.path_of(settings, ev, "manifest_rel_path").read_text(encoding="utf-8"))
    assert [s["sha256"] for s in manifest["sources"]] == [r["sha256"] for r in expected]
    assert all(s["verifiedSha256AtCut"] == s["sha256"] for s in manifest["sources"])
    assert manifest["derivative"]["sha256"] == ev["sha256"] == sha256_file(evidence.path_of(settings, ev))
    assert sha256_file(evidence.path_of(settings, ev, "manifest_rel_path")) == ev["manifest_sha256"]
    assert ev["coverage"] == "full" and manifest["coverage"]["gaps"] == []
    assert errors(manifest, SCHEMA) == []
    created_entry = [e for e in audit.for_incident(store, inc["id"]) if e["action"] == "evidence.created"]
    assert created_entry[0]["detail"]["manifestSha256"] == ev["manifest_sha256"]


def test_asking_twice_returns_the_first_job(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    first, created = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    again, created_again = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    assert created and not created_again and again["id"] == first["id"]
    evidence.run_job(store, settings, FakeCutter(), first["id"])
    after, created_after = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    assert not created_after and after["id"] == first["id"]  # done already: no second cut
    assert store.one("SELECT COUNT(*) AS n FROM evidence")["n"] == 1


def test_no_footage_fails_and_makes_no_file(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    job, _ = evidence.request_clip(store, settings, inc["id"], "drone", OP)  # the drone recorded nothing
    done = evidence.run_job(store, settings, FakeCutter(), job["id"])
    assert (done["state"], done["error_code"]) == ("failed", "no_footage")
    assert store.one("SELECT COUNT(*) AS n FROM evidence")["n"] == 0
    assert not list(settings.evidence_dir.rglob("*.mp4*"))


def test_missing_source_is_refused(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    victim = store.one("SELECT rel_path FROM segments WHERE start_utc = '2026-10-27T14:00:30.000Z'")
    (settings.recordings_dir / victim["rel_path"]).unlink()
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    done = evidence.run_job(store, settings, FakeCutter(), job["id"])
    assert (done["state"], done["error_code"]) == ("failed", "source_missing")
    assert store.one("SELECT COUNT(*) AS n FROM evidence")["n"] == 0
    assert [e["action"] for e in audit.for_incident(store, inc["id"])][-1] == "evidence.failed"


def test_changed_source_is_refused(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    victim = settings.recordings_dir / store.one("SELECT rel_path FROM segments WHERE start_utc ="
                                                 " '2026-10-27T14:00:20.000Z'")["rel_path"]
    victim.chmod(0o644)
    victim.write_bytes(fmp4(3, mdat_bytes=65))
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    done = evidence.run_job(store, settings, FakeCutter(), job["id"])
    assert (done["state"], done["error_code"]) == ("failed", "source_mismatch")


def test_a_gap_makes_a_partial_clip_that_says_so(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    with store.tx() as db:  # the 30-40 s segment was unreadable
        db.execute("UPDATE segments SET state = 'corrupt' WHERE start_utc = '2026-10-27T14:00:30.000Z'")
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    ev = evidence.get(store, evidence.run_job(store, settings, FakeCutter(), job["id"])["evidence_id"])
    manifest = json.loads(evidence.path_of(settings, ev, "manifest_rel_path").read_text(encoding="utf-8"))
    assert ev["coverage"] == "partial" and ev["covered_ms"] == 20_000
    assert manifest["coverage"]["gaps"] == [{"fromUtc": "2026-10-27T14:00:30.000Z", "toUtc": "2026-10-27T14:00:40.000Z",
                                             "durationMs": 10_000, "kind": "not_recorded"}]
    assert manifest["coverage"]["unusedSegments"][0]["state"] == "corrupt"


def test_a_segment_still_recording_makes_the_job_wait(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    with store.tx() as db:
        db.execute("UPDATE segments SET state = 'recording' WHERE start_utc = '2026-10-27T14:00:40.000Z'")
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    waiting = evidence.run_job(store, settings, FakeCutter(), job["id"])
    assert waiting["state"] == "queued" and waiting["attempts"] == 0 and "still being recorded" in waiting["error"]


def test_interrupted_job_is_rerun_after_a_restart(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    # The Edge died mid-cut: the job says running, and half a clip is on disk.
    with store.tx() as db:
        db.execute("UPDATE jobs SET state = 'running', attempts = 1 WHERE id = ?", (job["id"],))
    half = settings.evidence_dir / session["id"] / inc["id"] / "dead.mp4.part"
    half.parent.mkdir(parents=True, exist_ok=True)
    half.write_bytes(b"\x00" * 100)
    assert evidence.recover(store, settings) == [job["id"]]
    assert not half.exists()
    assert store.one("SELECT state FROM jobs WHERE id = ?", (job["id"],))["state"] == "queued"
    done = evidence.run_job(store, settings, FakeCutter(), job["id"])
    assert done["state"] == "succeeded" and done["attempts"] == 2


def test_unexpected_cut_errors_retry_then_fail(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    cutter = FakeCutter()
    cutter.fail_with = OSError("disk full")
    for _ in range(settings.clip_max_attempts):
        with store.tx() as db:
            db.execute("UPDATE jobs SET next_attempt_utc = '2000-01-01T00:00:00.000Z' WHERE id = ?", (job["id"],))
        last = evidence.run_job(store, settings, cutter, job["id"])
    assert (last["state"], last["error_code"], cutter.calls) == ("failed", "cut_failed", settings.clip_max_attempts)
    assert not list(settings.evidence_dir.rglob("*.mp4*"))


def test_evidence_is_gathered_before_the_finding(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    inc = incidents.start_review(store, inc["id"], 1, OP)
    incidents.complete_review(store, inc["id"], 2, OP, result="inconclusive", factual_notes="View is blocked.",
                              on_field_decision=None, evidence_ids=[], footage_states={"ground": "ok"})
    with pytest.raises(timing.Conflict, match="reopen"):
        evidence.request_clip(store, settings, inc["id"], "ground", OP)


def test_evidence_files_are_read_only_and_checked_before_use(store, settings, session, ten_second_segments):
    inc = flag(store, settings, session)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    ev = evidence.get(store, evidence.run_job(store, settings, FakeCutter(), job["id"])["evidence_id"])
    clip = evidence.path_of(settings, ev)
    assert clip.stat().st_mode & 0o222 == 0
    clip.chmod(0o644)
    clip.write_bytes(clip.read_bytes() + b"\x00")
    with pytest.raises(evidence.ClipFailed, match="no longer matches"):
        evidence.verify_file(store, settings, ev)
    assert store.one("SELECT 1 FROM alerts WHERE kind = 'evidence_mismatch' AND resolved_utc IS NULL")


def test_evidence_protects_its_sources_from_retention(store, settings, session, ten_second_segments):
    from datetime import timedelta

    from fairplay_edge import retention

    inc = flag(store, settings, session)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    ev = evidence.get(store, evidence.run_job(store, settings, FakeCutter(), job["id"])["evidence_id"])
    retention.release_hold(store, inc["hold_id"], "test: only the evidence reference remains")
    doomed = {r["id"] for r in retention.plan(store, 1, at(0) + timedelta(days=30))}
    assert doomed and not doomed & set(ev["source_segment_ids"])


def test_a_short_cut_is_never_called_full(store, settings, session, ten_second_segments):
    """Phase 3's first fixture run: ffmpeg stopped part-way and the plan still said "full".
    Coverage now comes from the clip's own frames."""
    inc = flag(store, settings, session)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    cutter = FakeCutter()
    cutter.drop = (10.0, 12.0)  # two seconds with no picture
    ev = evidence.get(store, evidence.run_job(store, settings, cutter, job["id"])["evidence_id"])
    manifest = json.loads(evidence.path_of(settings, ev, "manifest_rel_path").read_text(encoding="utf-8"))
    check = manifest["coverage"]["videoCheck"]
    assert ev["coverage"] == "partial" and not check["full"] and check["holes"][0]["durationMs"] == 2000
    assert [g["kind"] for g in manifest["coverage"]["gaps"]] == ["video"]
    assert ev["covered_ms"] == 28_000
    assert errors(manifest, SCHEMA) == []


def test_more_pictures_than_the_window_is_never_called_full(store, settings, session, ten_second_segments):
    """When segments' recorded times overlap, a clip holds more pictures than its window: the
    footage is all there once, but the clip's times are uncertain by the excess."""
    inc = flag(store, settings, session)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    cutter = FakeCutter()
    cutter.extra_frames = 42  # 1.68 s more pictures than 30 s
    ev = evidence.get(store, evidence.run_job(store, settings, cutter, job["id"])["evidence_id"])
    manifest = json.loads(evidence.path_of(settings, ev, "manifest_rel_path").read_text(encoding="utf-8"))
    check = manifest["coverage"]["videoCheck"]
    assert check["excessMs"] == 1680 and not check["full"] and ev["coverage"] == "partial"
    assert errors(manifest, SCHEMA) == []


def test_frames_without_their_keyframe_are_not_counted(store, settings, session, ten_second_segments):
    """A segment can open with frames whose keyframe the recorder discarded: the cut starts at
    the first keyframe and the time before it is recorded as missing, never as covered."""
    inc = flag(store, settings, session)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    ev = evidence.get(store, evidence.run_job(store, settings, FakeCutter(first_keyframe=0.9), job["id"])["evidence_id"])
    manifest = json.loads(evidence.path_of(settings, ev, "manifest_rel_path").read_text(encoding="utf-8"))
    leads = [s.get("undecodableLeadMs") for s in manifest["sources"]]
    assert leads == [900, 900, 900]  # each piece runs from its segment's start
    assert [g["kind"] for g in manifest["coverage"]["gaps"]] == ["undecodable"] * 3
    assert ev["coverage"] == "partial"


def test_overlapping_recorded_times_never_skip_footage(store, settings, session, ten_second_segments):
    """Segments whose recorded times overlap still hold different footage (MediaMTX writes each
    sample once). Every segment inside the window is taken whole; only the window's own edges
    are trimmed, and an overlap is never counted as a gap."""
    video = json.dumps({"streams": [{"codec_type": "video", "start_time": "0", "duration": "12.0"}]})
    with store.tx() as db:
        db.execute("UPDATE segments SET probe_json = ? WHERE source = 'ground'", (video,))
    plan = evidence.plan_cut(store, settings, "ground", at(20), 30_000)
    assert [p["inpointS"] for p in plan["pieces"]] == [None, None, None]  # 20, 30, 40: each from its start
    assert plan["gaps"] == [] and plan["coveredMs"] == 30_000
    assert plan["pieces"][-1]["outpointS"] == 10.0  # the last one stops at the window's end


def test_ffmpeg_errors_fail_the_cut_even_with_exit_zero(monkeypatch, tmp_path):
    import subprocess as sp

    def fake_run(cmd, **kwargs):
        return sp.CompletedProcess(cmd, 0, b"", b"[in#0/concat] Error during demuxing: Operation not permitted")

    monkeypatch.setattr(evidence.subprocess, "run", fake_run)
    monkeypatch.setattr(evidence.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    piece = {"path": tmp_path / "a.mp4", "inpointS": 1.0, "outpointS": 4.0}
    with pytest.raises(evidence.ClipFailed, match="Operation not permitted") as failed:
        evidence.FfmpegCutter().cut([piece], tmp_path / "out.mp4")
    assert failed.value.code == "cut_failed"


# ── real ffmpeg: real H.264 recordings, a red frame at a known moment ─────

FRAGMENTED = ["-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"]


def encode(path: Path, seconds: float, red_from: float | None = None, audio: bool = False) -> None:
    """A test recording: blue, with the whole frame red for 0.2 s from `red_from` (local time).
    Fragmented MP4 with a keyframe every second, like MediaMTX's recordings."""
    vf = "null" if red_from is None else (
        f"drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='between(t,{red_from},{red_from + 0.2})'")
    sound = ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:d={seconds}"] if audio else []
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    f"color=c=blue:s=160x90:r=25:d={seconds}", *sound, "-vf", vf, "-c:v", "libx264",
                    "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "25", "-keyint_min", "25", "-sc_threshold", "0",
                    *(["-c:a", "aac"] if audio else []), *FRAGMENTED, "-y", str(path)], check=True, timeout=120)


def open_mid_gop(source: Path, target: Path, skip_s: float) -> None:
    """Copy `source` from `skip_s` without re-encoding, so it opens on frames whose keyframe
    is missing: what MediaMTX writes after discarding late video at a segment switch."""
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(source), "-ss", str(skip_s),
                    "-map", "0", "-c", "copy", "-copyinkf", *FRAGMENTED, "-y", str(target)], check=True, timeout=120)


def colour_at(clip: Path, seconds: float) -> tuple[int, int, int]:
    raw = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-ss", f"{seconds:.3f}", "-i", str(clip),
                          "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True, timeout=60).stdout
    n = len(raw) // 3
    return tuple(round(sum(raw[i::3]) / n) for i in range(3))


@pytest.fixture
def real_recordings(settings, store):
    """Ground: two 30 s segments from 14:00:00; red at 14:00:40.0-40.2 (10.0 s into the second)."""
    folder = settings.recordings_dir / "ground"
    folder.mkdir(parents=True, exist_ok=True)
    encode(folder / segment_name(at(0)), 30)
    encode(folder / segment_name(at(30)), 30, red_from=10.0)
    finalise_all(settings, store)
    states = [r["state"] for r in store.query("SELECT state FROM segments ORDER BY start_utc")]
    assert states == ["finalized", "finalized"], states


@needs_ffmpeg
def test_real_thirty_second_clip_shows_the_incident_where_it_says(store, settings, session, real_recordings):
    inc = flag(store, settings, session, 40)  # pre-roll 20 s, post-roll 10 s
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    done = evidence.run_job(store, settings, evidence.FfmpegCutter(), job["id"])
    assert done["state"] == "succeeded", done
    ev = evidence.get(store, done["evidence_id"])
    clip = evidence.path_of(settings, ev)
    manifest = json.loads(evidence.path_of(settings, ev, "manifest_rel_path").read_text(encoding="utf-8"))
    assert errors(manifest, SCHEMA) == []
    assert len(manifest["sources"]) == 2 and ev["coverage"] == "full"
    assert [s["inpointS"] for s in manifest["sources"]] == [20.0, None]  # the second runs from its start
    # Stream copy: the length is the window's, give or take a GOP (1 s here).
    assert abs(ev["duration_ms"] - 30_000) <= 1000, ev["duration_ms"]
    at_event = manifest["window"]["eventAtMs"] / 1000
    red, _, blue = colour_at(clip, at_event + 0.08)
    assert red > 150 and blue < 100, (red, blue)  # the incident is on screen at eventAtMs
    red, _, blue = colour_at(clip, at_event - 2)
    assert blue > 150 and red < 100, (red, blue)  # and not two seconds before it
    assert manifest["derivation"]["method"] == "copy" and "-c" in manifest["derivation"]["arguments"]
    assert manifest["derivation"]["toolVersion"].startswith("ffmpeg version")


@needs_ffmpeg
def test_same_cut_twice_is_byte_identical(store, settings, session, real_recordings):
    """Reproducible: anyone holding the originals can re-cut the clip and compare hashes."""
    inc = flag(store, settings, session, 40)
    plan = evidence.plan_cut(store, settings, "ground", at(20), 30_000)
    cutter = evidence.FfmpegCutter()
    a, b = settings.data_dir / "a.mp4", settings.data_dir / "b.mp4"
    cutter.cut(plan["pieces"], a)
    cutter.cut(plan["pieces"], b)
    assert sha256_file(a) == sha256_file(b)
    assert inc


@needs_ffmpeg
def test_evidence_and_replay_survive_an_edge_restart(store, settings, session, real_recordings):
    from fairplay_edge.service import EdgeService

    inc = flag(store, settings, session, 40)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    ev_id = evidence.run_job(store, settings, evidence.FfmpegCutter(), job["id"])["evidence_id"]
    restarted = EdgeService(settings)  # a new process on the same disk
    again = evidence.get(restarted.store, ev_id)
    evidence.verify_file(restarted.store, settings, again)
    assert incidents.get(restarted.store, inc["id"])["version"] == inc["version"]
    assert audit.verify(restarted.store)["ok"]
    assert restarted.store.device_id == store.device_id
    with pytest.raises(sqlite3.IntegrityError):
        db = sqlite3.connect(settings.db_path)
        db.execute("DELETE FROM audit_log")


@needs_ffmpeg
def test_real_segment_opening_mid_gop_is_cut_and_reported_honestly(store, settings, session, tmp_path):
    """Reproduces the fixture's ground feed: audio and video, the second segment opening
    half a GOP before its first keyframe. The cut must neither fail silently nor call the
    undecodable half-second covered."""
    folder = settings.recordings_dir / "ground"
    folder.mkdir(parents=True, exist_ok=True)
    encode(folder / segment_name(at(0)), 30, audio=True)
    whole = tmp_path / "whole.mp4"
    encode(whole, 31, red_from=10.5, audio=True)
    open_mid_gop(whole, folder / segment_name(at(30)), 0.5)
    finalise_all(settings, store)
    lead = evidence.FfmpegCutter().first_keyframe_s(folder / segment_name(at(30)))
    assert lead is not None and 0.3 < lead < 0.7, lead
    inc = flag(store, settings, session, 40)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    done = evidence.run_job(store, settings, evidence.FfmpegCutter(), job["id"])
    assert done["state"] == "succeeded", done
    ev = evidence.get(store, done["evidence_id"])
    manifest = json.loads(evidence.path_of(settings, ev, "manifest_rel_path").read_text(encoding="utf-8"))
    assert errors(manifest, SCHEMA) == []
    # Up to the keyframe, from wherever the previous segment's pictures stopped (within a frame).
    lead_ms = manifest["sources"][1]["undecodableLeadMs"]
    assert abs(lead_ms - round(lead * 1000)) <= 40, (lead_ms, lead)
    assert ev["coverage"] == "partial" and "undecodable" in [g["kind"] for g in manifest["coverage"]["gaps"]]
    # The pictures that are there are all there: the lead-in, then 30 s less the undecodable lead.
    check = manifest["coverage"]["videoCheck"]
    assert abs(check["frames"] * 40 - (check["leadInMs"] + 30_000 - lead_ms)) <= 80, check
    assert abs(check["missingMs"] - lead_ms) <= 80, check
