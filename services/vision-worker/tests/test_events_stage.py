import hashlib
import json

import pytest

from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.event_carry import VERSION, MANIFEST_CHECKSUM
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import events as stage


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    def sha(body): return hashlib.sha256(body).hexdigest()
    camera = {"cameraSegmentId": "cam", "startMs": 0, "endMs": 2000, "kind": "live_play"}
    snapshot = {"proxyWidth": 1000, "proxyHeight": 500, "proxyVariantId": "proxy", "proxyKey": "proxy.mp4", "proxyChecksum": "b" * 64,
                "segments": [{**{k: camera[k] for k in ("cameraSegmentId", "startMs", "endMs")}, "quality": "good", "calibrationId": "cal", "thresholdsVersion": "test",
                              "homography": [.1, 0, 0, 0, .1, 0, 0, 0, 1], "pitch": {"lengthM": 105, "widthM": 68}}]}
    shared = {"sourceChecksum": "a" * 64, "proxyChecksum": "b" * 64, "detectionsChecksum": "c" * 64, "proxy": {"fps": 25, "sourceOffsetMs": 0}, "imageWidth": 1000, "imageHeight": 500,
              "detectorJobId": "detect", "detectorVersionId": "detector", "trackerVersionId": "tracker"}
    tracks = {**shared, "role": "tracks", "videoAssetId": "asset", "detectJobId": "detect", "sampleFps": 25, "proxyDurationMs": 2000, "cameraCuts": [],
              "tracks": [{"localTrackId": 1, "confirmed": True, "class": "player", "positions": [{"frameIndex": i, "proxyTimeMs": i * 40, "sourceTimeMs": i * 40, "confidence": .9,
              "box": {"x": 100 + i, "y": 100, "width": 20, "height": 100}} for i in range(50)]}]}
    rows = [{"startMs": 0, "endMs": 200, "frames": 5, "state": "unknown", "reason": "continuity_pending", "localTrackId": None, "trajectoryId": 1, "cameraSegmentId": "cam", "evidenceConfidence": None, "reviewState": "unreviewed"},
            {"startMs": 200, "endMs": 2000, "frames": 45, "state": "candidate", "reason": None, "localTrackId": 1, "trajectoryId": 1, "cameraSegmentId": "cam", "evidenceConfidence": .8, "reviewState": "unreviewed"}]
    index = {**shared, "videoAssetId": "asset", "role": "possession", "calculationVersion": "possession-candidates/v2", "constraintMode": "calibrated", "cameraSegments": [camera], "frames": 50,
             "segments": 2, "calibrationSnapshot": snapshot, "footballConfig": {}, "trackJobId": "track", "chunks": [{"key": "chunk", "segments": 2}]}
    params = {"sourceChecksum": shared["sourceChecksum"], "sourceDurationMs": 2000, "windowStartMs": 0, "windowEndMs": 2000, "possessionIndex": index, "possessionSource": {"proxyDurationMs": 2000},
              "possession": {"jobId": "possession", "key": "index"}, "tracks": {"jobId": "track", "key": "tracks", "trackerVersionId": "tracker"},
              "eventAlgorithm": {"modelVersionId": "model", "configKey": VERSION, "manifestChecksum": MANIFEST_CHECKSUM, "weightsChecksum": None, "gitCommit": "commit", "workerImage": "image"}}
    objects, uploaded = {}, {}
    def repin():
        objects["tracks"] = json.dumps(tracks).encode(); params["tracks"]["checksum"] = sha(objects["tracks"]); index["tracksChecksum"] = params["tracks"]["checksum"]
        objects["chunk"] = b"".join((json.dumps(r) + "\n").encode() for r in rows); index["chunks"][0]["checksumSha256"] = sha(objects["chunk"])
        objects["index"] = json.dumps(index).encode(); params["possession"]["indexChecksum"] = sha(objects["index"])
    repin()
    class Client:
        asked = []
        def input_url(self, job_id, role, key=None): self.asked.append((role, key)); return key
        def presign_output(self, job_id, key, content_type): return key
    class Progress:
        def set(self, *_): pass
    job = JobSpec(job_id="events", type="events", resource_class="cpu_small", attempt_number=1, inputs={"videoAssetId": "asset", "modelVersionIds": ["model"], "params": params},
                  output_prefix="inference/events/1/", budget_seconds=60, budget_usd_cents=0)
    ctx = StageContext(job=job, work_dir=tmp_path, client=Client(), progress=Progress(), http=None)
    def download(ctx, key, path): path.write_bytes(objects[key]); return len(objects[key])
    def upload(ctx, key, path, content_type): uploaded[key] = path.read_bytes(); return path.stat().st_size
    monkeypatch.setattr(stage, "download", download); monkeypatch.setattr(stage, "upload", upload)
    return ctx, params, index, tracks, rows, objects, uploaded, repin


def test_produces_one_bounded_original_carry_with_no_learned_weights(fixture):
    ctx, params, index, tracks, rows, objects, uploaded, repin = fixture
    result = stage.run_events(ctx)
    artifact = json.loads(uploaded["inference/events/1/events.json"])
    assert artifact["schemaVersion"] == "event-inference/v2"
    assert artifact["weightsChecksum"] is None and artifact["producer"]["manifestChecksum"] == MANIFEST_CHECKSUM
    assert artifact["events"][0]["startMs"] == 200 and artifact["events"][0]["endMs"] == 1960
    assert artifact["events"][0]["displacementM"] == pytest.approx(4.4)
    assert artifact["events"][0]["actorMatchSquadPlayerId"] is None
    assert result.summary["reviewState"] == "unreviewed" and result.summary["eventCount"] == 1
    assert result.summary["producer"] == artifact["producer"]
    assert result.model_version_ids == ["model"] and result.gpu_seconds is None
    assert ctx.client.asked == [("declared", "index"), ("declared", "tracks"), ("declared", "chunk")]


def test_all_unknown_is_explicit_complete_zero_output(fixture):
    ctx, params, index, tracks, rows, objects, uploaded, repin = fixture
    rows[1].update(state="unknown", localTrackId=None, evidenceConfidence=None, reason="weak_ball")
    repin()
    result = stage.run_events(ctx)
    assert result.summary["eventCount"] == 0
    artifact = json.loads(uploaded["inference/events/1/events.json"])
    assert artifact["coverage"] == {"startMs": 0, "endMs": 2000, "complete": True} and artifact["events"] == []


@pytest.mark.parametrize("change", ["gpu", "weights", "model", "manifest", "legacy", "source", "index_sha", "track_sha", "chunk_sha", "frame_gap", "manual", "cut", "detector", "sparse", "rows", "truncated", "coverage"])
def test_refuses_incompatible_inputs_without_upload(fixture, change):
    ctx, params, index, tracks, rows, objects, uploaded, repin = fixture
    if change == "gpu": ctx.job.resource_class = "gpu_24gb"
    if change == "weights": params["eventAlgorithm"]["weightsChecksum"] = "a" * 64
    if change == "model": ctx.job.inputs["modelVersionIds"] = ["other"]
    if change == "manifest": params["eventAlgorithm"]["manifestChecksum"] = "f" * 64
    if change == "legacy": index["calculationVersion"] = "possession-candidates/v1"
    if change == "source": index["sourceChecksum"] = "f" * 64
    if change == "frame_gap": rows[1]["startMs"] = 240
    if change == "manual": rows[1]["reviewState"] = "accepted"
    if change == "cut": tracks["cameraCuts"] = None
    if change == "detector": tracks["detectJobId"] = "other"
    if change == "sparse": tracks["sampleFps"] = 2
    if change == "rows": index["chunks"][0]["segments"] = 1
    if change == "truncated": rows.pop()
    if change == "coverage": params["windowEndMs"] = 2001
    repin()
    if change == "index_sha": objects["index"] += b" "
    if change == "track_sha": objects["tracks"] += b" "
    if change == "chunk_sha": objects["chunk"] += b" "
    with pytest.raises(StageRefusal): stage.run_events(ctx)
    assert uploaded == {}


def test_a_carry_on_a_moving_camera_is_judged_through_the_run_its_possession_was(fixture, monkeypatch):
    from dtp_vision_worker import runner
    ctx, params, index, tracks, rows, objects, uploaded, repin = fixture
    # Carried for frames 0-39 only: the carry ends where the calibration does.
    chunk = b"".join((json.dumps({"f": f, "cameraSegmentId": "cam", "H": [.1, 0, 0, 0, .1, 0, 0, 0, 1], "quality": "good"}) + "\n").encode() for f in range(40))
    objects["c0"] = chunk
    objects["cindex"] = json.dumps({"role": "calibration_frames", "proxy": {"fps": 25, "sourceOffsetMs": 0}, "chunks": [{"key": "c0", "sha256": hashlib.sha256(chunk).hexdigest()}]}).encode()
    index["calibrationSnapshot"]["segments"][0] |= {"quality": "carried", "calibrationId": None, "homography": None, "keyframeIds": ["k1"]}
    index["calibrationSnapshot"]["carried"] = {"jobId": "c", "indexKey": "cindex", "indexChecksum": hashlib.sha256(objects["cindex"]).hexdigest(), "chunkKeys": ["c0"]}
    repin()
    monkeypatch.setattr(runner, "download", lambda ctx, key, path: path.write_bytes(objects[key]) or len(objects[key]))
    stage.run_events(ctx)
    artifact = json.loads(uploaded["inference/events/1/events.json"])
    assert [(e["startMs"], e["endMs"]) for e in artifact["events"]] == [(200, 1560)]
    assert ("declared", "cindex") in ctx.client.asked and ("declared", "c0") in ctx.client.asked
    assert artifact["producer"]["calibrationSnapshot"]["carried"] == index["calibrationSnapshot"]["carried"]


def test_a_carried_possession_whose_run_changed_is_refused(fixture, monkeypatch):
    from dtp_vision_worker import runner
    ctx, params, index, tracks, rows, objects, uploaded, repin = fixture
    objects["cindex"] = b"{}"
    index["calibrationSnapshot"]["segments"][0] |= {"quality": "carried", "calibrationId": None, "homography": None, "keyframeIds": ["k1"]}
    index["calibrationSnapshot"]["carried"] = {"jobId": "c", "indexKey": "cindex", "indexChecksum": "f" * 64, "chunkKeys": ["c0"]}
    repin()
    monkeypatch.setattr(runner, "download", lambda ctx, key, path: path.write_bytes(objects[key]) or len(objects[key]))
    with pytest.raises(StageRefusal):
        stage.run_events(ctx)
    assert not uploaded


def test_a_queued_index_a_unit_in_the_last_place_off_its_artifact_is_the_same_evidence(fixture):
    # docs/vision/97: 51/3615 came back from the job row with 16 digits, not the artifact's 17.
    ctx, params, index, tracks, rows, objects, uploaded, repin = fixture
    index["candidateFrameCoverage"] = 0.014107883817427386
    repin()
    queued = json.loads(json.dumps(index)); queued["candidateFrameCoverage"] = 0.01410788381742739
    assert queued["candidateFrameCoverage"] != index["candidateFrameCoverage"]
    params["possessionIndex"] = queued
    assert stage.run_events(ctx).summary["eventCount"] == 1


def test_a_queued_index_that_really_differs_is_still_refused(fixture):
    ctx, params, index, tracks, rows, objects, uploaded, repin = fixture
    index["candidateFrameCoverage"] = 0.0141
    repin()
    queued = json.loads(json.dumps(index)); queued["candidateFrameCoverage"] = 0.0142
    params["possessionIndex"] = queued
    with pytest.raises(StageRefusal): stage.run_events(ctx)
    assert uploaded == {}
