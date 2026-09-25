"""Entrypoint.

Exit codes matter to whatever supervises the container: 0 means the queue drained
cleanly, 2 means the image is incompatible with the control plane and restarting
will not help.
"""

from __future__ import annotations

import logging
import os
import sys

from .config import ConfigError, load_config
from .control_plane import ContractMismatchError
from .runner import Worker


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("VISION_LOG_LEVEL", "INFO").upper(),
        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
    )
    log = logging.getLogger("dtp_vision_worker")

    try:
        config = load_config()
    except ConfigError as exc:
        log.error("%s", exc)
        return 2

    worker = Worker(config)
    try:
        worker.run_forever()
    except ContractMismatchError as exc:
        # Restarting cannot fix a version mismatch, so say so plainly and stop.
        log.error("incompatible control plane: %s", exc)
        return 2
    except KeyboardInterrupt:
        log.info("interrupted")
    finally:
        worker.close()

    log.info("completed %s job(s), failed %s", worker.jobs_completed, worker.jobs_failed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
