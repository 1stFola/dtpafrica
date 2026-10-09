"""Carry proposals over original calibrated possession and exact player observations.

No player identity, team transition, ball height or learned event model is inferred.
The thresholds are provisional, reproducible rules awaiting footage evaluation.
"""
import hashlib
import json
import math

from .ball_trajectory import integer, number
from .gamestate import project
from .possession_constraints import Constraints, FootballConfig

VERSION = "event-carry/v1"
MANIFEST = {"algorithm": VERSION, "minDurationMs": 1000, "minDisplacementM": 2, "maxPlayerSpeedMps": 12, "maxEvents": 200}
MANIFEST_CHECKSUM = hashlib.sha256(json.dumps(MANIFEST, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def propose(clock, segments, players, snapshot, football_config, carried=None):
    constraints = Constraints(clock, snapshot, FootballConfig.parse(football_config), carried)
    events, pending = [], None
    frames = 0

    def flush():
        nonlocal pending
        if pending is not None:
            # Duration is between observed points, not the held last frame interval.
            displacement = math.dist(pending["first"], pending["last"])
            if pending["lastMs"] - pending["startMs"] >= MANIFEST["minDurationMs"] and displacement >= MANIFEST["minDisplacementM"]:
                if len(events) >= MANIFEST["maxEvents"]:
                    raise ValueError("split the source window: more than 200 carry proposals")
                events.append({"id": f"carry-{len(events) + 1}", "type": "carry", "startMs": pending["startMs"], "endMs": pending["lastMs"],
                               "actorMatchSquadPlayerId": None, "localTrackId": pending["identity"][2], "cameraSegmentId": pending["identity"][0],
                               "trajectoryId": pending["identity"][1], "confidence": pending["confidence"], "inPlay": True, "displacementM": displacement})
        pending = None

    for row in segments:
        if not isinstance(row, dict) or not integer(row.get("frames")) or row["frames"] < 1 or row.get("reviewState") != "unreviewed":
            raise ValueError("carry rules read original unreviewed possession rows only")
        end_frame = frames + row["frames"]
        if end_frame > clock.frames or row.get("startMs") != clock.offset + round(frames * 1000 / clock.fps) or row.get("endMs") != min(clock.end_ms, clock.offset + round(end_frame * 1000 / clock.fps)):
            raise ValueError("possession rows do not cover the exact source frame clock")
        state = row.get("state")
        if state not in {"candidate", "unknown"}:
            raise ValueError("unsupported original possession state")
        if state == "unknown":
            if row.get("localTrackId") is not None or row.get("evidenceConfidence") is not None:
                raise ValueError("Unknown cannot name a possessor")
            flush()
        else:
            local, trajectory = row.get("localTrackId"), row.get("trajectoryId")
            score = row.get("evidenceConfidence")
            camera_id = row.get("cameraSegmentId")
            camera = clock.at(row["startMs"])
            calibration = constraints.by_id.get(camera_id)
            if not integer(local) or local < 0 or not integer(trajectory) or trajectory < 1 or not number(score) or not 0 <= score <= 1 or row.get("reason") is not None:
                raise ValueError("candidate lacks original local actor/trajectory/confidence")
            if not camera or camera["cameraSegmentId"] != camera_id or camera["kind"] != "live_play" or row["endMs"] > camera["endMs"] or not calibration or calibration["quality"] not in {"good", "usable", "carried"}:
                raise ValueError("candidate must be wholly inside its passing calibrated live camera")
            identity = (camera_id, trajectory, local)
            for frame in range(frames, end_frame):
                ms = clock.offset + round(frame * 1000 / clock.fps)
                observed = [p for p in players.at(frame) if p[0] == local and p[5] and p[4] >= .5]
                if len(observed) != 1:
                    flush()  # no interpolation through missing/unconfirmed/weak observations
                    continue
                player = observed[0]
                # This frame's calibration: the segment's, or the one carried to this frame (docs/vision/94).
                found = constraints.homography_at(ms, camera_id)
                if found is None:
                    flush()  # a frame no keyframe reached is not placed, and does not bridge a carry
                    continue
                homography, pitch = found
                point = project(homography, player[1] * snapshot["proxyWidth"] / clock.width, player[2] * snapshot["proxyHeight"] / clock.height)
                if point is None or any(not math.isfinite(v) for v in point) or not (0 <= point[0] <= pitch["lengthM"] and 0 <= point[1] <= pitch["widthM"]):
                    flush()
                    continue
                if pending and pending["identity"] != identity:
                    flush()
                if pending:
                    dt = (ms - pending["lastMs"]) / 1000
                    if dt <= 0 or math.dist(point, pending["last"]) / dt > min(MANIFEST["maxPlayerSpeedMps"], constraints.config.maxPlayerSpeedMps):
                        flush()
                if pending is None:
                    pending = {"identity": identity, "startMs": ms, "lastMs": ms, "first": point, "last": point, "confidence": min(score, player[4])}
                else:
                    pending.update(lastMs=ms, last=point, confidence=min(pending["confidence"], score, player[4]))
        frames = end_frame
    if frames != clock.frames:
        raise ValueError("possession evidence ends before complete source coverage")
    flush()
    return events
