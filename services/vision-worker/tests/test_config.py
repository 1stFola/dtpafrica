from __future__ import annotations

import pytest

from dtp_vision_worker.config import ConfigError, load_config

VALID = {
    "VISION_WORKER_CALLBACK_URL": "https://api.example.test/api/v1/vision/worker",
    "VISION_BOOTSTRAP_TOKEN": "a" * 64,
    "VISION_RESOURCE_CLASS": "cpu_small",
}


def test_loads_a_valid_environment() -> None:
    config = load_config(VALID)
    assert config.resource_classes == ("cpu_small",)
    assert config.callback_url.endswith("/vision/worker")


def test_strips_a_trailing_slash_so_paths_do_not_double_up() -> None:
    config = load_config({**VALID, "VISION_WORKER_CALLBACK_URL": "https://x/worker/"})
    assert config.callback_url == "https://x/worker"


def test_accepts_several_resource_classes() -> None:
    config = load_config({**VALID, "VISION_RESOURCE_CLASS": "cpu_small, gpu_24gb"})
    assert config.resource_classes == ("cpu_small", "gpu_24gb")


@pytest.mark.parametrize(
    "missing",
    ["VISION_WORKER_CALLBACK_URL", "VISION_BOOTSTRAP_TOKEN", "VISION_RESOURCE_CLASS"],
)
def test_dies_at_startup_on_a_missing_setting(missing: str) -> None:
    env = {k: v for k, v in VALID.items() if k != missing}
    with pytest.raises(ConfigError) as exc:
        load_config(env)
    assert missing in str(exc.value)


def test_reports_every_problem_at_once_not_one_per_restart() -> None:
    with pytest.raises(ConfigError) as exc:
        load_config({})
    message = str(exc.value)
    assert "VISION_WORKER_CALLBACK_URL" in message
    assert "VISION_BOOTSTRAP_TOKEN" in message
    assert "VISION_RESOURCE_CLASS" in message


def test_rejects_a_non_numeric_interval() -> None:
    with pytest.raises(ConfigError, match="must be a number"):
        load_config({**VALID, "VISION_POLL_SECONDS": "soon"})


def test_rejects_a_non_positive_interval() -> None:
    with pytest.raises(ConfigError, match="must be positive"):
        load_config({**VALID, "VISION_HEARTBEAT_SECONDS": "0"})


def test_a_worker_learns_nothing_about_storage_or_the_database() -> None:
    """The portability requirement, asserted.

    A worker that needed a storage credential or a database URL could not be
    handed to an arbitrary provider, and a compromised pod would reach far more
    than its own job's output.
    """
    config = load_config(
        {
            **VALID,
            # Even if a launch spec leaked these in, nothing reads them.
            "VISION_R2_SECRET_ACCESS_KEY": "should-be-ignored",
            "DATABASE_URL": "postgresql://should-be-ignored",
        }
    )
    serialised = repr(config)
    assert "should-be-ignored" not in serialised
    assert not hasattr(config, "database_url")
    assert not hasattr(config, "secret_access_key")
