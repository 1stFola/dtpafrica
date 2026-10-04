"""Tracking metrics, against cases worked out by hand.

Two gold tracks over ten frames are enough to tell an identity switch from a
fragmentation, and IDF1 from MOTA: the first charges a swap once, the second
charges every frame of it.
"""

from __future__ import annotations

import pytest

from dtp_vision_worker.assignment import INF, hungarian
from dtp_vision_worker.track_metrics import (
    GoldTracks,
    TrackedBox,
    gold_tracks_from_export,
    score_tracks,
    tracks_from_artifact,
)

CLASSES = ["player", "goalkeeper", "referee", "ball"]
A = (0.1, 0.1, 0.05, 0.1)
B = (0.6, 0.6, 0.05, 0.1)


def metric(report: dict, name: str, slice_name: str = "all") -> float | None:
    for m in report["metrics"]:
        if m["metric"] == name and m["slice"] == slice_name:
            return m["value"]
    raise KeyError(name)


def gold(frames: int = 10) -> GoldTracks:
    g = GoldTracks(asset_id="a1", slices=("quality:broadcast",))
    for f in range(1, frames + 1):
        g.frames[f] = [TrackedBox("A", "player", A), TrackedBox("B", "player", B)]
    return g


def preds(mapping: dict[int, list[tuple[str, tuple[float, float, float, float]]]]) -> dict[str, dict[int, list[TrackedBox]]]:
    return {"a1": {f: [TrackedBox(tid, "player", box) for tid, box in boxes] for f, boxes in mapping.items()}}


# ── Hungarian ────────────────────────────────────────────────────────────────


def test_hungarian_takes_the_cheaper_whole_rather_than_the_cheapest_first() -> None:
    # Greedy takes (0,0)=1 then is left with (1,1)=10 -> 11. Optimal is (0,1)+(1,0) = 2+2 = 4.
    assert hungarian([[1, 2], [2, 10]]) == [(0, 1), (1, 0)]


def test_hungarian_handles_rectangles_and_forbidden_pairs() -> None:
    assert hungarian([[1, INF, 3]]) == [(0, 0)]
    assert hungarian([[INF, 1], [INF, INF]]) == [(0, 1)]
    assert hungarian([[5], [1], [3]]) == [(1, 0)]
    assert hungarian([]) == []


# ── the metrics by hand ───────────────────────────────────────────────────────


def test_a_perfect_tracker_scores_one_everywhere() -> None:
    p = preds({f: [("1", A), ("2", B)] for f in range(1, 11)})
    r = score_tracks([gold()], p, CLASSES, 0.5)
    assert metric(r, "mota:player") == 1.0
    assert metric(r, "idf1:player") == 1.0
    assert metric(r, "idsw:player") == 0
    assert metric(r, "frag:player") == 0
    assert metric(r, "tracks:player") == 2
    assert metric(r, "mota:all") == 1.0
    assert metric(r, "mota:ball") is None


def test_an_identity_switch_mid_track_by_hand() -> None:
    """B is followed by track 2 for five frames and track 3 for five.

    One switch, no fragmentation (B was matched on every frame).
    MOTA = 1 - (0 misses + 0 fps + 1 switch) / 20 = 0.95.
    IDF1: assign A<->1 (10 frames) and B<->2 (5): IDTP 15, IDFN 5, IDFP 5 -> 30/40 = 0.75.
    """
    p = preds({f: [("1", A), ("2" if f <= 5 else "3", B)] for f in range(1, 11)})
    r = score_tracks([gold()], p, CLASSES, 0.5)
    assert metric(r, "idsw:player") == 1
    assert metric(r, "frag:player") == 0
    assert metric(r, "mota:player") == pytest.approx(0.95)
    assert metric(r, "idf1:player") == pytest.approx(0.75)


def test_a_fragmentation_is_a_hole_not_a_switch() -> None:
    """Track 2 loses B for frames 4-6 and finds it again as the same id.

    Three misses, one fragmentation, no switch. MOTA = 1 - 3/20 = 0.85.
    IDF1: A<->1 (10), B<->2 (7): IDTP 17, IDFN 3, IDFP 0 -> 34/37.
    """
    p = preds({f: [("1", A)] + ([("2", B)] if f not in (4, 5, 6) else []) for f in range(1, 11)})
    r = score_tracks([gold()], p, CLASSES, 0.5)
    assert metric(r, "frag:player") == 1
    assert metric(r, "idsw:player") == 0
    assert metric(r, "mota:player") == pytest.approx(0.85)
    assert metric(r, "idf1:player") == pytest.approx(34 / 37)


def test_a_swap_is_two_switches_and_idf1_charges_every_frame_of_it() -> None:
    """At frame 6 the tracker swaps ids: 1 now follows B and 2 follows A.

    Two switches (A and B each change predicted id once). MOTA = 1 - 2/20 = 0.9.
    IDF1: best assignment A<->1 (5) + B<->2 (5) = 10 -> IDTP 10 of 20 -> 20/40 = 0.5.
    """
    p = preds({f: ([("1", A), ("2", B)] if f <= 5 else [("2", A), ("1", B)]) for f in range(1, 11)})
    r = score_tracks([gold()], p, CLASSES, 0.5)
    assert metric(r, "idsw:player") == 2
    assert metric(r, "mota:player") == pytest.approx(0.9)
    assert metric(r, "idf1:player") == pytest.approx(0.5)


def test_idf1_assigns_ids_optimally_not_by_sorted_order() -> None:
    """Predicted track 1 follows B and track 2 follows A throughout. Pairing ids in
    sorted order (A-1, B-2) would score zero coincidence; the optimal assignment
    (A-2, B-1) covers every frame. IDF1 is 1, not 0."""
    p = preds({f: [("1", B), ("2", A)] for f in range(1, 11)})
    r = score_tracks([gold()], p, CLASSES, 0.5)
    assert metric(r, "idf1:player") == pytest.approx(1.0)
    assert metric(r, "idsw:player") == 0


def test_false_positives_and_misses_count_against_mota_but_not_as_switches() -> None:
    # A spurious third track every frame, and B never found: 10 fps + 10 misses over 20 gold boxes.
    p = preds({f: [("1", A), ("9", (0.9, 0.9, 0.05, 0.05))] for f in range(1, 11)})
    r = score_tracks([gold()], p, CLASSES, 0.5)
    assert metric(r, "mota:player") == pytest.approx(0.0)
    assert metric(r, "idsw:player") == 0
    # IDF1: A<->1 10 frames; gold total 20, pred total 20 -> 20/(20+10+10) = 0.5
    assert metric(r, "idf1:player") == pytest.approx(0.5)


def test_continuity_is_preferred_over_a_momentary_better_overlap() -> None:
    """Track 1 holds A; on one frame a second prediction overlaps A slightly better.
    CLEAR keeps the standing pair: no switch is charged."""
    nudged = (0.1, 0.1, 0.05, 0.1)
    off = (0.105, 0.1, 0.05, 0.1)
    p = preds({f: ([("1", off), ("7", nudged)] if f == 5 else [("1", nudged)]) for f in range(1, 11)})
    g = GoldTracks(asset_id="a1", slices=())
    for f in range(1, 11):
        g.frames[f] = [TrackedBox("A", "player", nudged)]
    r = score_tracks([g], p, CLASSES, 0.5)
    assert metric(r, "idsw:player") == 0


def test_classes_never_cross_and_slices_are_kept_apart() -> None:
    g1 = GoldTracks("a1", ("quality:broadcast",), {1: [TrackedBox("A", "player", A)], 2: [TrackedBox("A", "player", A)]})
    g2 = GoldTracks("a2", ("quality:platform_copy",), {1: [TrackedBox("A", "ball", A)], 2: [TrackedBox("A", "ball", A)]})
    p = {"a1": {1: [TrackedBox("1", "player", A)], 2: [TrackedBox("1", "player", A)]}, "a2": {1: [TrackedBox("1", "player", A)], 2: [TrackedBox("1", "player", A)]}}
    r = score_tracks([g1, g2], p, CLASSES, 0.5)
    assert metric(r, "mota:player", "quality:broadcast") == 1.0
    # On the platform copy the ball was never found and a player was invented: 2 misses, 2 fps over 2 gold.
    assert metric(r, "mota:all", "quality:platform_copy") == pytest.approx(-1.0)
    assert metric(r, "mota:ball", "quality:platform_copy") == pytest.approx(0.0)


def test_uncovered_assets_are_not_scored() -> None:
    r = score_tracks([gold()], {}, CLASSES, 0.5)
    assert r["framesScored"] == 0
    assert metric(r, "mota:player") is None


# ── reading the files ─────────────────────────────────────────────────────────


def test_gold_tracks_come_from_boxes_with_a_track_id() -> None:
    [g] = gold_tracks_from_export([{
        "metadata": {"frame_width": 1280, "frame_height": 720},
        "frames": {"26": {"detections": {"detections": [
            {"label": "player", "bounding_box": [0.1, 0.1, 0.1, 0.2], "track_id": "A"},
            {"label": "ball", "bounding_box": [0.5, 0.5, 0.02, 0.03]},
        ]}}},
        "provenance": {"video_asset_id": "a1", "source_quality_rank": "broadcast"},
    }])
    assert g.frames == {26: [TrackedBox("A", "player", (0.1, 0.1, 0.1, 0.2))]}


def test_predicted_tracks_are_normalised_and_renumbered() -> None:
    out = tracks_from_artifact({"tracks": [{"localTrackId": 3, "class": "player", "positions": [
        {"frameIndex": 25, "box": {"x": 128, "y": 72, "width": 128, "height": 144}},
    ]}]}, 1280, 720)
    assert out == {26: [TrackedBox("3", "player", (0.1, 0.1, 0.1, 0.2))]}


# ── more than one asset (docs/vision/56) ─────────────────────────────────────


def test_idf1_does_not_merge_tracks_across_assets() -> None:
    """A local track id is unique inside one artifact. Two assets each have a gold "A" and a
    predicted "1", and they are four different things.

    On the first asset the tracker follows A as track 1 and B as track 2. On the second it
    has them the other way round: A is track 2, B is track 1. Each asset alone is perfect.
    Keyed by bare id, gold A coincides with pred 1 on one asset and pred 2 on the other, so
    the best one-to-one assignment can only credit half the frames: IDF1 0.5 for a tracker
    that made no mistake."""
    def sample(asset: str) -> GoldTracks:
        g = GoldTracks(asset_id=asset, slices=())
        for f in range(1, 11):
            g.frames[f] = [TrackedBox("A", "player", A), TrackedBox("B", "player", B)]
        return g

    predictions = {
        "a1": {f: [TrackedBox("1", "player", A), TrackedBox("2", "player", B)] for f in range(1, 11)},
        "a2": {f: [TrackedBox("2", "player", A), TrackedBox("1", "player", B)] for f in range(1, 11)},
    }
    report = score_tracks([sample("a1"), sample("a2")], predictions, CLASSES, 0.5)
    assert metric(report, "idf1:player") == 1.0
    assert metric(report, "idf1:all") == 1.0
    assert metric(report, "mota:player") == 1.0
    # Four gold tracks, not two.
    assert metric(report, "tracks:player") == 4.0
    assert report["assets"] == 2


def test_one_asset_scores_as_it_did() -> None:
    whole = score_tracks([gold()], preds({f: [("1", A), ("2", B)] for f in range(1, 11)}), CLASSES, 0.5)
    assert metric(whole, "idf1:player") == 1.0 and metric(whole, "tracks:player") == 2.0
