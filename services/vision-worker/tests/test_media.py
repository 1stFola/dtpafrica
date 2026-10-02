"""What produced a proxy, and why the settings hash does not say.

The first isolated tests for `media.py`. FFmpeg is not installed here or in CI, so what
is tested is the part that does not need it: the banner parsing, against the banners the
two worker images actually print, and the deliberate decision that the settings hash
ignores the encoder.

Spike S0 turned this from a theoretical difference into a measured one — see
`docs/vision/27-SPIKE-S0-SURPRISES.md`, S0-12.
"""

from __future__ import annotations

from dtp_vision_worker import media

# Copied from CI output, not invented: the CPU image's `ffmpeg is present` step and the
# GPU image's `ffmpeg is present in the GPU image too` step.
CPU_IMAGE_BANNER = (
    "ffmpeg version 5.1.9-0+deb12u1 Copyright (c) 2000-2026 the FFmpeg developers\n"
    "built with gcc 12 (Debian 12.2.0-14)\n"
)
GPU_IMAGE_BANNER = (
    "ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c) 2000-2021 the FFmpeg developers\n"
    "built with gcc 11 (Ubuntu 11.2.0-19ubuntu1)\n"
)


def test_reads_the_build_from_each_image_banner() -> None:
    assert media._parse_encoder_version(CPU_IMAGE_BANNER) == "ffmpeg 5.1.9-0+deb12u1"
    assert media._parse_encoder_version(GPU_IMAGE_BANNER) == "ffmpeg 4.4.2-0ubuntu0.22.04.1"


def test_the_two_images_do_not_report_the_same_encoder() -> None:
    """The finding itself, pinned.

    If someone aligns the base images later this test fails, which is the right moment to
    notice: it would mean the two images agree again and the provenance field stops
    distinguishing anything.
    """
    assert media._parse_encoder_version(CPU_IMAGE_BANNER) != media._parse_encoder_version(
        GPU_IMAGE_BANNER
    )


def test_an_unreadable_banner_is_no_version_rather_than_a_wrong_one() -> None:
    assert media._parse_encoder_version("") is None
    assert media._parse_encoder_version("bash: ffmpeg: command not found") is None
    assert media._parse_encoder_version("avconv version 11.4") is None


def test_the_settings_hash_ignores_which_build_ran_the_recipe(monkeypatch) -> None:
    """Deliberate, and the reason the encoder is recorded separately.

    Hashing the build string would be the obvious fix for two images producing different
    proxies, and the wrong one: every FFmpeg upgrade would invalidate every proxy in the
    corpus and force a re-transcode. The hash answers "same recipe?", the `encoder` field
    answers "same build?", and only the second one changes on a base-image bump.
    """
    before = media.settings_hash()

    # Pretend this worker is the other image. The hash must not move.
    monkeypatch.setattr(media, "encoder_version", lambda: "ffmpeg 4.4.2-0ubuntu0.22.04.1")
    assert media.settings_hash() == before
    monkeypatch.setattr(media, "encoder_version", lambda: "ffmpeg 5.1.9-0+deb12u1")
    assert media.settings_hash() == before
    monkeypatch.setattr(media, "encoder_version", lambda: None)
    assert media.settings_hash() == before


def test_the_settings_hash_changes_when_the_recipe_does(monkeypatch) -> None:
    """The other half: it must still be sensitive to what it does cover."""
    before = media.settings_hash()
    monkeypatch.setattr(media, "PROXY_CRF", 18)
    assert media.settings_hash() != before


def test_a_frame_is_sought_half_a_frame_early_so_rounding_cannot_skip_it() -> None:
    """FFmpeg keeps the first frame at or after the seek point; half a frame early lands on n."""
    assert media.frame_seek_seconds(0, 25) == 0.0
    assert media.frame_seek_seconds(1, 25) == 0.02
    assert media.frame_seek_seconds(29, 25) == 1.14
