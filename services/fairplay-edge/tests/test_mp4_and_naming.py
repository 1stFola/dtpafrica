from datetime import datetime, timezone

import pytest

from fairplay_edge import mp4
from fairplay_edge.naming import NotASegment, iso, parse_rel_path, parse_start

from .conftest import box, fmp4


def _inspect(tmp_path, data):
    path = tmp_path / "s.mp4"
    path.write_bytes(data)
    return mp4.inspect(path)


def test_complete_file(tmp_path):
    s = _inspect(tmp_path, fmp4(3))
    assert s.is_complete and s.fragments == 3 and s.complete_bytes == s.file_bytes


def test_truncated_last_mdat_is_partial_and_keeps_whole_fragments(tmp_path):
    whole = fmp4(2)
    s = _inspect(tmp_path, fmp4(3, truncate_last=10))
    assert not s.is_complete
    assert s.fragments == 2 and s.complete_bytes == len(whole)
    assert "past the end" in s.problems[0]


def test_moof_without_mdat_is_partial(tmp_path):
    s = _inspect(tmp_path, fmp4(2, dangling_moof=True))
    assert not s.is_complete and s.fragments == 2
    assert "no mdat" in s.problems[0]


def test_missing_moov_is_not_complete(tmp_path):
    s = _inspect(tmp_path, box("ftyp", b"iso5") + box("moof") + box("mdat", b"x"))
    assert not s.is_complete and s.complete_bytes == 0


def test_trailing_whole_box_keeps_file_complete(tmp_path):
    assert _inspect(tmp_path, fmp4(1) + box("free", b"\x00" * 4)).is_complete


def test_truncated_header(tmp_path):
    s = _inspect(tmp_path, fmp4(1) + b"\x00\x00")
    assert not s.is_complete and "header" in s.problems[0]


@pytest.mark.parametrize("stem, expected", [
    ("2026-10-27_14-03-11-123456_+0000", "2026-10-27T14:03:11.123Z"),
    ("2026-10-27_14-03-11-123456_Z", "2026-10-27T14:03:11.123Z"),
    ("2026-10-27_15-03-11-123456_+0100", "2026-10-27T14:03:11.123Z"),
    ("2026-10-27_15-03-11-123456_+01:00", "2026-10-27T14:03:11.123Z"),
])
def test_segment_names_become_utc(stem, expected):
    assert iso(parse_start(stem)) == expected


def test_rel_path():
    source, start = parse_rel_path("ground/2026-10-27_14-03-11-000000_+0000.mp4")
    assert source == "ground" and start == datetime(2026, 10, 27, 14, 3, 11, tzinfo=timezone.utc)


@pytest.mark.parametrize("rel", ["ground/x.mp4", "a/b/2026-10-27_14-03-11-000000_+0000.mp4",
                                 "ground/2026-10-27_14-03-11-000000_+0000.ts"])
def test_not_segments(rel):
    with pytest.raises(NotASegment):
        parse_rel_path(rel)
