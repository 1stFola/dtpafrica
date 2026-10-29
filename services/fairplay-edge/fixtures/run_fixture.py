"""FairPlay Edge fixtures: real MediaMTX, real ffmpeg, SYNTHETIC feeds only.

    python -I fixtures/run_fixture.py core            # ~6 minutes
    python -I fixtures/run_fixture.py wan --minutes 30
    python -I fixtures/run_fixture.py evidence        # Phase 3, ~8 minutes, WAN cut

`core`: two independent sources record; one disconnects and reconnects while the other
carries on; a recorded window is fetched and checked against its original segments; the
Edge restarts and its finalised recordings stay intact; MediaMTX is killed with SIGKILL and
the crashed segment is detected as partial and repaired.

`wan`: the same stack on a network with no route out, for `--minutes`, with a drone drop at
a third of the way and an Edge restart at two thirds.

`evidence` (Phase 3), with the network cut throughout: an incident at a known marker, a
doubled create, an edit collision, 30 s clips from both cameras checked frame by frame and
hash by hash, review, approval and export, a missing original, a clip job cut off by
SIGKILL, replay after the restart, and an outbox that keeps everything and sends nothing.

Each run writes `fixtures/out/<scenario>-<UTC>/` with generated secrets (never reused),
`results.json` and `log.md`. A check that fails is recorded and the run continues; nothing
is reported as passing that was not observed. Standard library only, so it runs on any
Python 3.11+ on the host; everything that needs the stack runs through `docker compose`.
"""

from __future__ import annotations

import argparse
import json
import secrets
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE_SCRIPT = r"""
import json, subprocess, sys
from fairplay_edge import mp4
p = sys.argv[1]
s = mp4.inspect(__import__('pathlib').Path(p))
out = subprocess.run(['ffprobe','-v','error','-print_format','json','-show_format','-show_streams',p],
                     capture_output=True, text=True)
fmt = json.loads(out.stdout or '{}').get('format', {})
print(json.dumps({'bytes': s.file_bytes, 'complete': s.is_complete, 'fragments': s.fragments,
                  'problems': list(s.problems), 'duration': float(fmt.get('duration') or 0)}))
"""


def utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# Where the synthetic red minute marker begins in a clip: decode tiny frames and find the
# rise in "redness" (red minus the mean of green and blue) above the clip's median.
MARKER_SCRIPT = r"""
import json, subprocess, sys
clip, fps = sys.argv[1], int(sys.argv[2])
w, h = 16, 9
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', clip, '-vf', f'scale={w}:{h}', '-f', 'rawvideo',
                      '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
n = w * h * 3
frames = [raw[i:i + n] for i in range(0, len(raw) - n + 1, n)]
vals = [(sum(f[0::3]) - (sum(f[1::3]) + sum(f[2::3])) / 2) / (w * h) for f in frames]
base = sorted(vals)[len(vals) // 2] if vals else 0
rise = next((i for i in range(1, len(vals)) if vals[i] - base > 40 and vals[i - 1] - base <= 40), None)
print(json.dumps({'frames': len(vals), 'baseline': round(base, 1), 'peak': round(max(vals, default=0), 1),
                  'riseFrame': rise, 'riseMs': None if rise is None else round(rise * 1000 / fps)}))
"""


class Run:
    def __init__(self, scenario: str, wan: bool, keep: bool, project: str = "fpfix"):
        self.scenario = scenario
        self.wan = wan
        self.keep = keep
        self.started = utc()
        self.out = ROOT / "fixtures" / "out" / f"{scenario}-{self.started.strftime('%Y%m%dT%H%M%SZ')}"
        self.out.mkdir(parents=True)
        self.project = project
        # Extra Compose files and variables, for scenarios built on this one (run_drills.py).
        self.overlays: list[str] = []
        self.extra_env: dict[str, str] = {}
        self.checks: list[dict] = []
        self.timeline: list[dict] = []
        self.measurements: dict = {}
        self._write_config()

    # ── setup ─────────────────────────────────────────────────────────────
    def _write_config(self) -> None:
        token = secrets.token_urlsafe(32)
        (self.out / "fixture.env").write_text("\n".join([
            f"FAIRPLAY_EDGE_API_TOKEN={token}",
            f"FAIRPLAY_MEDIAMTX_PASSWORD={secrets.token_urlsafe(32)}",
            "FAIRPLAY_MEDIAMTX_USER=fairplay-edge",
            "FAIRPLAY_PUBLISH_ALLOWED_CIDRS=172.31.250.0/24",
            "FAIRPLAY_RECORD_PART_DURATION=1s",
            "FAIRPLAY_RECORD_SEGMENT_DURATION=30s",
            "FAIRPLAY_FINALIZE_QUIET_SECONDS=10",
            "FAIRPLAY_RECORD_STALL_SECONDS=6",
            "FAIRPLAY_DISK_SOFT_FREE_GB=2",
            "FAIRPLAY_DISK_HARD_FREE_GB=1",
            "FAIRPLAY_DEVICE_LABEL=fixture",
        ]) + "\n", encoding="utf-8")
        (self.out / "fixture-publish.env").write_text(
            f"FAIRPLAY_PUBLISH_PASSWORD_GROUND={secrets.token_urlsafe(32)}\n"
            f"FAIRPLAY_PUBLISH_PASSWORD_DRONE={secrets.token_urlsafe(32)}\n", encoding="utf-8")
        shutil.copy(ROOT / "config" / "sources.example.toml", self.out / "sources.toml")

    def _empty(self, name: str) -> Path:
        folder = self.out / name
        folder.mkdir(exist_ok=True)
        return folder

    def compose(self, *args: str, check: bool = True, capture: bool = True, timeout: float = 600) -> str:
        files = ["-f", "compose.yaml"] + (["-f", "compose.wan-outage.yaml"] if self.wan else [])
        for overlay in self.overlays:
            files += ["-f", overlay]
        env = {
            **__import__("os").environ,
            "FAIRPLAY_ENV_FILE": str(self.out / "fixture.env"),
            "FAIRPLAY_PUBLISH_ENV_FILE": str(self.out / "fixture-publish.env"),
            "FAIRPLAY_SOURCES_PATH": str(self.out / "sources.toml"),
            # Phase 1 fixtures need no operator bundle or console; empty folders keep the
            # read-only mounts from pointing at whatever an operator left in ./auth.
            "FAIRPLAY_AUTH_DIR": str(self._empty("auth")),
            "FAIRPLAY_CONSOLE_PATH": str(self._empty("console")),
            **self.extra_env,
        }
        cmd = ["docker", "compose", "-p", self.project, *files, "--profile", "synthetic", *args]
        result = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=capture, text=True, timeout=timeout,
                                encoding="utf-8", errors="replace")
        if check and result.returncode != 0:
            raise RuntimeError(f"{' '.join(args)} failed ({result.returncode}): {result.stderr[-2000:]}")
        return result.stdout if capture else ""

    def api(self, method: str, path: str, body: dict | None = None):
        args = ["exec", "-T", "edge", "fairplay-edge", "api", method, path]
        if body is not None:
            args += ["--body", json.dumps(body)]
        out = self.compose(*args, check=False)
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return {"_raw": out}

    def edge_python(self, script: str, *argv: str) -> dict:
        out = self.compose("exec", "-T", "edge", "python", "-c", script, *argv, check=False)
        try:
            return json.loads(out.strip().splitlines()[-1])
        except (json.JSONDecodeError, IndexError):
            return {"_raw": out}

    # ── bookkeeping ───────────────────────────────────────────────────────
    def note(self, event: str, **detail) -> datetime:
        at = utc()
        self.timeline.append({"at": iso(at), "event": event, **detail})
        print(f"[{iso(at)}] {event} {json.dumps(detail) if detail else ''}", flush=True)
        return at

    def check(self, name: str, passed: bool, **detail) -> bool:
        self.checks.append({"name": name, "passed": bool(passed), **detail})
        print(f"  {'PASS' if passed else 'FAIL'}  {name}  {json.dumps(detail, default=str)[:300]}", flush=True)
        return bool(passed)

    def wait(self, seconds: float, why: str) -> None:
        self.note("wait", seconds=seconds, why=why)
        time.sleep(seconds)

    def until(self, what: str, fn, timeout: float, every: float = 2.0):
        deadline = time.monotonic() + timeout
        value = None
        while time.monotonic() < deadline:
            try:
                value = fn()
                if value:
                    return value
            except Exception as exc:  # the stack may be mid-restart
                value = {"error": str(exc)}
            time.sleep(every)
        self.note("timeout", what=what, last=str(value)[:200])
        return None

    def source(self, name: str) -> dict:
        return self.api("GET", f"/edge/v1/sources/{name}")

    def segments(self, source: str) -> list[dict]:
        items, after = [], None
        while True:
            path = f"/edge/v1/segments?source={source}&limit=500" + (f"&after={after}" if after else "")
            page = self.api("GET", path)
            items += page.get("items", [])
            after = page.get("next")
            if not after:
                return items

    def container_started(self, service: str) -> str:
        cid = self.compose("ps", "-q", service).strip()
        return subprocess.run(["docker", "inspect", "-f", "{{.State.StartedAt}}", cid],
                              capture_output=True, text=True).stdout.strip()

    def stats(self, label: str) -> None:
        names = self.compose("ps", "--format", "{{.Name}}").split()
        out = subprocess.run(["docker", "stats", "--no-stream", "--format",
                              "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}", *names], capture_output=True, text=True).stdout
        rows = [line.split("\t") for line in out.strip().splitlines() if line]
        self.measurements.setdefault("docker_stats", {})[label] = {r[0]: {"cpu": r[1], "mem": r[2]} for r in rows}
        self.note("docker stats", label=label, stats={r[0]: r[1] for r in rows})

    # ── shared steps ──────────────────────────────────────────────────────
    def up(self) -> None:
        self.compose("down", "-v", "--remove-orphans", check=False)
        self.note("compose up", wan=self.wan)
        self.compose("up", "-d", "--build", timeout=900)
        ok = self.until("edge answers", lambda: self.api("GET", "/edge/v1/health").get("passes", 0) > 0, 90)
        self.check("stack starts and the Edge completes a pass", ok)

    def both_recording(self, label: str) -> None:
        for name in ("ground", "drone"):
            view = self.until(f"{name} recording", lambda n=name: (v := self.source(n)).get("recording") and v, 40)
            self.check(f"{label}: {name} is publishing and recording", bool(view),
                       segment=(view or {}).get("currentSegmentId"))

    def verify_all(self, label: str) -> None:
        out = self.compose("exec", "-T", "edge", "fairplay-edge", "verify-all", check=False).strip().splitlines()
        summary = json.loads(out[-1]) if out else {}
        self.check(f"{label}: every final segment re-hashes to its manifest SHA-256",
                   summary.get("checked", 0) > 0 and summary.get("match") == summary.get("checked"), **summary)

    def fetch_window(self, label: str, source: str, start: datetime, ms: int) -> None:
        window = self.api("GET", f"/edge/v1/sources/{source}/window?start={iso(start)}&durationMs={ms}")
        segs = window.get("segments", [])
        inside = all(parse(s["start_utc"]) < start + timedelta(milliseconds=ms)
                     and (s["end_utc"] is None or parse(s["end_utc"]) > start) for s in segs)
        self.check(f"{label}: window {iso(start)} +{ms} ms is fully covered and names its originals",
                   window.get("coverage") == "full" and segs and inside and all(s["sha256"] for s in segs),
                   coverage=window.get("coverage"), segments=[s["rel_path"] for s in segs])
        target = f"/tmp/window-{int(time.time())}.mp4"
        fetched = self.compose("exec", "-T", "edge", "fairplay-edge", "api", "GET", window.get("playbackPath", "/x"),
                               "--out", target, check=False)
        probe = self.edge_python(PROBE_SCRIPT, target)
        self.check(f"{label}: the playback URL returns a playable MP4 of the requested length",
                   probe.get("bytes", 0) > 0 and abs(probe.get("duration", 0) - ms / 1000) <= 1.5,
                   fetch=fetched.strip()[:200], probe=probe)

    # ── scenarios ─────────────────────────────────────────────────────────
    def core(self) -> None:
        self.up()
        self.wait(70, "two 30 s segments per source")
        self.both_recording("A")
        for name, audio in (("ground", True), ("drone", False)):
            segs = [s for s in self.segments(name) if s["state"] == "finalized"]
            detail = self.api("GET", f"/edge/v1/segments/{segs[0]['id']}") if segs else {}
            media = detail.get("media", {})
            self.check(f"A: {name} has finalised segments with hash, size, times and codec",
                       bool(segs) and all(s["sha256"] and s["bytes"] and s["end_utc"] for s in segs)
                       and media.get("codec") == "h264" and media.get("fps") == "25/1"
                       and media.get("hasAudio") is audio and media.get("startPts") is not None,
                       finalized=len(segs), media=media)
        self.stats("both sources recording")

        t_drop = self.note("B: stop the drone's publisher")
        self.compose("stop", "synth-drone")
        drone = self.until("drone seen down", lambda: (v := self.source("drone")).get("publishing") is False and v, 20)
        alerts = (drone or {}).get("openAlerts", [])
        self.check("B: the drone's drop is seen and raised as a warning",
                   any(a["kind"] == "source_disconnected" and a["severity"] == "warning" for a in alerts),
                   alerts=[a["kind"] for a in alerts])
        g1 = self.source("ground")
        time.sleep(4)
        g2 = self.source("ground")
        self.check("B: the ground keeps recording while the drone is down",
                   g2.get("recording") and (g2.get("currentSegmentBytes") or 0) != (g1.get("currentSegmentBytes") or 0)
                   or g2.get("currentSegmentId") != g1.get("currentSegmentId"),
                   before=g1.get("currentSegmentBytes"), after=g2.get("currentSegmentBytes"))
        self.wait(20, "drone stays down")
        t_back = self.note("C: restart the drone's publisher")
        self.compose("start", "synth-drone")
        back = self.until("drone back", lambda: (v := self.source("drone")).get("recording") and v, 40)
        self.check("C: the drone reconnects, records again, and its alert resolves",
                   bool(back) and not any(a["kind"] == "source_disconnected" for a in back.get("openAlerts", [])))
        self.wait(45, "let the drone's interrupted segment finalise")
        lo, hi = t_drop - timedelta(seconds=15), t_back + timedelta(seconds=15)
        drone_gaps = self.api("GET", f"/edge/v1/sources/drone/gaps?start={iso(lo)}&end={iso(hi)}")
        holes = drone_gaps.get("notRecorded", [])
        expected = (t_back - t_drop).total_seconds() * 1000
        self.measurements["drone_gap"] = {"expectedMs": round(expected), "recorded": holes,
                                          "observedDrops": drone_gaps.get("observedDrops")}
        self.check("C: the drone's recordings show one gap about as long as the drop",
                   len(holes) == 1 and abs(holes[0]["durationMs"] - expected) <= 6000,
                   holes=holes, expectedMs=round(expected))
        drops = drone_gaps.get("observedDrops") or []
        self.check("C: the watchdog recorded the drop as a closed feed interval",
                   len(drops) == 1 and drops[0]["toUtc"] is not None, drops=drops)
        ground_gaps = self.api("GET", f"/edge/v1/sources/ground/gaps?start={iso(lo)}&end={iso(hi)}")
        self.check("C: the ground's recordings have no gap across the drone's drop",
                   ground_gaps.get("notRecorded") == [], holes=ground_gaps.get("notRecorded"))

        self.fetch_window("D", "ground", t_drop - timedelta(seconds=10), 10_000)

        before = {s["id"]: s["sha256"] for s in self.segments("ground") + self.segments("drone")
                  if s["state"] == "finalized"}
        mtx_started = self.container_started("mediamtx")
        t_restart = self.note("E: restart the Edge container")
        self.compose("restart", "edge")
        self.until("edge back", lambda: self.api("GET", "/edge/v1/health").get("passes", 0) > 0, 60)
        after = {s["id"]: s["sha256"] for s in self.segments("ground") + self.segments("drone")}
        self.check("E: every segment finalised before the restart is still listed with the same hash",
                   all(after.get(k) == v for k, v in before.items()), finalisedBefore=len(before))
        self.check("E: MediaMTX was not restarted with the Edge", self.container_started("mediamtx") == mtx_started)
        self.verify_all("E")
        self.fetch_window("E", "ground", t_drop - timedelta(seconds=10), 10_000)
        self.wait(40, "let the segment spanning the restart finalise")
        gaps = self.api("GET", f"/edge/v1/sources/ground/gaps?start={iso(t_restart - timedelta(seconds=10))}"
                               f"&end={iso(t_restart + timedelta(seconds=20))}")
        self.check("E: recording continued through the Edge restart (no ground gap)",
                   gaps.get("notRecorded") == [], holes=gaps.get("notRecorded"))

        self.crash()
        self.stats("after crash recovery")
        self.no_transcoding()

    def crash(self) -> None:
        open_before = {s["id"]: s for s in self.segments("ground") if s["state"] == "recording"}
        cid = self.compose("ps", "-q", "mediamtx").strip()
        t_kill = self.note("F: SIGKILL MediaMTX mid-segment", open=[s["rel_path"] for s in open_before.values()])
        subprocess.run(["docker", "kill", "--signal", "KILL", cid], capture_output=True)
        down = self.until("media_server_down raised",
                          lambda: any(a["kind"] == "media_server_down" for a in self.api("GET", "/edge/v1/alerts")), 20)
        self.check("F: the watchdog raises media_server_down", bool(down))
        time.sleep(3)
        state = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", cid], capture_output=True, text=True)
        restarted_by_policy = state.stdout.strip() == "true"
        self.note("F: MediaMTX state after kill", running=state.stdout.strip())
        if not restarted_by_policy:
            self.compose("start", "mediamtx")
        self.measurements["mediamtx_restart_after_sigkill"] = "restart policy" if restarted_by_policy else "manual start"
        back = self.until("ground recording again", lambda: (v := self.source("ground")).get("recording") and v, 60)
        self.check("F: MediaMTX comes back and the ground records again", bool(back))
        resolved = not any(a["kind"] == "media_server_down" for a in self.api("GET", "/edge/v1/alerts"))
        self.check("F: media_server_down resolves", resolved)
        self.wait(20, "finalise the crashed segment")
        crashed = [self.api("GET", f"/edge/v1/segments/{i}") for i in open_before]
        self.measurements["crashed_segments"] = [
            {"relPath": c["file"]["relPath"], "state": c["state"], "bytes": c["file"]["bytes"],
             "completeBytes": c["file"]["completeBytes"], "problems": c["problems"],
             "startUtc": c["timing"]["startUtc"], "durationMs": c["timing"]["durationMs"]} for c in crashed]
        self.check("F: each segment open at the crash is final, and never called complete if its tail is torn",
                   crashed and all(c["state"] in ("finalized", "partial") for c in crashed)
                   and all(c["state"] == "partial" or c["file"]["completeBytes"] == c["file"]["bytes"] for c in crashed),
                   states=[c["state"] for c in crashed])
        for c in crashed:
            start = parse(c["timing"]["startUtc"])
            if c["state"] == "partial":
                repaired = self.api("POST", f"/edge/v1/segments/{c['id']}/repair")
                kept_ms = repaired.get("duration_ms") or 0
                lost = (t_kill - start).total_seconds() * 1000 - kept_ms
                self.measurements.setdefault("crash_loss", []).append(
                    {"segment": c["file"]["relPath"], "keptMs": kept_ms, "lostMs": round(lost),
                     "lostBytes": repaired.get("lost_bytes")})
                self.check("F: the partial segment is repaired into a separate, whole derivative",
                           repaired.get("kind") == "repair" and repaired.get("sha256") != c["file"]["sha256"],
                           repaired={k: repaired.get(k) for k in ("rel_path", "bytes", "lost_bytes", "duration_ms")})
            else:
                lost = (t_kill - start).total_seconds() * 1000 - (c["timing"]["durationMs"] or 0)
                self.measurements.setdefault("crash_loss", []).append(
                    {"segment": c["file"]["relPath"], "keptMs": c["timing"]["durationMs"], "lostMs": round(lost),
                     "note": "file ended on a whole fragment"})
        self.verify_all("F")

    def no_transcoding(self) -> None:
        for service in ("edge", "mediamtx"):
            cid = self.compose("ps", "-q", service).strip()
            requests = subprocess.run(["docker", "inspect", "-f", "{{json .HostConfig.DeviceRequests}}", cid],
                                      capture_output=True, text=True).stdout.strip()
            self.check(f"G: {service} has no GPU or device reservation", requests in ("null", "[]"), deviceRequests=requests)
        procs = self.compose("exec", "-T", "edge", "sh", "-c",
                             "for p in /proc/[0-9]*/cmdline; do tr '\\0' ' ' < $p; echo; done", check=False)
        self.check("G: no ffmpeg process runs in the Edge container (recordings are only probed)",
                   "ffmpeg " not in procs, processes=[p for p in procs.splitlines() if p.strip()][:10])
        env = self.compose("exec", "-T", "edge", "env", check=False)
        self.check("G: the Edge holds no AWS or R2 credentials and no publish passwords",
                   not any(k in env for k in ("AWS_", "R2_", "FAIRPLAY_PUBLISH_PASSWORD")))

    def wan_drill(self, minutes: float) -> None:
        self.up()
        total = minutes * 60
        egress = self.compose("exec", "-T", "edge", "fairplay-edge", "check-egress", check=False)
        self.check("W: the Edge cannot reach the internet", '"reachable"' not in egress, result=egress.strip())
        t0 = utc()
        self.wait(60, "settle")
        self.both_recording("W")
        drop_at, restart_at = total / 3, 2 * total / 3
        dropped = restarted = False
        t_drop = t_back = t_restart = None
        samples = []
        while (elapsed := (utc() - t0).total_seconds()) < total:
            if not dropped and elapsed >= drop_at:
                t_drop = self.note("W: drone publisher stopped for 60 s")
                self.compose("stop", "synth-drone")
                time.sleep(60)
                t_back = self.note("W: drone publisher restarted")
                self.compose("start", "synth-drone")
                dropped = True
            if not restarted and elapsed >= restart_at:
                t_restart = self.note("W: Edge restarted")
                self.compose("restart", "edge")
                self.until("edge back", lambda: self.api("GET", "/edge/v1/health").get("passes", 0) > 0, 60)
                restarted = True
            health = self.api("GET", "/edge/v1/health")
            samples.append({"at": iso(utc()), "status": health.get("status"), "segments": health.get("segments"),
                            "alerts": [a["kind"] + ":" + str(a.get("source")) for a in health.get("openAlerts", [])]})
            self.note("W: sample", status=health.get("status"), segments=health.get("segments"))
            time.sleep(min(300, max(5, total - (utc() - t0).total_seconds())))
        self.measurements["wan_samples"] = samples
        self.wait(45, "finalise the last segments")
        end = utc()
        egress = self.compose("exec", "-T", "edge", "fairplay-edge", "check-egress", check=False)
        self.check("W: still no route out at the end of the drill", '"reachable"' not in egress, result=egress.strip())
        lo, hi = t0 + timedelta(seconds=5), end - timedelta(seconds=60)
        ground = self.api("GET", f"/edge/v1/sources/ground/gaps?start={iso(lo)}&end={iso(hi)}")
        self.check(f"W: the ground recorded {minutes:g} minutes with no gap, through the drone drop and Edge restart",
                   ground.get("notRecorded") == [], holes=ground.get("notRecorded"))
        drone = self.api("GET", f"/edge/v1/sources/drone/gaps?start={iso(lo)}&end={iso(hi)}")
        holes = drone.get("notRecorded", [])
        expected = (t_back - t_drop).total_seconds() * 1000 if t_drop and t_back else None
        self.check("W: the drone shows exactly its one 60 s drop",
                   expected is not None and len(holes) == 1 and abs(holes[0]["durationMs"] - expected) <= 6000,
                   holes=holes, expectedMs=round(expected) if expected else None)
        finals = {n: len([s for s in self.segments(n) if s["state"] in ("finalized", "partial")]) for n in ("ground", "drone")}
        self.measurements["wan_segment_counts"] = finals
        self.check("W: about two final segments per source per minute (30 s segments)",
                   all(c >= minutes * 2 - 4 for c in finals.values()), counts=finals)
        self.verify_all("W")
        self.fetch_window("W", "ground", t_restart - timedelta(seconds=15) if t_restart else lo, 10_000)
        self.stats("end of drill")
        self.no_transcoding()

    # ── Phase 3: incidents and evidence ───────────────────────────────────
    def call(self, method: str, path: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, object]:
        args = ["exec", "-T", "edge", "fairplay-edge", "api", method, path, "--status"]
        if body is not None:
            args += ["--body", json.dumps(body)]
        for name, value in (headers or {}).items():
            args += ["--header", f"{name}: {value}"]
        out = self.compose(*args, check=False)
        try:
            parsed = json.loads(out.strip().splitlines()[-1])
            return parsed["status"], parsed["body"]
        except (json.JSONDecodeError, IndexError, KeyError):
            return 0, out

    def clip(self, incident_id: str, source: str) -> dict:
        status, job = self.call("POST", f"/edge/v1/incidents/{incident_id}/clips", {"source": source})
        if status not in (200, 202):
            return {"state": "refused", "status": status, "body": job}
        return self.until(f"{source} clip job finishes", lambda: (j := self.api("GET", f"/edge/v1/jobs/{job['id']}"))
                          .get("state") in ("succeeded", "failed") and j, 180) or {"state": "timeout", "id": job["id"]}

    def marker_in_clip(self, evidence_id: str, fps: int = 25) -> dict:
        """Decode the clip inside the Edge and find where the red minute marker begins."""
        detail = self.api("GET", f"/edge/v1/evidence/{evidence_id}")
        return self.edge_python(MARKER_SCRIPT, f"/var/lib/fairplay/data/evidence/{detail['rel_path']}", str(fps))

    def evidence(self) -> None:
        """Phase 3 acceptance on synthetic feeds, with the WAN cut throughout."""
        sys.path.insert(0, str(ROOT / "tests"))
        from schema_check import errors  # noqa: PLC0415 (standard library only)

        schema = json.loads((ROOT / "fairplay_edge" / "schemas" / "evidence-manifest.v1.schema.json").read_text("utf-8"))
        self.up()
        egress = self.compose("exec", "-T", "edge", "fairplay-edge", "check-egress", check=False)
        self.check("P3: the Edge cannot reach the internet", '"reachable"' not in egress, result=egress.strip())
        self.both_recording("P3")
        _, session = self.call("POST", "/edge/v1/sessions", {"label": "Phase 3 fixture (synthetic)", "matchRef": "fixture"})
        sid = session["id"]
        status, rights = self.call("POST", f"/edge/v1/sessions/{sid}/rights", {
            "footageKind": "synthetic", "status": "not_recorded", "minorsPresent": "no"})
        self.check("P3: rights recorded as synthetic test footage", status == 201, rights=rights)

        # The known moment: the next whole minute on the burned-in clock, where the ground's
        # red marker begins. Wait until it and 10 s after it are recorded and final.
        marker = (utc() + timedelta(seconds=40)).replace(second=0, microsecond=0) + timedelta(minutes=1)
        self.note("P3: the incident is the marker at", at=iso(marker))
        self.wait(max(0.0, (marker - utc()).total_seconds()) + 50, "the marker, its post-roll and a 30 s segment")
        key = secrets.token_hex(16)
        body = {"sessionId": sid, "eventUtc": iso(marker), "basis": "manual", "category": "other",
                "note": "synthetic minute marker"}
        s1, inc = self.call("POST", "/edge/v1/incidents", body, {"Idempotency-Key": key})
        s2, again = self.call("POST", "/edge/v1/incidents", body, {"Idempotency-Key": key})
        listed = self.api("GET", f"/edge/v1/incidents?sessionId={sid}")
        self.check("P3: a doubled create (same Idempotency-Key) makes one incident",
                   s1 == s2 == 201 and inc["id"] == again["id"] and len(listed) == 1, ids=[inc.get("id"), again.get("id")])

        # Edit collision: two edits from version 1. The first wins; the second is refused.
        a, _ = self.call("PATCH", f"/edge/v1/incidents/{inc['id']}", {"note": "first edit"}, {"If-Match": "1"})
        b, refused = self.call("PATCH", f"/edge/v1/incidents/{inc['id']}", {"note": "second edit"}, {"If-Match": "1"})
        now = self.api("GET", f"/edge/v1/incidents/{inc['id']}")
        self.check("P3: an edit from a stale version is refused (409) and loses nothing",
                   a == 200 and b == 409 and now.get("note") == "first edit" and now.get("version") == 2,
                   statuses=[a, b], refusal=refused)

        # The 30-second clips, one per camera.
        made = {}
        for source in ("ground", "drone"):
            job = self.clip(inc["id"], source)
            made[source] = job
            self.check(f"P3: a 30 s {source} clip is cut from the originals", job.get("state") == "succeeded", job=job)
        repeat_status, repeat = self.call("POST", f"/edge/v1/incidents/{inc['id']}/clips", {"source": "ground"})
        self.check("P3: asking again for the same clip returns the first job, no second cut",
                   repeat_status == 200 and repeat.get("id") == made["ground"].get("id"))

        segments = {s["id"]: s for n in ("ground", "drone") for s in self.segments(n)}
        markers = {}
        for source, job in made.items():
            if job.get("state") != "succeeded":
                continue
            ev = self.api("GET", f"/edge/v1/evidence/{job['evidence_id']}")
            manifest = self.api("GET", f"/edge/v1/evidence/{ev['id']}/manifest")
            window_lo = parse(ev["window_start_utc"])
            window_hi = window_lo + timedelta(milliseconds=ev["window_duration_ms"])
            expected = sorted((s for s in segments.values() if s["source"] == source and s["state"] in ("finalized", "partial")
                               and parse(s["start_utc"]) < window_hi and parse(s["end_utc"]) > window_lo),
                              key=lambda s: s["start_utc"])
            # Every original the window touches is either a source (with its hash) or listed as
            # unused with the reason; nothing else is named.
            by_id = {s["id"]: s for s in expected}
            accounted = ev["source_segment_ids"] + [u["segmentId"] for u in manifest["coverage"]["unusedSegments"]]
            self.check(f"P3: {source} evidence accounts for exactly the original segments its window touches, with"
                       " their hashes", sorted(accounted) == sorted(by_id) and ev["source_segment_ids"]
                       and all(x["sha256"] == by_id[x["segmentId"]]["sha256"] == x["verifiedSha256AtCut"]
                               for x in manifest["sources"]),
                       sources=[x["relPath"] for x in manifest["sources"]],
                       unused=manifest["coverage"]["unusedSegments"])
            rehash = self.compose("exec", "-T", "edge", "sha256sum", f"/var/lib/fairplay/data/evidence/{ev['rel_path']}",
                                  check=False).split(" ")[0]
            self.check(f"P3: {source} clip on disk hashes to its recorded SHA-256 and the manifest validates",
                       rehash == ev["sha256"] == manifest["derivative"]["sha256"] and not errors(manifest, schema),
                       sha256=ev["sha256"], schemaErrors=errors(manifest, schema)[:5])
            # Coverage must be what the pictures hold: count the clip's video frames here,
            # independently of the Edge, and hold its claim to them.
            frames = self.compose("exec", "-T", "edge", "sh", "-c",
                                  "ffprobe -v error -select_streams v:0 -count_packets -show_entries "
                                  f"stream=nb_read_packets -of csv=p=0 /var/lib/fairplay/data/evidence/{ev['rel_path']}",
                                  check=False).strip()
            vc = manifest["coverage"]["videoCheck"]
            honest = (frames.isdigit() and int(frames) == vc["frames"]
                      and (ev["coverage"] == "full") == (vc["full"] and not manifest["coverage"]["gaps"])
                      # frames on screen = lead-in + the window, less what is missing, plus any repeat
                      and abs(int(frames) * 40 - vc["leadInMs"] - (ev["window_duration_ms"] - vc["missingMs"])
                              - vc["excessMs"]) <= 120)
            self.check(f"P3: {source} clip's stated coverage matches its own video frames (counted independently)",
                       honest, frames=frames, coverage=ev["coverage"], videoCheck={k: vc[k] for k in
                       ("frames", "leadInMs", "missingMs", "excessMs", "holes", "undecodableLeadMs", "full")},
                       gaps=manifest["coverage"]["gaps"])
            self.measurements.setdefault("clips", {})[source] = {"coverage": ev["coverage"], "durationMs": ev["duration_ms"],
                                                                 "videoCheck": vc, "gaps": manifest["coverage"]["gaps"]}
            found = self.marker_in_clip(ev["id"])
            markers[source] = {**found, "eventAtMs": manifest["window"]["eventAtMs"]}
            if found.get("riseMs") is not None:
                markers[source]["markerMinusEventMs"] = found["riseMs"] - manifest["window"]["eventAtMs"]
        self.measurements["marker_in_clip"] = markers
        ground_lag = markers.get("ground", {}).get("markerMinusEventMs")
        self.check("P3: the ground's marker appears in its clip where the incident is, within the 3 s uncalibrated"
                   " uncertainty", ground_lag is not None and -3000 <= ground_lag <= 3000, markers=markers)
        drone_lag = markers.get("drone", {}).get("markerMinusEventMs")
        # Each feed reaches MediaMTX with its own delay, so the cameras' offset is measured by
        # calibration, never assumed from the 400 ms painted into the drone's clock (Phase 2).
        self.check("P3: the drone's marker appears in its clip where the incident is, within the 3 s uncalibrated"
                   " uncertainty", drone_lag is not None and -3000 <= drone_lag <= 3000, markers=markers)

        # Phase 1's recordings, re-examined: does each camera keep every picture across its
        # segment switches? (Found in this phase: MediaMTX discards late video on an
        # audio+video feed. Reported as found, not hidden.)
        alerts = self.api("GET", "/edge/v1/alerts?state=all&limit=1000")
        for source in ("ground", "drone"):
            short = [a for a in alerts if isinstance(a, dict) and a.get("kind") == "segment_video_gap"
                     and a.get("source") == source]
            finals = [s for s in self.segments(source) if s["state"] == "finalized"]
            self.check(f"P3: {source} recordings keep their video across segment switches",
                       not short, alerts=[a.get("detail") for a in short][:3], finalSegments=len(finals))
        mtx = self.compose("logs", "--no-color", "mediamtx", check=False)
        self.measurements["mediamtx_too_late"] = {
            src: mtx.count(f"[path {src}] [recorder] sample of track") for src in ("ground", "drone")}

        # Review, approval and export, all offline.
        ev_ids = [j["evidence_id"] for j in made.values() if j.get("state") == "succeeded"]
        version = now["version"]
        st, _ = self.call("POST", f"/edge/v1/incidents/{inc['id']}/review/start", {}, {"If-Match": str(version)})
        sc, done = self.call("POST", f"/edge/v1/incidents/{inc['id']}/review/complete", {
            "result": "inconclusive", "factualNotes": "Synthetic marker visible on both cameras.", "evidenceIds": ev_ids},
            {"If-Match": str(version + 1)})
        self.check("P3: review starts and completes (shadow)", st == 200 and sc == 200 and done.get("state") == "reviewed")
        sa, approved = self.call("POST", f"/edge/v1/evidence/{ev_ids[0]}/approve", {}) if ev_ids else (0, None)
        export = self.compose("exec", "-T", "edge", "fairplay-edge", "api", "POST", f"/edge/v1/evidence/{ev_ids[0]}/export",
                              "--out", "/tmp/package.zip", check=False) if ev_ids else ""
        listing = self.compose("exec", "-T", "edge", "python", "-c",
                               "import zipfile,sys;print(sorted(zipfile.ZipFile('/tmp/package.zip').namelist()))",
                               check=False).strip()
        self.check("P3: approved and exported as a package with the clip, manifest and SHA256SUMS",
                   sa == 200 and "['SHA256SUMS', 'clip.mp4', 'manifest.json']" in listing, approve=sa, export=export.strip(),
                   contents=listing)

        # Missing source: one original vanishes before its clip is cut. Refused, no file.
        # The victim must not be footage a later check replays: the first incident's window,
        # with a segment's length either side.
        keep_lo, keep_hi = marker - timedelta(seconds=60), marker + timedelta(seconds=50)
        def outside():
            fresh = sorted(self.segments("ground"), key=lambda s: s["start_utc"])
            return next((s for s in fresh if s["state"] == "finalized" and s["end_utc"]
                         and (parse(s["end_utc"]) < keep_lo or parse(s["start_utc"]) > keep_hi)), None)

        victim = self.until("a ground segment outside the incident's footage", outside, 120, every=10)
        late = (parse(victim["start_utc"]) + timedelta(seconds=15)) if victim else utc()
        s_late, inc2 = self.call("POST", "/edge/v1/incidents", {"sessionId": sid, "eventUtc": iso(late), "basis": "manual",
                                                                "preRollMs": 5000, "postRollMs": 5000})
        assert not victim or parse(victim["start_utc"]) > keep_hi or parse(victim["end_utc"]) < keep_lo
        if victim and s_late == 201:
            self.compose("exec", "-T", "edge", "rm", "-f", f"/var/lib/fairplay/recordings/{victim['rel_path']}", check=False)
            job = self.clip(inc2["id"], "ground")
            evidence_rows = self.api("GET", f"/edge/v1/evidence?incidentId={inc2['id']}")
            self.check("P3: a missing original is refused: the job fails source_missing and no clip exists",
                       job.get("state") == "failed" and job.get("error_code") == "source_missing" and evidence_rows == [],
                       job={k: job.get(k) for k in ("state", "error_code", "error")}, removed=victim["rel_path"])
        else:
            self.check("P3: a missing original is refused (set-up)", False, victim=victim, status=s_late)

        # Interrupted job: kill the Edge straight after asking for a clip, then start it again.
        s3, inc3 = self.call("POST", "/edge/v1/incidents", {"sessionId": sid, "eventUtc": iso(utc() - timedelta(seconds=90)),
                                                            "basis": "manual", "preRollMs": 300_000, "postRollMs": 10_000})
        _, job3 = self.call("POST", f"/edge/v1/incidents/{inc3['id']}/clips", {"source": "drone"})
        cid = self.compose("ps", "-q", "edge").strip()
        subprocess.run(["docker", "kill", cid], capture_output=True)
        killed = self.note("P3: Edge killed (SIGKILL) with a clip job in hand")
        self.compose("start", "edge")
        self.until("edge back", lambda: self.api("GET", "/edge/v1/health").get("passes", 0) > 0, 90)
        recovered = [e for e in self.api("GET", "/edge/v1/events?limit=1000") if e.get("kind") == "job.recovered"]
        final = self.until("job after restart", lambda: (j := self.api("GET", f"/edge/v1/jobs/{job3['id']}"))
                           .get("state") in ("succeeded", "failed") and j, 180) or {}
        leftovers = self.compose("exec", "-T", "edge", "sh", "-c", "find /var/lib/fairplay/data/evidence -name '*.part' | wc -l",
                                 check=False).strip()
        self.check("P3: a job cut off by a SIGKILL completes after the restart, with no half-written file left",
                   final.get("state") in ("succeeded", "failed") and leftovers == "0", job={k: final.get(k) for k in
                   ("state", "attempts", "error_code")}, wasRunningAtKill=bool(recovered), killedAt=iso(killed))
        self.measurements["interrupted_job"] = {"recoveredEvent": bool(recovered), "final": final}

        # Replay after the restart: the incident's window still plays, the evidence still verifies.
        windows = self.api("GET", f"/edge/v1/incidents/{inc['id']}/windows")
        ground_w = next((w for w in windows.get("perSource", []) if w["source"] == "ground"), {})
        self.fetch_window("P3 after restart", "ground", parse(ground_w["startIngestUtc"]), 10_000) if ground_w else None
        sm, _ = self.call("GET", f"/edge/v1/evidence/{ev_ids[0]}/manifest") if ev_ids else (0, None)
        audit = self.api("GET", "/edge/v1/audit/verify")
        self.check("P3: after the restart the evidence still verifies and the audit chain is whole",
                   sm == 200 and audit.get("ok") is True, audit=audit)

        # Nothing left the venue: the outbox holds every record, ready for when there is a WAN.
        health = self.api("GET", "/edge/v1/health")
        cloud = health.get("cloud", {})
        self.check("P3: with no WAN and no destination, the outbox keeps every record and sends nothing",
                   cloud.get("configured") is False and cloud.get("pending", 0) > 0 and cloud.get("sent") == 0, cloud=cloud)
        entries = self.api("GET", "/edge/v1/audit?limit=1000")
        actions = sorted({e["action"] for e in entries if isinstance(e, dict)})
        self.check("P3: create, edit, review, export and access are all in the audit log",
                   {"incident.created", "incident.edited", "review.completed", "evidence.created", "evidence.approved",
                    "evidence.exported", "media.accessed"} <= set(actions), actions=actions)
        self.measurements["audit_entries"] = len(entries)
        self.stats("end of evidence run")
        idle = self.compose("exec", "-T", "edge", "sh", "-c",
                            "for p in /proc/[0-9]*/cmdline; do tr '\\0' ' ' < $p; echo; done", check=False)
        self.check("P3: no ffmpeg is left running in the Edge once the jobs are done", "ffmpeg " not in idle)

    # ── output ────────────────────────────────────────────────────────────
    def finish(self) -> int:
        try:
            self.measurements["finalise_timings"] = self.api("GET", "/edge/v1/events?limit=1000")
            self.measurements["finalise_timings"] = [
                {"kind": e["kind"], **{k: e["detail"].get(k) for k in ("bytes", "hashMs", "inspectProbeMs", "reason")}}
                for e in self.measurements["finalise_timings"] if isinstance(e, dict) and e.get("kind", "").startswith("segment.")
                and e["kind"] in ("segment.finalized", "segment.partial")]
            self.measurements["alerts"] = self.api("GET", "/edge/v1/alerts?state=all&limit=1000")
            self.measurements["mediamtx_log_tail"] = self.compose("logs", "--no-color", "--tail", "40", "mediamtx",
                                                                  check=False)[-6000:]
        finally:
            if not self.keep:
                self.compose("down", "-v", "--remove-orphans", check=False)
        passed = sum(c["passed"] for c in self.checks)
        result = {"scenario": self.scenario, "wan": self.wan, "started": iso(self.started), "finished": iso(utc()),
                  "passed": passed, "failed": len(self.checks) - passed, "checks": self.checks,
                  "timeline": self.timeline, "measurements": self.measurements,
                  "docker": subprocess.run(["docker", "version", "--format", "{{.Server.Version}}"],
                                           capture_output=True, text=True).stdout.strip()}
        (self.out / "results.json").write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
        lines = [f"# Fixture `{self.scenario}` — {result['started']} → {result['finished']}", "",
                 f"**{passed} passed, {result['failed']} failed.** Synthetic feeds only.", "",
                 "| | Check |", "|---|---|"]
        lines += [f"| {'PASS' if c['passed'] else '**FAIL**'} | {c['name']} |" for c in self.checks]
        (self.out / "log.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"\n{passed} passed, {result['failed']} failed — {self.out}")
        return 0 if result["failed"] == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario", choices=("core", "wan", "evidence"))
    parser.add_argument("--minutes", type=float, default=30)
    parser.add_argument("--keep", action="store_true", help="leave the stack and its volumes up afterwards")
    parser.add_argument("--project", default="fpfix", help="Compose project name (one stack at a time: the subnet is fixed)")
    args = parser.parse_args()
    run = Run(args.scenario, wan=args.scenario in ("wan", "evidence"), keep=args.keep, project=args.project)
    try:
        if args.scenario == "core":
            run.core()
        elif args.scenario == "wan":
            run.wan_drill(args.minutes)
        else:
            run.evidence()
    except Exception as exc:
        run.check(f"scenario ran to completion ({exc.__class__.__name__}: {exc})", False)
    return run.finish()


if __name__ == "__main__":
    sys.exit(main())
