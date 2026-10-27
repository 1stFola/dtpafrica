"""FairPlay Edge fixtures: real MediaMTX, real ffmpeg, SYNTHETIC feeds only.

    python -I fixtures/run_fixture.py core            # ~6 minutes
    python -I fixtures/run_fixture.py wan --minutes 30

`core`: two independent sources record; one disconnects and reconnects while the other
carries on; a recorded window is fetched and checked against its original segments; the
Edge restarts and its finalised recordings stay intact; MediaMTX is killed with SIGKILL and
the crashed segment is detected as partial and repaired.

`wan`: the same stack on a network with no route out, for `--minutes`, with a drone drop at
a third of the way and an Edge restart at two thirds.

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


class Run:
    def __init__(self, scenario: str, wan: bool, keep: bool):
        self.scenario = scenario
        self.wan = wan
        self.keep = keep
        self.started = utc()
        self.out = ROOT / "fixtures" / "out" / f"{scenario}-{self.started.strftime('%Y%m%dT%H%M%SZ')}"
        self.out.mkdir(parents=True)
        self.project = "fpfix"
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

    def compose(self, *args: str, check: bool = True, capture: bool = True, timeout: float = 600) -> str:
        files = ["-f", "compose.yaml"] + (["-f", "compose.wan-outage.yaml"] if self.wan else [])
        env = {
            **__import__("os").environ,
            "FAIRPLAY_ENV_FILE": str(self.out / "fixture.env"),
            "FAIRPLAY_PUBLISH_ENV_FILE": str(self.out / "fixture-publish.env"),
            "FAIRPLAY_SOURCES_PATH": str(self.out / "sources.toml"),
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
    parser.add_argument("scenario", choices=("core", "wan"))
    parser.add_argument("--minutes", type=float, default=30)
    parser.add_argument("--keep", action="store_true", help="leave the stack and its volumes up afterwards")
    args = parser.parse_args()
    run = Run(args.scenario, wan=args.scenario == "wan", keep=args.keep)
    try:
        run.core() if args.scenario == "core" else run.wan_drill(args.minutes)
    except Exception as exc:
        run.check(f"scenario ran to completion ({exc.__class__.__name__}: {exc})", False)
    return run.finish()


if __name__ == "__main__":
    sys.exit(main())
