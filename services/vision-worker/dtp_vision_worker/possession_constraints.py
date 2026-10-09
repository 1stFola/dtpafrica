"""Additional ground-plane vetoes; a projected ball is not evidence of height/control.

A camera segment's calibration is one homography (a still camera), or `carried`: a
moving camera calibrated by keyframes, whose every frame has its own homography from
a pinned `calibrate` run (docs/vision/94). A carried frame no keyframe reached is
`calibration_unavailable`, as an uncalibrated segment is.
"""
from dataclasses import asdict, dataclass
import math

from .ball_trajectory import integer, number
from .carried_frames import CarriedFrames, parse_pin
from .gamestate import project

VERSION = "possession-candidates/v2"
REASONS = ("calibration_unavailable", "projection_invalid", "off_pitch", "metric_distance", "implausible_motion")


@dataclass(frozen=True)
class FootballConfig:
    maxGroundDistanceM: float = 2.0
    maxBallGroundSpeedMps: float = 35.0
    maxPlayerSpeedMps: float = 12.0

    @classmethod
    def parse(cls, raw):
        raw = {} if raw is None else raw
        ranges = {"maxGroundDistanceM": (.1, 3), "maxBallGroundSpeedMps": (5, 50), "maxPlayerSpeedMps": (2, 15)}
        if not isinstance(raw, dict) or any(k not in ranges or not number(v) or not ranges[k][0] <= v <= ranges[k][1] for k, v in raw.items()):
            raise ValueError("invalid footballConfig distance/motion limits")
        return cls(**raw)


def carried_segment_ids(snapshot) -> set[str]:
    """The segments of a snapshot calibrated by keyframes, read frame by frame."""
    rows = snapshot.get("segments") if isinstance(snapshot, dict) else None
    return {r["cameraSegmentId"] for r in rows or [] if isinstance(r, dict) and r.get("quality") == "carried" and isinstance(r.get("cameraSegmentId"), str)}


class Constraints:
    def __init__(self, clock, snapshot, config=None, carried: CarriedFrames | None = None):
        if not isinstance(snapshot, dict) or not integer(snapshot.get("proxyWidth")) or not integer(snapshot.get("proxyHeight")) or snapshot["proxyWidth"] <= 0 or snapshot["proxyHeight"] <= 0:
            raise ValueError("calibrated constraints need explicit proxy geometry")
        declared = snapshot.get("segments")
        if any(not isinstance(snapshot.get(k), str) or not snapshot[k] for k in ("proxyVariantId", "proxyKey")):
            raise ValueError("calibration snapshot needs the proxy variant identity")
        if not isinstance(declared, list) or len(declared) != len(clock.segments):
            raise ValueError("calibrations must match every pinned camera segment")
        self.by_id = {}
        self_carried = False
        for camera, row in zip(clock.segments, declared, strict=True):
            if not isinstance(row, dict) or any(row.get(k) != camera[k] for k in ("cameraSegmentId", "startMs", "endMs")):
                raise ValueError("calibration and camera snapshots disagree")
            quality = row.get("quality")
            if quality not in {None, "failed", "good", "usable", "carried"}:
                raise ValueError("unsupported calibration quality")
            if quality == "carried":
                keyframes, pitch = row.get("keyframeIds"), row.get("pitch")
                if (row.get("calibrationId") is not None or row.get("homography") is not None or not isinstance(row.get("thresholdsVersion"), str) or not row["thresholdsVersion"]
                        or not isinstance(keyframes, list) or not keyframes or any(not isinstance(k, str) or not k for k in keyframes) or len(set(keyframes)) != len(keyframes)
                        or not isinstance(pitch, dict) or any(not number(pitch.get(k)) or not 0 < pitch[k] <= 200 for k in ("lengthM", "widthM"))):
                    raise ValueError("a carried calibration names its keyframes and pitch, and no single transform")
                self_carried = True
                self.by_id[row["cameraSegmentId"]] = row
                continue
            if quality is not None and (not isinstance(row.get("calibrationId"), str) or not row["calibrationId"] or not isinstance(row.get("thresholdsVersion"), str) or not row["thresholdsVersion"]):
                raise ValueError("calibration needs immutable identity and threshold version")
            if quality is None and any(row.get(k) is not None for k in ("calibrationId", "thresholdsVersion", "homography", "pitch")):
                raise ValueError("uncalibrated camera cannot carry calibration evidence")
            if quality == "failed" and (row.get("homography") is not None or row.get("pitch") is not None):
                raise ValueError("failed calibration cannot supply pitch coordinates")
            if quality in {"good", "usable"}:
                h, pitch = row.get("homography"), row.get("pitch")
                if not isinstance(h, list) or len(h) != 9 or any(not number(v) for v in h) or not isinstance(pitch, dict) or any(not number(pitch.get(k)) or not 0 < pitch[k] <= 200 for k in ("lengthM", "widthM")):
                    raise ValueError("passing calibration needs a finite transform and pitch")
                determinant = h[0]*(h[4]*h[8]-h[5]*h[7])-h[1]*(h[3]*h[8]-h[5]*h[6])+h[2]*(h[3]*h[7]-h[4]*h[6])
                if not math.isfinite(determinant) or abs(determinant) < 1e-14:
                    raise ValueError("singular calibrated transform")
            self.by_id[row["cameraSegmentId"]] = row
        if self_carried:
            parse_pin(snapshot.get("carried"))
            if carried is None:
                raise ValueError("carried calibrations were declared but not loaded")
        elif snapshot.get("carried") is not None:
            raise ValueError("a carried calibration run is pinned for no carried segment")
        self.snapshot, self.clock = snapshot, clock
        self.carried = carried
        self.config = config or FootballConfig()
        self.previous = None

    def homography_at(self, ms, camera_id):
        """(homography, pitch) for this source millisecond on this camera, or None."""
        row = self.by_id.get(camera_id)
        if not row:
            return None
        if row["quality"] == "carried":
            h = self.carried.at_ms(ms, camera_id) if self.carried is not None else None
            return (h, row["pitch"]) if h is not None else None
        if row["quality"] in {"good", "usable"}:
            return row["homography"], row["pitch"]
        return None

    def clear(self):
        self.previous = None

    def check(self, ms, camera_id, trajectory, ball, player):
        found = self.homography_at(ms, camera_id)
        if found is None:
            self.clear()
            return "calibration_unavailable"
        homography, pitch = found
        sx, sy = self.snapshot["proxyWidth"] / self.clock.width, self.snapshot["proxyHeight"] / self.clock.height
        bp = project(homography, ball[0] * sx, ball[1] * sy)
        pp = project(homography, player[1] * sx, player[2] * sy)
        if bp is None or pp is None or any(not math.isfinite(v) for p in (bp, pp) for v in p):
            self.clear()
            return "projection_invalid"
        if any(not (0 <= p[0] <= pitch["lengthM"] and 0 <= p[1] <= pitch["widthM"]) for p in (bp, pp)):
            self.clear()
            return "off_pitch"
        previous = self.previous
        self.previous = (ms, camera_id, trajectory, player[0], bp, pp)
        if previous and previous[1:3] == (camera_id, trajectory):
            dt = (ms - previous[0]) / 1000
            if dt <= 0:
                raise ValueError("ground-plane motion requires ordered source observations")
            if math.dist(bp, previous[4]) / dt > self.config.maxBallGroundSpeedMps or (previous[3] == player[0] and math.dist(pp, previous[5]) / dt > self.config.maxPlayerSpeedMps):
                return "implausible_motion"
        if math.dist(bp, pp) > self.config.maxGroundDistanceM:
            return "metric_distance"
        return None

    def evidence(self):
        return {"constraintMode": "calibrated", "calibrationSnapshot": self.snapshot, "footballConfig": asdict(self.config)}
