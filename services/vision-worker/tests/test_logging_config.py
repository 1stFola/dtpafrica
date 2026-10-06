import io
import json
import logging

import httpx

from dtp_vision_worker.logging_config import SafeJsonFormatter, configure_logging


def test_httpx_request_log_drops_presigned_credentials():
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    handler.setFormatter(SafeJsonFormatter())
    logger = logging.getLogger("httpx")
    old_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    try:
        with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200))) as client:
            client.get("https://bucket.example/clip.mp4?X-Amz-Credential=PRIVATE-ID&X-Amz-Signature=PRIVATE-SIGNATURE")
        row = json.loads(output.getvalue())
        assert row["logger"] == "httpx"
        assert "clip.mp4" in row["msg"]
        assert "200 OK" in row["msg"]
        assert "PRIVATE-ID" not in output.getvalue()
        assert "PRIVATE-SIGNATURE" not in output.getvalue()
        assert "X-Amz-" not in output.getvalue()
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)


def test_formatter_redacts_exception_urls_and_escapes_json():
    try:
        raise RuntimeError('download "failed"\nhttps://bucket.example/master?token=SECRET')
    except RuntimeError:
        import sys
        record = logging.LogRecord("worker", logging.ERROR, __file__, 1, 'job %s failed', ("job-1",), sys.exc_info())
    formatted = SafeJsonFormatter().format(record)
    row = json.loads(formatted)
    assert row["level"] == "ERROR"
    assert 'download "failed"' in row["msg"]
    assert "SECRET" not in formatted
    assert "master" in row["msg"]


def test_configuration_sanitizes_existing_root_handlers(monkeypatch):
    handler = logging.StreamHandler(io.StringIO())
    monkeypatch.setattr(logging.getLogger(), "handlers", [handler])
    configure_logging("INFO")
    assert isinstance(handler.formatter, SafeJsonFormatter)
