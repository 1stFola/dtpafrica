"""The synthetic feeds: audio and video from one input, so they leave ffmpeg together."""

from fairplay_edge.synth import Feed, build_command


def inputs(cmd):
    return [cmd[i + 1] for i, a in enumerate(cmd) if a == "-i"]


def test_audio_and_video_share_one_input():
    cmd = build_command(Feed(source="ground", url="rtsp://x/ground", label="T"), 1_800_000_000.0)
    [graph] = inputs(cmd)
    assert graph.startswith("testsrc2=") and "[out0];sine=" in graph and graph.endswith("[out1]")


def test_the_old_two_input_form_is_still_available():
    feed = Feed(source="ground", url="rtsp://x/ground", label="T", separate_audio_input=True)
    assert len(inputs(build_command(feed, 1_800_000_000.0))) == 2


def test_a_silent_feed_has_one_plain_input():
    cmd = build_command(Feed(source="drone", url="rtsp://x/drone", label="T", audio=False), 1_800_000_000.0)
    assert inputs(cmd) == ["testsrc2=size=1280x720:rate=25"]
