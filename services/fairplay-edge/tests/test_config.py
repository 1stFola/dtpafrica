import pytest

from fairplay_edge.config import ConfigError, load_settings, load_sources


def test_loads_two_sources(settings):
    assert [s.name for s in settings.sources] == ["ground", "drone"]
    assert settings.source("ground").required and not settings.source("drone").required
    assert settings.retention_days is None  # retention is off unless set


@pytest.mark.parametrize("value, why", [
    ("", "not set"),
    ("short", "shorter than"),
    ("CHANGE_ME-but-long-enough-to-pass-length", "placeholder"),
])
def test_refuses_weak_secrets(env, value, why):
    env["FAIRPLAY_EDGE_API_TOKEN"] = value
    with pytest.raises(ConfigError, match=why):
        load_settings(env)


def test_refuses_lan_exposure_without_tls(env):
    env["FAIRPLAY_EDGE_HOST_BIND"] = "192.168.1.20"
    with pytest.raises(ConfigError, match="requires FAIRPLAY_EDGE_TLS_CERT"):
        load_settings(env)


def test_allows_lan_exposure_with_tls(env, tmp_path):
    env.update(FAIRPLAY_EDGE_HOST_BIND="192.168.1.20", FAIRPLAY_EDGE_TLS_CERT=str(tmp_path / "c.pem"),
               FAIRPLAY_EDGE_TLS_KEY=str(tmp_path / "k.pem"))
    assert load_settings(env).host_bind == "192.168.1.20"


def test_refuses_half_tls(env, tmp_path):
    env["FAIRPLAY_EDGE_TLS_CERT"] = str(tmp_path / "c.pem")
    with pytest.raises(ConfigError, match="both"):
        load_settings(env)


@pytest.mark.parametrize("body, why", [
    ('[[source]]\nname="drone"\nrole="drone"\n', "exactly one ground"),
    ('[[source]]\nname="g"\nrole="ground"\n[[source]]\nname="h"\nrole="ground"\n', "exactly one ground"),
    ('[[source]]\nname="ground"\nrole="ground"\nrequired=false\n', "must be required"),
    ('[[source]]\nname="Ground Cam"\nrole="ground"\n', "source name"),
    ('[[source]]\nname="ground"\nrole="ground"\nprotocol="ndi"\n', "protocol"),
    ('[[source]]\nname="ground"\nrole="ground"\n[[source]]\nname="ground"\nrole="drone"\n', "unique"),
])
def test_rejects_bad_sources(tmp_path, body, why):
    path = tmp_path / "s.toml"
    path.write_text(body, encoding="utf-8")
    with pytest.raises(ConfigError, match=why):
        load_sources(path)


def test_retention_days_must_be_positive(env):
    env["FAIRPLAY_RETENTION_DAYS"] = "0"
    with pytest.raises(ConfigError, match="at least 1"):
        load_settings(env)
