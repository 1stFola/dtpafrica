import hashlib
from types import SimpleNamespace

from dtp_vision_worker.stages import transcode


def test_proxy_width_uses_encoded_metadata_and_never_guesses(monkeypatch, tmp_path):
    monkeypatch.setattr(transcode, "probe", lambda _p: SimpleNamespace(width=1280))
    assert transcode.proxy_width_px(tmp_path / "proxy.mp4") == 1280
    def unavailable(_p): raise ValueError("no encoded geometry")
    monkeypatch.setattr(transcode, "probe", unavailable)
    assert transcode.proxy_width_px(tmp_path / "proxy.mp4") is None


def test_transcode_completion_carries_exact_proxy_width_and_bytes_checksum(monkeypatch, tmp_path):
    meta = SimpleNamespace(width=1280, duration_ms=400, is_variable_frame_rate=False, as_summary=lambda: {"durationMs": 400})
    monkeypatch.setattr(transcode, "probe", lambda _p: meta)
    monkeypatch.setattr(transcode, "download", lambda _ctx, _url, path: (path.write_bytes(b"QA MASTER")))
    def encode(_src, target):
        target.write_bytes(b"QA PROXY")
        return {"fps": 25, "height": 720, "bytes": 8, "settingsHash": "qa", "encoder": "qa"}
    monkeypatch.setattr(transcode, "transcode_proxy", encode)
    monkeypatch.setattr(transcode, "upload", lambda _ctx, _url, path, _type: path.stat().st_size)
    def no_thumbnail(*_args): raise ValueError("synthetic QA skips thumbnails")
    monkeypatch.setattr(transcode, "thumbnail", no_thumbnail)
    ctx = SimpleNamespace(work_dir=tmp_path, progress=SimpleNamespace(set=lambda *_args: None),
                          job=SimpleNamespace(job_id="qa", output_prefix="inference/qa/1/"),
                          client=SimpleNamespace(input_url=lambda *_a, **_k: "master", presign_output=lambda _job, key, _type: key))
    result = transcode.run_transcode(ctx)
    assert result.summary["proxy"]["width"] == 1280
    assert result.summary["proxy"]["checksumSha256"] == hashlib.sha256(b"QA PROXY").hexdigest()
