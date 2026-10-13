import copy

import pytest

from dtp_vision_worker.ball_trajectory import Smoother
from dtp_vision_worker.event_carry import propose, MANIFEST_CHECKSUM


def fixture(frames=50, offset=1000):
    clock = Smoother(fps=25, source_offset_ms=offset, source_duration_ms=offset + frames * 40,
                    proxy_duration_ms=frames * 40, width=100, height=100,
                    segments=[{"cameraSegmentId": "camera", "startMs": offset, "endMs": offset + frames * 40, "kind": "live_play"}])
    snapshot = {"proxyWidth": 100, "proxyHeight": 100, "proxyVariantId": "proxy", "proxyKey": "proxy.mp4", "proxyChecksum": "b" * 64,
                "segments": [{"cameraSegmentId": "camera", "startMs": offset, "endMs": offset + frames * 40, "quality": "good", "calibrationId": "cal", "thresholdsVersion": "test",
                              "homography": [1, 0, 0, 0, 1, 0, 0, 0, 1], "pitch": {"lengthM": 105, "widthM": 68}}]}
    row = {"startMs": offset, "endMs": offset + frames * 40, "frames": frames, "state": "candidate", "reason": None, "localTrackId": 1, "trajectoryId": 1,
           "cameraSegmentId": "camera", "evidenceConfidence": .8, "reviewState": "unreviewed"}
    class Players:
        def at(self, i): return [(1, 10 + i * .1, 20, 5, .9, True)]
    return clock, [row], Players(), snapshot


def test_carry_is_observed_displacement_not_a_held_interval():
    clock, rows, players, snapshot = fixture()
    events = propose(clock, rows, players, snapshot, {})
    assert events == [{"id": "carry-1", "type": "carry", "startMs": 1000, "endMs": 2960, "actorMatchSquadPlayerId": None, "localTrackId": 1,
                       "cameraSegmentId": "camera", "trajectoryId": 1, "confidence": .8, "inPlay": True, "displacementM": pytest.approx(4.9)}]
    assert MANIFEST_CHECKSUM == "e06c0cf7d33a712e99f9ea15ac8a08c03b13f2990deda0f6131e47de62cfbe12"


@pytest.mark.parametrize("change", ["stationary", "too_short", "unknown", "missing", "weak", "unconfirmed", "jump", "off_pitch", "horizon"])
def test_no_movement_or_uncertain_observations_do_not_make_carries(change):
    clock, rows, players, snapshot = fixture(25 if change == "too_short" else 50)
    original = players.at
    if change == "stationary": players.at = lambda i: [(1, 10, 20, 5, .9, True)]
    if change in {"unknown", "missing", "weak", "unconfirmed", "jump"}:
        def at(i):
            if i == 24:
                if change == "missing": return []
                if change == "weak": return [(1, 12.4, 20, 5, .49, True)]
                if change == "unconfirmed": return [(1, 12.4, 20, 5, .9, False)]
            return [(1, 50 if change == "jump" and i >= 24 else 10 + i * .1, 20, 5, .9, True)]
        players.at = at
    if change == "unknown":
        rows = [{**rows[0], "endMs": 1960, "frames": 24}, {**rows[0], "startMs": 1960, "endMs": 2000, "frames": 1, "state": "unknown", "localTrackId": None, "reason": "weak_ball", "evidenceConfidence": None}, {**rows[0], "startMs": 2000, "frames": 25}]
    if change == "off_pitch": players.at = lambda i: [(1, 10 + i * .1, 69, 5, .9, True)]
    if change == "horizon": snapshot["segments"][0]["homography"] = [1, 0, 0, 0, 1, 0, 0, 0, -1]
    assert propose(clock, rows, players, snapshot, {}) == []


@pytest.mark.parametrize("identity", ["localTrackId", "trajectoryId", "cameraSegmentId"])
def test_identity_changes_never_bridge(identity):
    clock, rows, players, snapshot = fixture()
    rows = [{**rows[0], "frames": 25, "endMs": 2000}, {**rows[0], "frames": 25, "startMs": 2000, identity: 2 if identity != "cameraSegmentId" else "second"}]
    if identity == "localTrackId": players.at = lambda i: [(1 if i < 25 else 2, 10 + i * .1, 20, 5, .9, True)]
    if identity == "cameraSegmentId":
        clock.segments[0]["endMs"] = 2000
        clock.segments.append({"cameraSegmentId": "second", "startMs": 2000, "endMs": 3000, "kind": "live_play"})
        clock.starts = [1000, 2000]
        snapshot["segments"][0]["endMs"] = 2000
        snapshot["segments"].append({**copy.deepcopy(snapshot["segments"][0]), "cameraSegmentId": "second", "startMs": 2000, "endMs": 3000})
    assert propose(clock, rows, players, snapshot, {}) == []


def test_contiguous_chunks_of_the_same_original_candidate_join():
    clock, rows, players, snapshot = fixture()
    split = [{**rows[0], "frames": 25, "endMs": 2000}, {**rows[0], "frames": 25, "startMs": 2000}]
    assert propose(clock, split, players, snapshot, {}) == propose(clock, rows, players, snapshot, {})


@pytest.mark.parametrize("change", ["gap", "late_end", "truncated", "manual", "non_play", "failed", "negative_track"])
def test_invalid_or_manual_evidence_is_refused(change):
    clock, rows, players, snapshot = fixture()
    if change == "gap": rows[0]["startMs"] += 1
    if change == "late_end": rows[0]["endMs"] += 1
    if change == "truncated": rows[0].update(frames=49, endMs=2960)
    if change == "manual": rows[0]["reviewState"] = "accepted"
    if change == "non_play": clock.segments[0]["kind"] = "replay"
    if change == "failed": snapshot["segments"][0].update(quality="failed", homography=None, pitch=None)
    if change == "negative_track": rows[0]["localTrackId"] = -1
    with pytest.raises(ValueError): propose(clock, rows, players, snapshot, {})


def _split(rows, gap_frames, reason="ball_lost", trajectory_after=2):
    """One 50-frame candidate row cut by an Unknown gap at frame 20; the ball's trajectory restarts after it."""
    row = rows[0]
    start, ms = row["startMs"], lambda f: row["startMs"] + f * 40
    before = {**row, "frames": 20, "endMs": ms(20)}
    gap = {**row, "state": "unknown", "reason": reason, "localTrackId": None, "trajectoryId": None, "evidenceConfidence": None,
           "frames": gap_frames, "startMs": ms(20), "endMs": ms(20 + gap_frames)}
    after = {**row, "frames": 50 - 20 - gap_frames, "startMs": ms(20 + gap_frames), "trajectoryId": trajectory_after}
    return [before, gap, after]


def test_a_carry_survives_a_short_loss_of_the_ball():
    # docs/vision/97: the ball drops out for a few frames while the same player runs on with it.
    clock, rows, players, snapshot = fixture()
    events = propose(clock, _split(rows, 5), players, snapshot, {})
    assert len(events) == 1
    assert events[0]["startMs"] == 1000 and events[0]["endMs"] == 2960 and events[0]["trajectoryId"] == 1 and events[0]["localTrackId"] == 1


@pytest.mark.parametrize("change", ["too_long", "not_the_ball", "other_player"])
def test_a_carry_does_not_survive_a_long_gap_a_lost_player_or_a_change_of_possessor(change):
    clock, rows, players, snapshot = fixture()
    split = _split(rows, 10 if change == "too_long" else 5, reason="no_near_player" if change == "not_the_ball" else "ball_lost")
    if change == "other_player":
        split[2]["localTrackId"] = 2
        players.at = lambda i: [(1 if i < 25 else 2, 10 + i * .1, 20, 5, .9, True)]
    # Each side alone is under a second, so no carry may come out.
    assert propose(clock, split, players, snapshot, {}) == []
