"""Kit colour and the two sides, against frames drawn by hand.

A frame here is a few hundred bytes of RGB: a red torso, a blue torso, a white one.
Enough to tell a histogram that counts hue from one that counts brightness, and a
clustering that names a side from one that guesses.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dtp_vision_worker.kits import (
    BINS,
    HUE_BINS,
    KitTrack,
    Params,
    cluster_teams,
    describe,
    distance,
    kit_histogram,
    main,
    sample_frames,
    torso_region,
)


def solid(w: int, h: int, rgb: tuple[int, int, int]) -> bytes:
    return bytes(rgb) * (w * h)


RED = (220, 30, 30)
BLUE = (30, 40, 220)
WHITE = (240, 240, 240)
BLACK = (40, 40, 40)
GREEN = (40, 160, 50)


def feature_of(rgb: tuple[int, int, int]) -> list[float]:
    hist = kit_histogram(solid(10, 10, rgb), 10, 10, (0, 0, 10, 10))
    assert hist is not None
    return hist


def test_a_red_torso_lands_in_the_red_bin() -> None:
    f = feature_of(RED)
    assert f[0] == pytest.approx(1.0)
    assert describe(f) == "red"


def test_blue_is_blue_and_white_is_white_not_a_hue() -> None:
    assert describe(feature_of(BLUE)) == "blue"
    f = feature_of(WHITE)
    assert f[HUE_BINS + 1] == pytest.approx(1.0)
    assert describe(f) == "white"


def test_black_is_dark_and_near_black_shadow_is_skipped() -> None:
    assert describe(feature_of(BLACK)) == "dark"
    assert kit_histogram(solid(4, 4, (5, 5, 5)), 4, 4, (0, 0, 4, 4)) is None


def test_the_torso_is_the_middle_of_the_shirt_not_the_head_or_shorts() -> None:
    x, y, w, h = torso_region((100, 200, 40, 80))
    assert (x, y, w, h) == (110, 216, 20, 28)


def test_a_region_outside_the_frame_or_too_small_is_none() -> None:
    assert kit_histogram(solid(10, 10, RED), 10, 10, (20, 20, 5, 5)) is None
    assert kit_histogram(solid(10, 10, RED), 10, 10, (0, 0, 1, 1)) is None


def test_a_region_is_clipped_to_the_frame() -> None:
    hist = kit_histogram(solid(10, 10, RED), 10, 10, (8, 8, 10, 10))
    assert hist is not None and hist[0] == pytest.approx(1.0)


def test_histograms_sum_to_one_and_distance_is_l1() -> None:
    red, blue = feature_of(RED), feature_of(BLUE)
    assert sum(red) == pytest.approx(1.0)
    assert distance(red, red) == 0.0
    assert distance(red, blue) == pytest.approx(2.0)
    assert len(red) == BINS


def test_frames_are_sampled_from_first_to_last() -> None:
    assert sample_frames(list(range(100)), 5) == [0, 25, 50, 74, 99]
    assert sample_frames([3, 4, 5], 5) == [3, 4, 5]
    assert sample_frames([], 5) == []


# ── two sides ─────────────────────────────────────────────────────────────────


def kit(local_id: int, rgb: tuple[int, int, int], cls: str = "player") -> KitTrack:
    return KitTrack(local_id, cls, feature_of(rgb), 3)


def test_two_kits_make_two_sides_and_each_track_knows_its_own() -> None:
    tracks = [kit(1, RED), kit(2, RED), kit(3, (200, 50, 50)), kit(4, BLUE), kit(5, BLUE), kit(6, (50, 60, 200))]
    result = cluster_teams(tracks)
    sides = {r["localTrackId"]: r["team"] for r in result["rows"]}
    assert sides[1] == sides[2] == sides[3]
    assert sides[4] == sides[5] == sides[6]
    assert sides[1] != sides[4]
    assert {k["description"] for k in result["kits"]} == {"red", "blue"}
    assert result["assigned"] == 6 and result["unknown"] == 0
    assert all(r["method"] == "kit_cluster" for r in result["rows"])


def test_a_kit_halfway_between_the_two_gets_no_side() -> None:
    """Unknown beats wrong. Purple is as far from red as from blue."""
    tracks = [kit(1, RED), kit(2, RED), kit(3, BLUE), kit(4, BLUE), kit(5, (130, 30, 130))]
    result = cluster_teams(tracks)
    purple = next(r for r in result["rows"] if r["localTrackId"] == 5)
    assert purple["team"] is None
    assert purple["method"] == "kit_cluster"
    assert purple["nearest"] in {"A", "B"}
    assert result["unknown"] == 1
    # A named side is its own nearest side.
    assert all(r["nearest"] == r["team"] for r in result["rows"] if r["team"] is not None)


def test_goalkeepers_and_referees_are_never_clustered() -> None:
    tracks = [kit(1, RED), kit(2, BLUE), kit(3, GREEN, cls="goalkeeper"), kit(4, BLACK, cls="referee")]
    result = cluster_teams(tracks)
    by = {r["localTrackId"]: r for r in result["rows"]}
    assert by[3]["team"] is None and by[3]["method"] == "not_clustered"
    assert by[4]["team"] is None and by[4]["method"] == "not_clustered"
    assert result["clusteredTracks"] == 2
    # And their kit did not pull a centre: the two kits are still red and blue.
    assert {k["description"] for k in result["kits"]} == {"red", "blue"}


def test_a_track_with_no_decoded_kit_is_not_clustered() -> None:
    tracks = [kit(1, RED), kit(2, BLUE), KitTrack(3, "player", None, 0)]
    result = cluster_teams(tracks)
    unseen = next(r for r in result["rows"] if r["localTrackId"] == 3)
    assert unseen == {"localTrackId": 3, "class": "player", "team": None, "nearest": None, "confidence": None, "method": "not_clustered", "samples": 0}


def test_one_kit_alone_cannot_make_two_sides() -> None:
    result = cluster_teams([kit(1, RED)])
    assert result["kits"] == []
    assert result["rows"][0]["team"] is None and result["rows"][0]["method"] == "not_clustered"


def test_white_against_dark_is_a_valid_pair_of_sides() -> None:
    tracks = [kit(1, WHITE), kit(2, WHITE), kit(3, BLACK), kit(4, (55, 55, 55))]
    result = cluster_teams(tracks)
    assert {k["description"] for k in result["kits"]} == {"white", "dark"}
    assert result["assigned"] == 4


def test_the_margin_threshold_is_the_knob_that_names_a_side() -> None:
    tracks = [kit(1, RED), kit(2, RED), kit(3, BLUE), kit(4, BLUE), kit(5, (130, 30, 130))]
    assert cluster_teams(tracks)["assigned"] == 4
    assert cluster_teams(tracks, Params(min_margin=0.0))["assigned"] == 5


def mix(a: tuple[int, int, int], b: tuple[int, int, int], share: float) -> list[float]:
    """A kit that is mostly one colour with some of another, as real kits are."""
    fa, fb = feature_of(a), feature_of(b)
    return [share * x + (1 - share) * y for x, y in zip(fa, fb, strict=True)]


def test_a_lone_third_kit_is_an_outlier_not_a_side() -> None:
    """Red-and-white against blue-and-white, and one yellow bib.

    Pure yellow is further from both kits than they are from each other, so a naive
    start makes it a centre and puts both teams on the other side. It must be set
    aside instead, and the two real sides found without it.
    """
    tracks = [KitTrack(i, "player", mix(RED, WHITE, 0.6), 3) for i in range(1, 5)]
    tracks += [KitTrack(i, "player", mix(BLUE, WHITE, 0.6), 3) for i in range(5, 9)]
    tracks.append(KitTrack(9, "player", feature_of((230, 220, 40)), 3))
    result = cluster_teams(tracks)
    by = {r["localTrackId"]: r for r in result["rows"]}
    assert by[9] == {"localTrackId": 9, "class": "player", "team": None, "nearest": None, "confidence": None, "method": "kit_outlier", "samples": 3}
    assert {by[i]["team"] for i in range(1, 5)} == {by[1]["team"]} and by[1]["team"] is not None
    assert {by[i]["team"] for i in range(5, 9)} == {by[5]["team"]} and by[5]["team"] is not None
    assert by[1]["team"] != by[5]["team"]
    assert {k["description"] for k in result["kits"]} == {"red", "blue"}
    assert result["outliers"] == 1 and result["assigned"] == 8 and result["unknown"] == 1


def test_a_side_of_one_in_five_is_not_under_a_fifth_so_nothing_is_set_aside() -> None:
    """The share rule, at its edge: the yellow bib among four kits is alone on its side,
    and one of five is exactly a fifth, not under it. The same five at a larger share
    would set it aside -- the knob, not a special case, decides."""
    tracks = [KitTrack(i, "player", mix(RED, WHITE, 0.6), 3) for i in (1, 2)]
    tracks += [KitTrack(i, "player", mix(BLUE, WHITE, 0.6), 3) for i in (3, 4)]
    tracks.append(KitTrack(5, "player", feature_of((230, 220, 40)), 3))
    result = cluster_teams(tracks)
    assert result["outliers"] == 0
    assert all(r["method"] == "kit_cluster" for r in result["rows"])
    pruned = cluster_teams(tracks, Params(min_side_share=0.3))
    assert pruned["outliers"] == 1
    assert next(r for r in pruned["rows"] if r["localTrackId"] == 5)["method"] == "kit_outlier"


def test_a_medoid_moves_off_an_odd_first_pick_to_a_typical_kit() -> None:
    """The two most different kits start the clustering, and one of them may be the
    oddest member of its side: a mostly-white kit with some red, listed first. The
    medoid must move to a plain red kit, or every red track would measure its margin
    against the odd one and the side would be described as white."""
    tracks = [KitTrack(1, "player", mix(RED, WHITE, 0.4), 3), kit(2, RED), kit(3, RED), kit(4, RED), kit(5, BLUE), kit(6, BLUE), kit(7, BLUE)]
    result = cluster_teams(tracks)
    assert {k["description"] for k in result["kits"]} == {"red", "blue"}
    by = {r["localTrackId"]: r for r in result["rows"]}
    assert by[2]["confidence"] == 1.0
    assert by[1]["team"] == by[2]["team"] and by[1]["team"] is not None


def test_a_track_between_the_sides_cannot_drag_a_centre_toward_itself() -> None:
    """Medoids, not means: the centres are real kits, so the purple track stays unknown
    even though it was grouped with the reds."""
    tracks = [kit(1, RED), kit(2, RED), kit(3, RED), kit(4, BLUE), kit(5, BLUE), kit(6, BLUE), kit(7, (130, 30, 130))]
    result = cluster_teams(tracks)
    purple = next(r for r in result["rows"] if r["localTrackId"] == 7)
    assert purple["team"] is None and purple["confidence"] == 0.0
    assert {k["description"] for k in result["kits"]} == {"red", "blue"}


def test_the_cli_clusters_pre_extracted_features(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    rows = [{"localTrackId": i, "class": "player", "feature": feature_of(c), "samples": 2} for i, c in [(1, RED), (2, RED), (3, BLUE), (4, BLUE)]]
    path = tmp_path / "features.json"
    path.write_text(json.dumps(rows), encoding="utf-8")
    assert main(["--features", str(path)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["assigned"] == 4
    assert {k["description"] for k in out["kits"]} == {"red", "blue"}


def test_the_cli_reads_kits_off_a_raw_frame(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """A 40x20 frame: red on the left, blue on the right; a box on each and one off the frame."""
    px = bytearray()
    for _y in range(20):
        px += bytes(RED) * 20 + bytes(BLUE) * 20
    frame = tmp_path / "frame.rgb"
    frame.write_bytes(bytes(px))
    boxes = tmp_path / "boxes.json"
    boxes.write_text(json.dumps([
        {"localTrackId": 1, "class": "player", "box": {"x": 0, "y": 0, "width": 20, "height": 20}},
        {"localTrackId": 2, "class": "player", "box": {"x": 20, "y": 0, "width": 20, "height": 20}},
        {"localTrackId": 3, "class": "player", "box": {"x": 60, "y": 0, "width": 20, "height": 20}},
    ]), encoding="utf-8")
    assert main(["--frame", str(frame), "--width", "40", "--height", "20", "--boxes", str(boxes)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert [o["localTrackId"] for o in out] == [1, 2, 3]
    assert describe(out[0]["feature"]) == "red" and out[0]["samples"] == 1
    assert describe(out[1]["feature"]) == "blue"
    assert out[2] == {"localTrackId": 3, "class": "player", "feature": None, "samples": 0}


def test_the_cli_refuses_a_frame_of_the_wrong_size(tmp_path: Path) -> None:
    frame = tmp_path / "frame.rgb"
    frame.write_bytes(b"\x00" * 10)
    boxes = tmp_path / "boxes.json"
    boxes.write_text("[]", encoding="utf-8")
    with pytest.raises(SystemExit):
        main(["--frame", str(frame), "--width", "40", "--height", "20", "--boxes", str(boxes)])
