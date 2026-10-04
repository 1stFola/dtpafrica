"""The streaming reader against `json.load`, at buffer sizes that cut values in half."""

from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from dtp_vision_worker import jsonstream
from dtp_vision_worker.jsonstream import JsonStreamError, fields, items, scan


def write(tmp_path: Path, obj: object, **dump: object) -> Path:
    path = tmp_path / "artifact.json"
    path.write_text(json.dumps(obj, **dump), encoding="utf-8")  # type: ignore[arg-type]
    return path


ARTIFACT = {
    "modelVersionId": "m-1",
    "sampleFps": 25,
    "proxy": {"fps": 25, "sourceOffsetMs": 9000},
    "frames": [{"frameIndex": i, "sourceTimeMs": 9000 + i * 40, "detections": [{"class": "player", "confidence": 0.5 + i / 1000, "box": {"x": i, "y": 2, "width": 3, "height": 4}}]} for i in range(300)],
    "note": "after the array — a key the writer put last",
    "count": 300,
}


@pytest.mark.parametrize("read_size", [1, 2, 7, 64, 1 << 20])
def test_items_and_fields_are_what_json_load_gives_at_any_buffer_size(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, read_size: int) -> None:
    monkeypatch.setattr(jsonstream, "_READ", read_size)
    path = write(tmp_path, ARTIFACT)
    assert list(items(path, "frames")) == ARTIFACT["frames"]
    assert fields(path, "frames") == {k: v for k, v in ARTIFACT.items() if k != "frames"}


def test_file_order_is_kept_and_keys_after_the_array_are_read(tmp_path: Path) -> None:
    path = write(tmp_path, {"a": 1, "tracks": [10, 20], "z": [1, 2]})
    assert list(scan(path, "tracks")) == [("field", ("a", 1)), ("item", 10), ("item", 20), ("field", ("z", [1, 2]))]


def test_numbers_cut_by_the_buffer_edge_are_read_whole(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # "12345" split as "12" | "345" must not be read as 12.
    monkeypatch.setattr(jsonstream, "_READ", 3)
    path = write(tmp_path, {"n": 12345, "frames": [12345, 0.000125, -7, True, None, "a\"]}é"], "m": 678})
    assert list(items(path, "frames")) == [12345, 0.000125, -7, True, None, "a\"]}é"]
    assert fields(path, "frames") == {"n": 12345, "m": 678}


def test_whitespace_and_indentation_do_not_matter(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jsonstream, "_READ", 5)
    path = write(tmp_path, ARTIFACT, indent=2)
    assert list(items(path, "frames")) == ARTIFACT["frames"]


def test_an_empty_array_a_null_and_a_missing_key_are_no_items(tmp_path: Path) -> None:
    assert list(items(write(tmp_path, {"frames": [], "a": 1}), "frames")) == []
    assert list(items(write(tmp_path, {"frames": None, "a": 1}), "frames")) == []
    assert list(items(write(tmp_path, {"a": 1}), "frames")) == []
    assert list(items(write(tmp_path, {}), "frames")) == []
    assert fields(write(tmp_path, {"frames": None, "a": 1}), "frames") == {"a": 1}


def test_only_the_top_level_key_is_streamed(tmp_path: Path) -> None:
    path = write(tmp_path, {"nested": {"frames": [1, 2]}, "frames": [3]})
    assert list(items(path, "frames")) == [3]
    assert fields(path, "frames") == {"nested": {"frames": [1, 2]}}


def test_what_is_not_this_shape_is_refused(tmp_path: Path) -> None:
    for text in ["[1, 2]", '{"frames": 3}', '{"frames": [1, 2}', '{"frames": [1, 2]', '{"a": 1} trailing', "", '{"a" 1}']:
        path = tmp_path / "bad.json"
        path.write_text(text, encoding="utf-8")
        with pytest.raises(JsonStreamError):
            list(scan(path, "frames"))


def test_random_objects_round_trip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    rng = random.Random(3)

    def value(depth: int = 0) -> object:
        kind = rng.randint(0, 6 if depth < 3 else 4)
        if kind == 0:
            return rng.randint(-10**9, 10**9)
        if kind == 1:
            return rng.random() * 10 ** rng.randint(-6, 6)
        if kind == 2:
            return rng.choice([True, False, None])
        if kind in (3, 4):
            return "".join(rng.choice('ab"\\,[]{}: \né中') for _ in range(rng.randint(0, 12)))
        if kind == 5:
            return [value(depth + 1) for _ in range(rng.randint(0, 4))]
        return {f"k{i}": value(depth + 1) for i in range(rng.randint(0, 4))}

    for _ in range(150):
        obj = {"before": value(), "items": [value() for _ in range(rng.randint(0, 8))], "after": value()}
        monkeypatch.setattr(jsonstream, "_READ", rng.randint(1, 40))
        path = write(tmp_path, obj)
        assert list(items(path, "items")) == obj["items"]
        assert fields(path, "items") == {"before": obj["before"], "after": obj["after"]}
