"""Entrypoint.

Exit codes matter to whatever supervises the container: 0 means the queue drained
cleanly, 2 means the image is incompatible with the control plane and restarting
will not help.
"""

from __future__ import annotations

import logging
import os
import signal
import sys

from .config import ConfigError, load_config
from .control_plane import ContractMismatchError
from .logging_config import configure_logging
from .runner import Worker, WorkerTerminated


def _terminate(signum: int, _frame: object) -> None:
    # Raised in the main thread wherever it is: between jobs, or inside a stage while
    # ffmpeg runs (subprocess.run kills its child on the way out).
    raise WorkerTerminated(signal.Signals(signum).name)


def main() -> int:
    configure_logging(os.environ.get("VISION_LOG_LEVEL", "INFO").upper())
    log = logging.getLogger("dtp_vision_worker")

    try:
        config = load_config()
    except ConfigError as exc:
        log.error("%s", exc)
        return 2

    worker = Worker(config)
    # PID 1 ignores SIGTERM unless it installs a handler, so without this every deploy
    # waited out the grace period and SIGKILLed the worker mid-job (docs/vision/50, PR-2).
    signal.signal(signal.SIGTERM, _terminate)
    try:
        worker.run_forever()
    except ContractMismatchError as exc:
        # Restarting cannot fix a version mismatch, so say so plainly and stop.
        log.error("incompatible control plane: %s", exc)
        return 2
    except KeyboardInterrupt:
        log.info("interrupted")
    except WorkerTerminated as exc:
        log.info("terminated by %s", exc)
    finally:
        worker.close()

    log.info("completed %s job(s), failed %s", worker.jobs_completed, worker.jobs_failed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
