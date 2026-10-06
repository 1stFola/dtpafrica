"""Sanitize all worker output, including third-party HTTP request logs."""

from __future__ import annotations

import json
import logging

from .control_plane import redact_urls


class SafeJsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        message = redact_urls(record.getMessage())
        if record.exc_info:
            message += "\n" + redact_urls(self.formatException(record.exc_info))
        if record.stack_info:
            message += "\n" + redact_urls(record.stack_info)
        return json.dumps({
            "ts": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "msg": message,
        })


def configure_logging(level: str) -> None:
    logging.basicConfig(level=level)
    # A root logger filter would miss propagated httpx records. Sanitize at the
    # output handlers instead, where records from every logger converge.
    for handler in logging.getLogger().handlers:
        handler.setFormatter(SafeJsonFormatter())
