"""The rendered MediaMTX config must undo every unsafe upstream default."""

import json

import pytest

from fairplay_edge.config import ConfigError
from fairplay_edge.mediamtx_config import ALWAYS_OFF, hashed, matches, render, write


@pytest.fixture
def cfg(settings, env):
    return render(settings, env)


def test_no_anonymous_user(cfg):
    assert all(u["user"] != "any" for u in cfg["authInternalUsers"])


def test_every_user_is_ip_scoped(cfg):
    assert all(u["ips"] for u in cfg["authInternalUsers"])


def test_publishers_can_only_publish_their_own_path(cfg):
    publishers = [u for u in cfg["authInternalUsers"] if u["user"].startswith("pub-")]
    assert {u["user"] for u in publishers} == {"pub-ground", "pub-drone"}
    for u in publishers:
        assert u["permissions"] == [{"action": "publish", "path": u["user"][4:]}]


def test_api_playback_and_live_read_only_for_the_edge_address(cfg):
    edge = next(u for u in cfg["authInternalUsers"] if u["user"] == "fairplay-edge")
    assert edge["ips"] == ["172.31.250.10"]
    assert {p["action"] for p in edge["permissions"]} == {"api", "playback", "read"}
    # No other user may read: publishers publish, nothing else.
    others = [u for u in cfg["authInternalUsers"] if u["user"] != "fairplay-edge"]
    assert all(p["action"] == "publish" for u in others for p in u["permissions"])


def test_live_preview_hls_is_internal_and_same_origin(cfg, settings, env):
    assert cfg["hls"] is True and cfg["hlsAllowOrigins"] == [] and cfg["hlsVariant"] == "fmp4"
    native = render(settings, env, mode="native")
    assert native["hlsAddress"].startswith("127.0.0.1:")


def test_passwords_are_argon2id_hashed_never_plain(settings, env, tmp_path):
    out = tmp_path / "mediamtx.yml"
    write(settings, env, out)
    text = out.read_text()
    for key in ("FAIRPLAY_MEDIAMTX_PASSWORD", "FAIRPLAY_PUBLISH_PASSWORD_GROUND", "FAIRPLAY_PUBLISH_PASSWORD_DRONE"):
        assert env[key] not in text
    # The header is a YAML comment; the body must still parse as JSON.
    users = {u["user"]: u["pass"] for u in json.loads(text.split("\n", 3)[3])["authInternalUsers"]}
    assert all(p.startswith("argon2:$argon2id$v=19$") for p in users.values())
    assert matches(env["FAIRPLAY_PUBLISH_PASSWORD_GROUND"], users["pub-ground"])
    assert matches(env["FAIRPLAY_MEDIAMTX_PASSWORD"], users["fairplay-edge"])
    assert not matches(env["FAIRPLAY_PUBLISH_PASSWORD_DRONE"], users["pub-ground"])


def test_each_hash_has_its_own_salt():
    assert hashed("same-secret-value-for-both-0123456789") != hashed("same-secret-value-for-both-0123456789")


def test_unused_listeners_off_and_no_wildcard_origins(cfg):
    for key in ALWAYS_OFF:
        assert cfg[key] is False, key
    assert cfg["rtmp"] is False and cfg["srt"] is False  # no source uses them
    assert cfg["rtsp"] is True
    assert cfg["playbackAllowOrigins"] == [] and cfg["apiAllowOrigins"] == []


def test_recording_defaults_are_safe(cfg):
    d = cfg["pathDefaults"]
    assert d["record"] is True and d["recordFormat"] == "fmp4"
    assert d["recordDeleteAfter"] == "0s"  # upstream default deletes after 1d
    assert d["overridePublisher"] is False  # upstream default lets a second client take over
    assert "%z" in d["recordPath"]
    assert not any(k.startswith("runOn") for k in d)


def test_only_configured_paths_exist(cfg):
    assert set(cfg["paths"]) == {"ground", "drone"}


def test_native_mode_binds_control_to_loopback(settings, env):
    native = render(settings, env, mode="native")
    assert native["apiAddress"].startswith("127.0.0.1:") and native["playbackAddress"].startswith("127.0.0.1:")


def test_refuses_empty_publish_networks(settings, env):
    from dataclasses import replace

    with pytest.raises(ConfigError, match="any IP"):
        render(replace(settings, publish_allowed_cidrs=()), env)


def test_refuses_a_missing_publish_password(settings, env):
    del env["FAIRPLAY_PUBLISH_PASSWORD_DRONE"]
    with pytest.raises(ConfigError, match="DRONE"):
        render(settings, env)
