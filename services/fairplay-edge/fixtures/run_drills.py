"""FairPlay Phase 5.2 and 5.3: the Edge-side failure drills, in sequence. SYNTHETIC feeds only.

    python -I fixtures/run_drills.py                     # ~50 minutes, a 30-minute WAN cut
    python -I fixtures/run_drills.py --wan-minutes 3     # a quick rehearsal of the same
    python -I fixtures/run_drills.py storage             # 5.3, ~10 minutes

The stack runs on the cut network of compose.wan-outage.yaml, with real MediaMTX, two
synthetic cameras, the LAN relay and a stand-in cloud (compose.drills.yaml, TEST ONLY).

  D1  WAN off for --wan-minutes: the stand-in cloud is detached from the network. Records
      wait in the outbox, both cameras keep recording, and a console signed in before the
      cut sleeps through it. Then the WAN returns and the outbox drains.
  D2  the drone's feed drops for 60 s and reconnects.
  D3  MediaMTX is restarted mid-match; no original is rewritten, and the gap is shown.
  D4  the Edge is SIGKILLed while the cloud holds a batch it has applied but not answered;
      SQLite comes back whole and the outbox sends the batch again without a double.
  D5  every venue container is SIGKILLed at once, as a power cut, then started again.

Each drill goes in the drill log (`drills.md`, and `drills` in `results.json`): when the
fault was injected, when it was seen, when service came back, the recovery time (RTO), what
was lost (the recovery point, RPO) and any step a person had to take.

A docker kill is not a power cut: the host's page cache and the disk's write cache survive
it, and Docker is started again by this script, not by the host at boot. D5 tests the
software's recovery only; a UPS and a real power cut need the venue kit.

`storage` (5.3) puts the recordings on a 1 GB tmpfs (compose.storage.yaml, TEST ONLY), with
the soft limit at 0.6 GB free and the hard limit at 0.3 GB, and steps the disk down with a
filler file beside the source folders:
  S1  under the soft limit: a warning; new sessions still allowed; recording carries on.
  S2  under the hard limit: critical; new sessions and clips refused with 507; recording
      carries on.
  S3  full: recording stops, and is raised as such; the Edge and its database carry on.
  S4  the filler removed: recording comes back, the alerts resolve, and the gap is shown.
`--browser-pause N` holds at S1, S2 and S3 so the console can be looked at, until a
`continue-<stage>` file appears in the run's folder or N seconds pass, and writes
the drill's sign-in to `console-signin.json` in the run's folder (git-ignored).
"""

from __future__ import annotations

import argparse
import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_fixture import ROOT, Run, iso, parse, utc  # noqa: E402

SINK_IP = "172.31.250.30"
CA_IN_EDGE = "/etc/fairplay/auth/drill-ca.pem"
IDLE_MINUTES = 30
MB = 1024 ** 2
STORAGE_SOFT_GB, STORAGE_HARD_GB = 0.6, 0.3
CONSOLE_DIST = ROOT.parents[1] / "apps" / "fairplay-console" / "dist"

# Run once in the Edge image: a DEV bundle with one operator, and the stand-in cloud's CA.
SETUP_SCRIPT = r"""
import json, sys, uuid
from datetime import timedelta
from pathlib import Path
from fairplay_edge import tlsgen
from fairplay_edge.auth import BUNDLE_SCHEMA, generate_key, hash_pin, key_id, sign_bundle
from fairplay_edge.naming import iso, utcnow
cfg = json.load(sys.stdin)
auth = Path("/out/auth")
private, public = generate_key()
(auth / "trusted-keys.json").write_text(json.dumps({key_id(public): {"publicKey": public, "issuer": "dev-local"}}))
now = utcnow()
bundle = {"schema": BUNDLE_SCHEMA, "bundleId": str(uuid.uuid4()), "issuer": "dev-local", "issuedAt": iso(now),
          "expiresAt": iso(now + timedelta(hours=36)),
          "members": [{"userId": "u-drill-operator", "email": cfg["email"], "name": "Drill operator",
                       "permissions": ["fairplay.incident.operate"], "pinHash": hash_pin(cfg["pin"])}]}
(auth / "bundle.json").write_text(json.dumps(sign_bundle(bundle, private)))
paths = tlsgen.init(Path("/out/cloud/tls"), [cfg["sinkIp"]], "drill cloud")
(auth / "drill-ca.pem").write_bytes(paths["ca"].read_bytes())
print(json.dumps({"ok": True}))
"""

# Writes zeros beside the source folders until the volume has `target` bytes free (0: full).
FILL_SCRIPT = r"""
import json, os, shutil, sys
root, target = '/var/lib/fairplay/recordings', int(sys.argv[1])
before = shutil.disk_usage(root).free
need, written, error = before - target, 0, None
if need > 0:
    block = bytes(1 << 20)
    try:
        with open(root + '/.drill-filler', 'ab') as fh:
            while written < need:
                written += fh.write(block[:min(len(block), need - written)])
            fh.flush()
            os.fsync(fh.fileno())
    except OSError as exc:
        error = exc.strerror
u = shutil.disk_usage(root)
print(json.dumps({'before': before, 'written': written, 'free': u.free, 'total': u.total, 'error': error}))
"""

OUTBOX_SCRIPT = r"""
import json, sqlite3
db = sqlite3.connect('/var/lib/fairplay/data/edge.sqlite3', timeout=10)
rows = db.execute("SELECT idempotency_key, state, attempts FROM outbox").fetchall()
print(json.dumps({"integrity": db.execute("PRAGMA integrity_check").fetchone()[0],
                  "rows": [{"key": k, "state": s, "attempts": a} for k, s, a in rows]}))
"""


class Console:
    """The console's own calls, from this machine through the LAN relay, keeping its cookie."""

    def __init__(self, base: str = "http://127.0.0.1:8443"):
        self.base = base
        self.cookie: str | None = None
        self.last_request: datetime | None = None

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
        headers = {"x-fairplay-request": "1"}
        data = None
        if body is not None:
            data, headers["content-type"] = json.dumps(body).encode(), "application/json"
        if self.cookie:
            headers["cookie"] = self.cookie
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        self.last_request = utc()
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                status, raw, cookie = response.status, response.read(), response.headers.get("set-cookie")
        except urllib.error.HTTPError as exc:
            status, raw, cookie = exc.code, exc.read(), exc.headers.get("set-cookie")
        except OSError as exc:
            return 0, str(exc)
        if cookie:
            self.cookie = cookie.split(";", 1)[0]
        try:
            return status, json.loads(raw)
        except ValueError:
            return status, raw[:200].decode(errors="replace")


class Drills(Run):
    def __init__(self, keep: bool, project: str, wan_minutes: float, scenario: str = "drills", browser_pause: float = 0):
        super().__init__(scenario, wan=True, keep=keep, project=project)
        self.wan_minutes = wan_minutes
        self.browser_pause = browser_pause
        self.cloud = self.out / "cloud"
        self.cloud.mkdir()
        self.overlays = ["compose.drills.yaml"] + (["compose.storage.yaml"] if scenario == "storage" else [])
        if scenario == "storage":
            env = (self.out / "fixture.env").read_text(encoding="utf-8")
            env = env.replace("FAIRPLAY_DISK_SOFT_FREE_GB=2", f"FAIRPLAY_DISK_SOFT_FREE_GB={STORAGE_SOFT_GB}")
            env = env.replace("FAIRPLAY_DISK_HARD_FREE_GB=1", f"FAIRPLAY_DISK_HARD_FREE_GB={STORAGE_HARD_GB}")
            (self.out / "fixture.env").write_text(env, encoding="utf-8")
        self.extra_env = {"FAIRPLAY_DRILL_DIR": str(self.cloud)}
        if (CONSOLE_DIST / "index.html").exists():
            self.extra_env["FAIRPLAY_CONSOLE_PATH"] = str(CONSOLE_DIST)
        self.email = "drill.operator@dtp.test"
        self.pin = f"{secrets.randbelow(10 ** 6):06d}"
        device_token = secrets.token_urlsafe(32)
        with (self.out / "fixture.env").open("a", encoding="utf-8") as fh:
            fh.write(f"FAIRPLAY_CLOUD_SYNC_URL=https://{SINK_IP}:9443\nFAIRPLAY_CLOUD_DEVICE_TOKEN={device_token}\n"
                     f"SSL_CERT_FILE={CA_IN_EDGE}\nFAIRPLAY_ALLOW_DEV_BUNDLES=1\n")
        (self.cloud / "device-token").write_text(device_token, encoding="utf-8")
        self.sink_mode("normal")
        self.log: list[dict] = []
        self._drill: dict | None = None

    # ── the drill log ─────────────────────────────────────────────────────
    def begin(self, name: str, fault: str) -> None:
        self._drill = {"drill": name, "fault": fault, "firstCheck": len(self.checks)}

    def end(self, fault_at: datetime, recovered_at: datetime | None, rpo: dict, *, detected_at: datetime | None = None,
            operator_action: str | None = None, **extra) -> None:
        d = self._drill
        checks = self.checks[d.pop("firstCheck"):]
        d.update({"faultAt": iso(fault_at), "detectedAt": iso(detected_at) if detected_at else None,
                  "recoveredAt": iso(recovered_at) if recovered_at else None,
                  "rtoSeconds": round((recovered_at - fault_at).total_seconds(), 1) if recovered_at else None,
                  "rpo": rpo, "operatorAction": operator_action,
                  "passed": sum(c["passed"] for c in checks), "failed": sum(not c["passed"] for c in checks), **extra})
        self.log.append(d)
        self.note("drill logged", **{k: d[k] for k in ("drill", "rtoSeconds", "rpo", "failed")})

    # ── helpers ───────────────────────────────────────────────────────────
    def setup_auth(self) -> None:
        self._empty("auth")
        self.compose("build", timeout=900)
        out = subprocess.run(["docker", "run", "--rm", "-i", "--entrypoint", "python", "-v", f"{self.out}:/out",
                              "dtp-fairplay-edge:local", "-I", "-c", SETUP_SCRIPT],
                             input=json.dumps({"email": self.email, "pin": self.pin, "sinkIp": SINK_IP}),
                             capture_output=True, text=True, timeout=120)
        if '"ok": true' not in out.stdout:
            raise RuntimeError(f"drill set-up failed: {out.stderr[-1500:]}")

    def sink_mode(self, mode: str) -> None:
        (self.cloud / "mode").write_text(mode, encoding="utf-8")

    def sink(self) -> list[dict]:
        path = self.cloud / "received.jsonl"
        lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
        return [json.loads(line) for line in lines if line.strip()]

    def sink_keys(self) -> dict[str, list[str]]:
        seen: dict[str, list[str]] = {}
        for batch in self.sink():
            for item in batch["items"]:
                seen.setdefault(item["idempotencyKey"], []).append(item["status"])
        return seen

    def outbox(self) -> dict:
        return self.edge_python(OUTBOX_SCRIPT)

    def cloud_state(self) -> dict:
        return self.api("GET", "/edge/v1/health").get("cloud", {})

    def set_wan(self, on: bool) -> None:
        cid = self.compose("ps", "-q", "drill-cloud").strip()
        cmd = ["docker", "network", "connect", "--ip", SINK_IP] if on else ["docker", "network", "disconnect"]
        result = subprocess.run([*cmd, f"{self.project}_edge", cid], capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"WAN {'on' if on else 'off'}: {result.stderr.strip()}")

    def incidents(self, sid: str, n: int) -> list[str]:
        made = []
        for _ in range(n):
            status, inc = self.call("POST", "/edge/v1/incidents", {"sessionId": sid, "basis": "manual",
                                                                    "eventUtc": iso(utc() - timedelta(seconds=20))})
            if status == 201:
                made.append(inc["id"])
        return made

    def both_up(self) -> bool:
        return all(self.source(n).get("recording") for n in ("ground", "drone"))

    def holes(self, source: str, lo: datetime, hi: datetime) -> list[dict]:
        return self.api("GET", f"/edge/v1/sources/{source}/gaps?start={iso(lo)}&end={iso(hi)}").get("notRecorded", [])

    def files(self) -> dict[str, tuple[int, str]]:
        out = self.compose("exec", "-T", "edge", "sh", "-c",
                           r"find /var/lib/fairplay/recordings -type f -printf '%P\t%s\t%T@\n'", check=False)
        rows = [line.split("\t") for line in out.splitlines() if line.count("\t") == 2]
        return {r[0]: (int(r[1]), r[2]) for r in rows}

    def open_segments(self) -> list[str]:
        return [s["id"] for n in ("ground", "drone") for s in self.segments(n) if s["state"] == "recording"]

    def drain(self, what: str, timeout: float = 600) -> datetime | None:
        ok = self.until(what, lambda: (c := self.cloud_state()).get("pending") == 0 and c.get("sent", 0) > 0, timeout)
        return utc() if ok else None

    def crashed(self, label: str, ids: list[str], cut: datetime) -> list[dict]:
        """Each segment open at a crash: final or partial, never complete if torn; repair the partial ones."""
        detail = [self.api("GET", f"/edge/v1/segments/{i}") for i in ids]
        # A file that holds no media at all (opened, then refused by a full disk) is corrupt, not footage.
        empty = [d for d in detail if d.get("state") == "corrupt" and not d["file"]["completeBytes"]]
        kept = [d for d in detail if d not in empty]
        self.check(f"{label}: each segment open at the fault is final, and never called complete if its tail is torn",
                   bool(kept) and all(d.get("state") in ("finalized", "partial") for d in kept)
                   and all(d["state"] == "partial" or d["file"]["completeBytes"] == d["file"]["bytes"] for d in kept),
                   states=[d.get("state") for d in detail], emptyFiles=len(empty))
        losses = []
        for d in kept:
            start = parse(d["timing"]["startUtc"])
            if d.get("state") == "partial":
                repaired = self.api("POST", f"/edge/v1/segments/{d['id']}/repair")
                kept = repaired.get("duration_ms") or 0
                self.check(f"{label}: the partial segment {d['file']['relPath']} is repaired into a separate, whole derivative",
                           repaired.get("kind") == "repair" and repaired.get("sha256") != d["file"]["sha256"],
                           repaired={k: repaired.get(k) for k in ("rel_path", "lost_bytes", "duration_ms")})
            else:
                kept = d["timing"]["durationMs"] or 0
            losses.append({"segment": d["file"]["relPath"], "state": d.get("state"), "keptMs": kept,
                           "tailLostMs": round((cut - start).total_seconds() * 1000 - kept)})
        return losses

    # ── the drills ────────────────────────────────────────────────────────
    def drills(self) -> None:
        self.setup_auth()
        self.up()
        egress = self.compose("exec", "-T", "edge", "fairplay-edge", "check-egress", check=False)
        self.check("0: the Edge cannot reach the internet", '"reachable"' not in egress, result=egress.strip())
        self.wait(40, "first segments")
        self.both_recording("0")
        _, session = self.call("POST", "/edge/v1/sessions", {"label": "Failure drills (synthetic)", "matchRef": "drills"})
        sid = session["id"]
        self.incidents(sid, 2)
        self.check("0: online, the Edge sends its records to the stand-in cloud over HTTPS",
                   self.drain("first records sent", 90) is not None, cloud=self.cloud_state())
        self.d1_wan(sid)
        self.d2_drone()
        self.d3_mediamtx()
        self.d4_edge_kill(sid)
        self.d5_power_cut(sid)
        self.stats("end of drills")
        self.no_transcoding()

    def d1_wan(self, sid: str) -> None:
        self.begin("D1 WAN off", f"stand-in cloud detached from the network for {self.wan_minutes} min")
        console = Console()
        status, me = console.call("POST", "/edge/v1/auth/login", {"email": self.email, "pin": self.pin})
        page = console.call("GET", "/")[0] if "FAIRPLAY_CONSOLE_PATH" in self.extra_env else None
        again, me2 = console.call("GET", "/edge/v1/auth/me")
        live = console.call("GET", "/edge/v1/sources/ground")[1]
        self.check("D1: the console signs in over the venue LAN, and a refresh keeps its sign-in",
                   status == 200 and again == 200 and isinstance(me2, dict) and me2.get("email") == self.email
                   and page in (200, None) and isinstance(live, dict) and live.get("recording") is True,
                   login=status, page=page, me=again)
        sent_before = self.cloud_state().get("sent", 0)
        t_off = self.note("D1: WAN off (console left asleep)")
        self.set_wan(False)
        made = self.incidents(sid, 10)
        samples, halfway = [], False
        end = t_off + timedelta(minutes=self.wan_minutes)
        while utc() < end:
            if not halfway and utc() >= t_off + timedelta(minutes=self.wan_minutes / 2):
                made += self.incidents(sid, 10)
                halfway = True
            c = self.cloud_state()
            samples.append({"at": iso(utc()), "pending": c.get("pending"), "sent": c.get("sent"),
                            "maxAttempts": c.get("maxAttempts"), "lastError": (c.get("lastError") or "")[:80]})
            self.note("D1: sample", **samples[-1])
            time.sleep(max(1.0, min(240.0, (end - utc()).total_seconds())))
        made += self.incidents(sid, 10)
        during = self.cloud_state()
        stalled = any(a["kind"] == "outbox_stalled" for a in self.api("GET", "/edge/v1/alerts"))
        self.check("D1: while the WAN is off every record waits in the outbox and nothing is marked sent",
                   during.get("sent") == sent_before and during.get("pending", 0) >= len(made) > 0
                   and during.get("lastError"), cloud=during, incidents=len(made))
        t_on = self.note("D1: WAN back")
        self.set_wan(True)
        t_drained = self.drain("outbox drained after the outage")
        box, sink = self.outbox(), self.sink_keys()
        keys = [r["key"] for r in box.get("rows", [])]
        missing = [k for k in keys if "applied" not in sink.get(k, [])]
        doubled = [k for k, s in sink.items() if s.count("applied") > 1 or "conflict" in s]
        self.check("D1: once the WAN is back the outbox drains, and every record is in the cloud exactly once",
                   t_drained is not None and keys and not missing and not doubled
                   and all(r["state"] == "sent" for r in box["rows"]),
                   records=len(keys), missing=len(missing), doubled=len(doubled))
        holes = {n: self.holes(n, t_off, t_on) for n in ("ground", "drone")}
        self.check("D1: both cameras recorded throughout the outage", all(h == [] for h in holes.values()), holes=holes)
        slept = (utc() - console.last_request).total_seconds() / 60
        woke, _ = console.call("GET", "/edge/v1/auth/me")
        expected = 401 if slept > IDLE_MINUTES + 0.5 else 200 if slept < IDLE_MINUTES - 0.5 else woke
        relog, _ = console.call("POST", "/edge/v1/auth/login", {"email": self.email, "pin": self.pin}) if woke != 200 else (200, None)
        live = console.call("GET", "/edge/v1/sources/drone")[1]
        self.check(f"D1: the console that slept {slept:.0f} min is {'signed out (idle)' if expected == 401 else 'still signed in'}, "
                   "signs in again and sees the cameras recording",
                   woke == expected and relog == 200 and isinstance(live, dict) and live.get("recording") is True,
                   woke=woke, expected=expected, relogin=relog)
        self.measurements["d1_wan"] = {"samples": samples, "stalledAlertRaised": stalled,
                                       "drainSeconds": round((t_drained - t_on).total_seconds(), 1) if t_drained else None}
        self.end(t_on, t_drained, {"recordsLost": len(missing), "footageLostMs": sum(h["durationMs"] for v in holes.values() for h in v)},
                 detected_at=t_off, outageMinutes=round((t_on - t_off).total_seconds() / 60, 1),
                 note="RTO is from the WAN's return to an empty outbox; the outbox backs off to 5 minutes (±20%) during an outage")

    def d2_drone(self) -> None:
        self.begin("D2 drone drop", "drone publisher stopped for 60 s, then started")
        t_drop = self.note("D2: drone publisher stopped")
        self.compose("stop", "synth-drone")
        seen = self.until("drone seen down", lambda: (v := self.source("drone")).get("publishing") is False and v, 30, every=1)
        t_seen = utc()
        self.check("D2: the drone's drop is seen and raised as a warning",
                   any(a["kind"] == "source_disconnected" and a["severity"] == "warning" for a in (seen or {}).get("openAlerts", [])))
        time.sleep(max(0.0, 60 - (utc() - t_drop).total_seconds()))
        t_back = self.note("D2: drone publisher started")
        self.compose("start", "synth-drone")
        back = self.until("drone recording", lambda: (v := self.source("drone")).get("recording") and v, 60, every=1)
        t_rec = utc()
        self.check("D2: the drone records again and its alert resolves",
                   bool(back) and not any(a["kind"] == "source_disconnected" for a in back.get("openAlerts", [])))
        self.wait(45, "finalise the drone's interrupted segment")
        lo, hi = t_drop - timedelta(seconds=15), t_back + timedelta(seconds=15)
        drone, ground = self.holes("drone", lo, hi), self.holes("ground", lo, hi)
        expected = (t_back - t_drop).total_seconds() * 1000
        self.check("D2: the drone shows one gap about as long as the drop, and the ground none",
                   len(drone) == 1 and abs(drone[0]["durationMs"] - expected) <= 6000 and ground == [],
                   drone=drone, ground=ground, expectedMs=round(expected))
        self.end(t_back, t_rec if back else None,
                 {"gapMs": drone[0]["durationMs"] if drone else None, "dropMs": round(expected),
                  "beyondTheDropMs": round(drone[0]["durationMs"] - expected) if drone else None},
                 detected_at=t_seen, note="RTO is from the camera's return to recording again")

    def d3_mediamtx(self) -> None:
        self.begin("D3 MediaMTX restart", "docker compose restart mediamtx (SIGTERM, 15 s grace) mid-match")
        before = self.files()
        open_ids = self.open_segments()
        t_r = self.note("D3: MediaMTX restarted", files=len(before))
        self.compose("restart", "mediamtx", timeout=120)
        up = self.until("both recording", self.both_up, 90, every=1)
        t_rec = utc()
        self.check("D3: MediaMTX comes back and both cameras record again", bool(up))
        self.wait(45, "finalise the segments open at the restart")
        after = self.files()
        gone = [f for f in before if f not in after]
        shrunk = [f for f, (size, _) in before.items() if f in after and after[f][0] < size]
        open_paths = {self.api("GET", f"/edge/v1/segments/{i}").get("file", {}).get("relPath") for i in open_ids}
        rewritten = [f for f, v in before.items() if f in after and f not in open_paths and after[f] != v]
        self.check("D3: no original is lost, cut short or rewritten, and the restart starts new files",
                   not gone and not shrunk and not rewritten and len(after) > len(before),
                   gone=gone, shrunk=shrunk, rewritten=rewritten, before=len(before), after=len(after))
        losses = self.crashed("D3", open_ids, t_r)
        self.verify_all("D3")
        lo, hi = t_r - timedelta(seconds=20), t_rec + timedelta(seconds=20)
        holes = {n: self.holes(n, lo, hi) for n in ("ground", "drone")}
        self.check("D3: the footage lost to the restart is shown as a gap on each camera, at most 15 s",
                   all(len(h) <= 1 and all(x["durationMs"] <= 15_000 for x in h) for h in holes.values()), holes=holes)
        self.end(t_r, t_rec if up else None, {n: sum(x["durationMs"] for x in h) for n, h in holes.items()},
                 openSegments=losses, note="RPO is the gap each camera shows across the restart, in ms")

    def d4_edge_kill(self, sid: str) -> None:
        self.begin("D4 Edge killed mid-sync", "SIGKILL to the Edge while the cloud holds an applied, unanswered batch")
        self.set_wan(False)
        made = self.incidents(sid, 25)
        self.sink_mode("slow 8")
        seen_batches = len(self.sink())
        self.set_wan(True)
        flying = self.until("a batch in flight", lambda: next((b for b in self.sink()[seen_batches:] if b["pauseS"]), None),
                            90, every=0.3)
        cid = self.compose("ps", "-q", "edge").strip()
        subprocess.run(["docker", "kill", cid], capture_output=True)
        t_kill = self.note("D4: Edge SIGKILLed", inFlight=len((flying or {}).get("items", [])))
        self.sink_mode("normal")
        time.sleep(5)
        running = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", cid], capture_output=True, text=True).stdout.strip()
        action = None
        if running != "true":
            action = "docker compose start edge: the restart policy does not bring back a container that was docker-killed"
            self.compose("start", "edge")
        up = self.until("edge back", lambda: self.api("GET", "/edge/v1/health").get("passes", 0) > 0, 90, every=1)
        t_up = utc()
        box = self.outbox()
        audit = self.api("GET", "/edge/v1/audit/verify")
        self.check("D4: after the kill SQLite is whole and the audit chain verifies",
                   box.get("integrity") == "ok" and audit.get("ok") is True, integrity=box.get("integrity"), audit=audit)
        lost = [i for i in made if self.call("GET", f"/edge/v1/incidents/{i}")[0] != 200]
        self.check("D4: every incident the Edge confirmed before the kill is still there", made and not lost,
                   confirmed=len(made), lost=lost)
        t_drained = self.drain("outbox drained after the kill", 300)
        keys = (flying or {}).get("items", [])
        sink = self.sink_keys()
        replayed = [k["idempotencyKey"] for k in keys if sink.get(k["idempotencyKey"], []).count("applied") == 1
                    and "replayed" in sink[k["idempotencyKey"]]]
        doubled = [k for k, s in sink.items() if s.count("applied") > 1 or "conflict" in s]
        self.check("D4: the batch the cloud took but never answered is sent again and answered 'replayed', nothing applied twice",
                   keys and len(replayed) == len(keys) and not doubled and t_drained is not None,
                   inFlight=len(keys), replayed=len(replayed), doubled=len(doubled))
        holes = {n: self.holes(n, t_kill - timedelta(seconds=10), t_up + timedelta(seconds=10)) for n in ("ground", "drone")}
        self.check("D4: both cameras recorded through the Edge's kill", all(h == [] for h in holes.values()), holes=holes)
        self.verify_all("D4")
        self.end(t_kill, t_up if up else None, {"recordsLost": len(lost), "footageLostMs": 0 if all(h == [] for h in holes.values()) else None},
                 detected_at=t_kill, operator_action=action,
                 outboxDrainedAt=iso(t_drained) if t_drained else None, restartPolicyRestarted=running == "true",
                 note="RTO is from the kill to the Edge answering again, including the manual start")

    def d5_power_cut(self, sid: str) -> None:
        self.begin("D5 power cut", "every venue container SIGKILLed at once, off 15 s, then started")
        made = self.incidents(sid, 5)
        keys_before = {r["key"] for r in self.outbox().get("rows", [])}
        open_ids = self.open_segments()
        services = ("mediamtx", "edge", "synth-ground", "synth-drone", "lan-relay")
        cids = [self.compose("ps", "-q", s).strip() for s in services]
        t_cut = self.note("D5: power cut", openSegments=len(open_ids))
        subprocess.run(["docker", "kill", *[c for c in cids if c]], capture_output=True)
        time.sleep(15)
        t_power = self.note("D5: power back (stack started)")
        self.compose("up", "-d", timeout=300)
        up = self.until("both recording and the Edge answering",
                        lambda: self.api("GET", "/edge/v1/health").get("passes", 0) > 0 and self.both_up(), 180, every=1)
        t_rec = utc()
        self.check("D5: after power returns both cameras record and the Edge answers", bool(up))
        self.wait(40, "finalise the segments open at the cut")
        box = self.outbox()
        audit = self.api("GET", "/edge/v1/audit/verify")
        self.check("D5: SQLite is whole and the audit chain verifies", box.get("integrity") == "ok" and audit.get("ok") is True,
                   integrity=box.get("integrity"), audit=audit)
        lost = [i for i in made if self.call("GET", f"/edge/v1/incidents/{i}")[0] != 200]
        missing = keys_before - {r["key"] for r in box.get("rows", [])}
        self.check("D5: every incident confirmed before the cut, and every queued record, survives it",
                   made and not lost and not missing, confirmed=len(made), lost=lost, recordsMissing=len(missing))
        losses = self.crashed("D5", open_ids, t_cut)
        self.verify_all("D5")
        self.check("D5: the outbox drains after the restart", self.drain("outbox drained after the cut", 300) is not None)
        holes = {n: self.holes(n, t_cut - timedelta(seconds=40), t_rec + timedelta(seconds=20)) for n in ("ground", "drone")}
        self.check("D5: the footage lost to the cut is shown as one gap per camera",
                   all(len(h) == 1 for h in holes.values()), holes=holes)
        self.end(t_cut, t_rec if up else None,
                 {**{n: sum(x["durationMs"] for x in h) for n, h in holes.items()},
                  "beyondOffMs": {n: sum(x["durationMs"] for x in h) - 15_000 for n, h in holes.items()},
                  "recordsLost": len(lost) + len(missing)},
                 detected_at=t_power, operator_action="docker compose up -d, standing in for Docker starting at boot (host configuration, not verified)",
                 openSegments=losses, offSeconds=15,
                 note="RTO is from the cut, including 15 s off; RPO is each camera's gap in ms. The page cache survives a docker kill")

    # ── 5.3: the disk's limits, and a full disk ───────────────────────────
    def fill(self, free_bytes: int) -> dict:
        return self.edge_python(FILL_SCRIPT, str(max(0, free_bytes)))

    def alert_open(self, kind: str, source: str | None = None) -> dict | None:
        alerts = self.api("GET", "/edge/v1/alerts")
        return next((a for a in alerts if isinstance(a, dict) and a.get("kind") == kind
                     and (source is None or a.get("source") == source)), None)

    def browser_check(self, stage: str) -> None:
        """Hold for a look at the console: until `continue-<stage>` appears in the run's folder,
        or --browser-pause seconds."""
        if self.browser_pause:
            go = self.out / f"continue-{stage}"
            self.note(f"BROWSER CHECK {stage}", until=iso(utc() + timedelta(seconds=self.browser_pause)), go=str(go))
            deadline = time.monotonic() + self.browser_pause
            while not go.exists() and time.monotonic() < deadline:
                time.sleep(1)

    def storage(self) -> None:
        self.setup_auth()
        if self.browser_pause:
            (self.out / "console-signin.json").write_text(json.dumps({"email": self.email, "pin": self.pin}), encoding="utf-8")
        self.up()
        self.wait(40, "first segments")
        self.both_recording("S0")
        _, session = self.call("POST", "/edge/v1/sessions", {"label": "Storage drill (synthetic)", "matchRef": "storage"})
        soft, hard = int(STORAGE_SOFT_GB * 1024 ** 3), int(STORAGE_HARD_GB * 1024 ** 3)
        a = self.fill(1 << 62)  # writes nothing: reads the volume
        time.sleep(30)
        b = self.fill(1 << 62)
        rate = max(1.0, (a["free"] - b["free"]) / 30)
        self.measurements["storage"] = {"totalBytes": b["total"], "fillBytesPerSecond": round(rate),
                                        "softLimitFreeBytes": soft, "hardLimitFreeBytes": hard}
        self.check("S0: the recordings are on the drill's small volume, and no disk alert is open",
                   b["total"] < 2 * 1024 ** 3 and b["free"] > soft and not self.alert_open("disk_soft_limit")
                   and not self.alert_open("disk_hard_limit"), volume=b, fillBytesPerSecond=round(rate))
        self.begin("S1 soft limit", "filled to under the soft limit")
        t1 = self.note("S1: fill to under the soft limit", free=soft - 20 * MB)
        self.fill(soft - 20 * MB)
        seen = self.until("disk_soft_limit", lambda: self.alert_open("disk_soft_limit"), 30, every=1)
        t1_seen = utc()
        status, _ = self.call("POST", "/edge/v1/sessions", {"label": "under the soft limit", "matchRef": "storage"})
        self.check("S1: under the soft limit the Edge raises a warning, and still starts a new session",
                   bool(seen) and seen.get("severity") == "warning" and not self.alert_open("disk_hard_limit") and status == 201,
                   alert=seen, newSession=status)
        time.sleep(65)  # a minute of samples for the outlook
        disk = self.api("GET", "/edge/v1/health").get("disk", {})
        self.check("S1: health gives the free space, the soft state and the minutes left at the fill rate",
                   disk.get("state") == "soft_limit" and disk.get("freeBytes", 0) > 0 and disk.get("minutesToHardLimit") is not None,
                   disk=disk)
        self.check("S1: both cameras carry on recording", bool(self.until("both recording", self.both_up, 15, every=1)))
        self.browser_check("soft")
        self.end(t1, None, {"footageLostMs": 0}, detected_at=t1_seen, detectSeconds=round((t1_seen - t1).total_seconds(), 1),
                 note="nothing to recover from: a warning only")

        self.begin("S2 hard limit", "filled to under the hard limit")
        t2 = self.note("S2: fill to under the hard limit", free=hard - 20 * MB)
        self.fill(hard - 20 * MB)
        seen = self.until("disk_hard_limit", lambda: self.alert_open("disk_hard_limit"), 30, every=1)
        t2_seen = utc()
        s_status, s_body = self.call("POST", "/edge/v1/sessions", {"label": "under the hard limit", "matchRef": "storage"})
        i_status, inc = self.call("POST", "/edge/v1/incidents", {"sessionId": session["id"], "basis": "manual",
                                                                  "eventUtc": iso(utc() - timedelta(seconds=30))})
        c_status, c_body = self.call("POST", f"/edge/v1/incidents/{inc['id']}/clips", {"source": "ground"}) if i_status == 201 else (0, None)
        self.check("S2: under the hard limit the Edge raises a critical alert", bool(seen) and seen.get("severity") == "critical",
                   alert=seen)
        self.check("S2: it refuses a new session and a new clip with 507, and still records an incident",
                   s_status == 507 and c_status == 507 and i_status == 201
                   and (s_body or {}).get("error") == "disk_hard_limit" and (c_body or {}).get("error") == "disk_hard_limit",
                   session=s_status, incident=i_status, clip=c_status)
        self.check("S2: both cameras carry on recording", bool(self.until("both recording", self.both_up, 15, every=1)))
        self.browser_check("hard")
        self.end(t2, None, {"footageLostMs": 0}, detected_at=t2_seen, detectSeconds=round((t2_seen - t2).total_seconds(), 1),
                 note="new work that writes files is refused; recording carries on")

        self.begin("S3 disk full", "the volume filled completely, held 30 s, then the filler removed")
        open_ids = self.open_segments()
        t3 = self.note("S3: fill the disk")
        full = self.fill(0)
        disk_full = self.until("disk_full", lambda: self.alert_open("disk_full"), 30, every=1)
        t3_full = utc()
        stalled = self.until("recording_stalled on both", lambda: all(self.alert_open("recording_stalled", n) for n in ("ground", "drone")),
                             30, every=1)
        t3_seen = utc()
        views = []
        for _ in range(6):
            views.append({n: self.source(n).get("recording") for n in ("ground", "drone")})
            time.sleep(2)
        self.check("S3: a full disk raises disk_full (critical), and the disk's state is full",
                   bool(disk_full) and disk_full.get("severity") == "critical"
                   and self.api("GET", "/edge/v1/disk").get("state") == "full",
                   detectSeconds=round((t3_full - t3).total_seconds(), 1))
        self.check("S3: no camera is shown as recording while the disk is full",
                   not any(v for view in views for v in view.values()), samples=views)
        self.check("S3: with the disk full, recording stops and is raised as recording_stalled (critical) on both cameras",
                   bool(stalled) and all((self.alert_open("recording_stalled", n) or {}).get("severity") == "critical" for n in ("ground", "drone")),
                   fill=full)
        status, _ = self.call("POST", "/edge/v1/incidents", {"sessionId": session["id"], "basis": "manual",
                                                             "eventUtc": iso(utc() - timedelta(seconds=10))})
        self.check("S3: the Edge still answers and its database (on its own volume) still takes an incident",
                   self.api("GET", "/edge/v1/health").get("passes", 0) > 0 and status == 201, incident=status)
        self.browser_check("full")
        time.sleep(30)
        t_free = self.note("S4: remove the filler")
        self.compose("exec", "-T", "edge", "rm", "-f", "/var/lib/fairplay/recordings/.drill-filler", check=False)
        back = self.until("both recording after the disk is freed", self.both_up, 90, every=1)
        t_back = utc()
        action = None
        if not back:
            action = "docker compose restart mediamtx: recording did not resume by itself"
            self.compose("restart", "mediamtx", timeout=120)
            back = self.until("both recording after a MediaMTX restart", self.both_up, 90, every=1)
            t_back = utc()
        self.check("S4: once space is freed both cameras record again, with no restart", action is None, recovered=bool(back))
        self.wait(45, "finalise the segments open when the disk filled")
        left = [k for k in ("disk_soft_limit", "disk_hard_limit", "disk_full") if self.alert_open(k)]
        left += [f"recording_stalled:{n}" for n in ("ground", "drone") if self.alert_open("recording_stalled", n)]
        self.check("S4: the disk and recording alerts resolve", not left, open=left)
        losses = self.crashed("S4", open_ids, t3)
        self.verify_all("S4")
        holes = {n: self.holes(n, t3 - timedelta(seconds=30), t_back + timedelta(seconds=20)) for n in ("ground", "drone")}
        self.check("S4: the footage lost while the disk was full is shown as a gap on each camera",
                   all(len(h) >= 1 for h in holes.values()), holes=holes)
        self.end(t_free, t_back if back else None, {n: sum(x["durationMs"] for x in h) for n, h in holes.items()},
                 detected_at=t3_seen, operator_action=action, openSegments=losses,
                 fullSeconds=round((t_free - t3).total_seconds(), 1),
                 note="RTO is from the space being freed to both cameras recording; RPO is each camera's gap in ms")
        self.stats("end of storage drill")

    # ── output ────────────────────────────────────────────────────────────
    def finish(self) -> int:
        self.measurements["drills"] = self.log
        rows = ["# Failure drill log", "", f"Run {iso(self.started)}. Synthetic feeds only; stand-in cloud (TEST ONLY).", "",
                "| Drill | Fault | RTO (s) | RPO | Operator action | Checks |", "|---|---|---|---|---|---|"]
        for d in self.log:
            rows.append(f"| {d['drill']} | {d['fault']} | {d['rtoSeconds']} | {json.dumps(d['rpo'])} | "
                        f"{d['operatorAction'] or 'none'} | {d['passed']} passed, {d['failed']} failed |")
        rows += [""] + [f"- **{d['drill']}**: {d.get('note', '')}" for d in self.log]
        (self.out / "drills.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
        return super().finish()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario", nargs="?", choices=("drills", "storage"), default="drills")
    parser.add_argument("--wan-minutes", type=float, default=30)
    parser.add_argument("--browser-pause", type=float, default=0, help="storage: seconds to hold at the soft and hard limits")
    parser.add_argument("--keep", action="store_true", help="leave the stack and its volumes up afterwards")
    parser.add_argument("--project", default="fpdrill", help="Compose project name (one stack at a time: the subnet is fixed)")
    args = parser.parse_args()
    run = Drills(keep=args.keep, project=args.project, wan_minutes=args.wan_minutes, scenario=args.scenario,
                 browser_pause=args.browser_pause)
    try:
        run.storage() if args.scenario == "storage" else run.drills()
    except Exception as exc:
        run.check(f"drills ran to completion ({exc.__class__.__name__}: {exc})", False)
    return run.finish()


if __name__ == "__main__":
    sys.exit(main())
