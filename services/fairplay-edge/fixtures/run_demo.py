#!/usr/bin/env python3
"""TEST ONLY: the stakeholder demo's stack and dataset (docs/fairplay/demo-walkthrough.md).

    python -I fixtures/run_demo.py up --cloud <the file `pnpm fairplay:democloud` wrote>
    python -I fixtures/run_demo.py wan off      # and `wan on`
    python -I fixtures/run_demo.py check        # what the dataset holds
    python -I fixtures/run_demo.py estimate     # a match's storage and cost, from what it measured
    python -I fixtures/run_demo.py down         # deletes the demo's recordings and records

Everything is synthetic: two test-pattern feeds and made-up incidents, labelled as such, on a
Compose project of its own. It builds and pulls nothing: it needs the local Edge image and the
built console. No real footage belongs here, and nothing in it is a forecast of a real match.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_fixture import ROOT, Run, iso, utc  # noqa: E402

PROJECT = "fpdemo"
OUT = ROOT / "fixtures" / "out" / "demo"
CONSOLE_DIST = ROOT.parent.parent / "apps" / "fairplay-console" / "dist"
DATA = "/var/lib/fairplay/data"
LINKS = ("demo-link-api", "demo-link-s3")

# Made up, and written the way a real finding must be: what the footage shows, no opinion of a person.
INCIDENTS = [
    {"name": "foul", "category": "foul", "minute": 12, "cameras": ("ground", "drone"), "result": "supports_original",
     "onField": "DEMO: pretend free kick awarded",
     "note": "DEMO, synthetic feed. Pretend foul. Both cameras recorded the moment.",
     "finding": "DEMO, synthetic feed. The test pattern is visible on both cameras throughout the window."},
    {"name": "goal", "category": "goal", "minute": 27, "cameras": ("ground", "drone"), "result": "supports_alternative",
     "onField": "DEMO: pretend goal not given",
     "note": "DEMO, synthetic feed. Pretend goal line moment.",
     "finding": "DEMO, synthetic feed. Shown only to demonstrate this result. A finding changes no decision or score."},
    {"name": "gap", "category": "penalty", "minute": 38, "cameras": ("ground",), "result": "inconclusive",
     "onField": "DEMO: pretend penalty not given",
     "note": "DEMO, synthetic feed. The drone feed was stopped on purpose for this moment.",
     "finding": "DEMO, synthetic feed. The drone has no footage of this moment and the gap is shown. The ground camera alone does not settle it."},
]


class Demo(Run):
    def __init__(self) -> None:  # noqa: D107 (Run's folder is per run; the demo's stays put between commands)
        self.scenario, self.wan, self.keep, self.project = "demo", False, True, PROJECT
        self.started = utc()
        self.out = OUT
        self.overlays = ["compose.demo.yaml"]
        self.extra_env = {"FAIRPLAY_CONSOLE_PATH": str(CONSOLE_DIST)}
        self.checks: list[dict] = []
        self.timeline: list[dict] = []
        self.measurements: dict = {}

    def compose(self, *args: str, **kwargs) -> str:  # the same, with the demo's folder
        self.out.mkdir(parents=True, exist_ok=True)
        return super().compose(*args, **kwargs)

    def write_config(self) -> None:
        self.out.mkdir(parents=True, exist_ok=True)
        self._write_config()
        env = self.out / "fixture.env"
        env.write_text(env.read_text(encoding="utf-8").replace("FAIRPLAY_DEVICE_LABEL=fixture", "FAIRPLAY_DEVICE_LABEL=demo-synthetic"), encoding="utf-8")

    # ── the stack ─────────────────────────────────────────────────────────
    def up_stack(self, cloud: dict) -> None:
        image = f"dtp-fairplay-edge:{__import__('os').environ.get('FAIRPLAY_EDGE_TAG', 'local')}"
        if subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode:
            raise SystemExit(f"no local image {image}: this demo pulls and builds nothing. Install an Edge first (docs/fairplay/edge-install.md)")
        if not (CONSOLE_DIST / "index.html").exists():
            raise SystemExit("no built console: pnpm --filter @dtp/fairplay-console build")
        self.compose("down", "-v", "--remove-orphans", check=False)
        if self.out.exists():
            shutil.rmtree(self.out)
        self.write_config()
        self.compose("up", "-d", "--no-build", timeout=300)
        self.check("the Edge answers", bool(self.until("the Edge", lambda: self.api("GET", "/edge/v1/health").get("passes", 0) > 0, 90)))
        self.pair(cloud)
        # Sync is switched on only now: the Edge refuses to start with a token file that does not exist yet.
        with (self.out / "fixture.env").open("a", encoding="utf-8") as fh:
            fh.write(f"FAIRPLAY_CLOUD_SYNC_URL=http://127.0.0.1:3190\nFAIRPLAY_CLOUD_DEVICE_TOKEN_FILE={DATA}/cloud-device-token\n")
        self.compose("up", "-d", "--no-build", "--force-recreate", "edge", *LINKS, timeout=180)
        self.check("the Edge answers after pairing", bool(self.until("the Edge", lambda: self.api("GET", "/edge/v1/health").get("passes", 0) > 0, 90)))
        self.check("the signed operator list arrived from the cloud", bool(self.until("the bundle", self.has_bundle, 90)))
        self.both_recording("demo")

    def pair(self, cloud: dict) -> None:
        subprocess.run(self.exec_cmd("sh", "-c", "cat > /tmp/bootstrap"), input=cloud["bootstrapToken"], text=True, cwd=ROOT, env=self.env(), check=True)
        out = self.compose("exec", "-T", "edge", "fairplay-edge", "pair", "--url", "http://127.0.0.1:3190",
                           "--bootstrap-token-file", "/tmp/bootstrap", "--token-file", f"{DATA}/cloud-device-token",
                           "--trusted-keys", f"{DATA}/trusted-keys.json", check=False)
        self.compose("exec", "-T", "edge", "rm", "-f", "/tmp/bootstrap", check=False)
        self.check("paired with the demo's cloud", "tokenFile" in out, out=out.strip()[-300:])

    def has_bundle(self) -> bool:
        return not subprocess.run(self.exec_cmd("test", "-s", f"{DATA}/bundle.json"), cwd=ROOT, env=self.env(), capture_output=True).returncode

    def env(self) -> dict:
        import os

        return {**os.environ, "MSYS_NO_PATHCONV": "1", "FAIRPLAY_ENV_FILE": str(self.out / "fixture.env"),
                "FAIRPLAY_PUBLISH_ENV_FILE": str(self.out / "fixture-publish.env"), "FAIRPLAY_SOURCES_PATH": str(self.out / "sources.toml"),
                "FAIRPLAY_AUTH_DIR": str(self._empty("auth")), **self.extra_env}

    def exec_cmd(self, *args: str) -> list[str]:
        return ["docker", "compose", "-p", PROJECT, "-f", "compose.yaml", "-f", "compose.demo.yaml", "--profile", "synthetic", "exec", "-T", "edge", *args]

    # ── the dataset ───────────────────────────────────────────────────────
    def incident(self, sid: str, spec: dict, event) -> str:
        status, inc = self.call("POST", "/edge/v1/incidents", {
            "sessionId": sid, "eventUtc": iso(event), "basis": "manual", "category": spec["category"], "note": spec["note"],
            "period": "1", "matchMinute": spec["minute"]})
        self.check(f"{spec['name']}: flagged", status == 201, body=inc)
        made = []
        for camera in spec["cameras"]:
            job = self.clip(inc["id"], camera)
            self.check(f"{spec['name']}: {camera} clip cut", job.get("state") == "succeeded", job=job)
            if job.get("evidence_id"):
                made.append(job["evidence_id"])
        now = self.api("GET", f"/edge/v1/incidents/{inc['id']}")
        status, started = self.call("POST", f"/edge/v1/incidents/{inc['id']}/review/start", None, {"If-Match": str(now["version"])})
        self.check(f"{spec['name']}: review started", status in (200, 201), body=started)
        status, done = self.call("POST", f"/edge/v1/incidents/{inc['id']}/review/complete", {
            "result": spec["result"], "factualNotes": spec["finding"], "onFieldDecision": spec["onField"], "evidenceIds": made},
            {"If-Match": str(started.get("version"))})
        self.check(f"{spec['name']}: finding recorded as {spec['result']}", status in (200, 201), body=done)
        for evidence_id in made:
            status, body = self.call("POST", f"/edge/v1/evidence/{evidence_id}/approve")
            self.check(f"{spec['name']}: clip approved", status in (200, 201), body=body)
        return inc["id"]

    def seed(self) -> dict:
        status, session = self.call("POST", "/edge/v1/sessions", {"label": "DEMO: synthetic feeds, no real players"})
        self.check("the session opened", status == 201, body=session)
        sid = session["id"]
        status, rights = self.call("POST", f"/edge/v1/sessions/{sid}/rights", {"footageKind": "synthetic", "status": "not_recorded", "minorsPresent": "no"})
        self.check("rights recorded as synthetic test footage", status == 201, body=rights)
        status, period = self.call("POST", f"/edge/v1/sessions/{sid}/periods", {"period": "1", "edge": "start"})
        self.check("kick-off marked", status == 201, body=period)

        self.wait(75, "a recording long enough to cut from")
        for spec in INCIDENTS[:2]:
            self.incident(sid, spec, utc() - timedelta(seconds=45))
            self.wait(20, "time between the incidents")

        # A real gap, not a label: stop the drone's feed over the third incident's whole window.
        self.compose("stop", "synth-drone")
        self.wait(50, "the drone's gap")
        moment = utc() - timedelta(seconds=15)
        self.compose("start", "synth-drone")
        self.wait(45, "the recordings around the gap to finish")
        self.incident(sid, INCIDENTS[2], moment)
        return {"sessionId": sid}

    def report(self) -> dict:
        sessions = self.api("GET", "/edge/v1/report/sessions")
        sid = next(s["id"] for s in sessions if s["label"].startswith("DEMO"))
        return self.api("GET", f"/edge/v1/report/sessions/{sid}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    up = sub.add_parser("up")
    up.add_argument("--cloud", required=True, help="the file `pnpm fairplay:democloud` wrote")
    wan = sub.add_parser("wan")
    wan.add_argument("state", choices=["off", "on"])
    sub.add_parser("check")
    sub.add_parser("estimate")
    sub.add_parser("down")
    args = parser.parse_args()

    demo = Demo()
    if args.command == "up":
        cloud = json.loads(Path(args.cloud).read_text(encoding="utf-8"))
        begun = time.monotonic()
        demo.up_stack(cloud)
        seeded = demo.seed()
        same = seeded["sessionId"] == cloud["sessionId"]
        demo.check("the session is the one the cloud provisioned", same, edge=seeded["sessionId"], cloud=cloud["sessionId"])
        failed = [c for c in demo.checks if not c["passed"]]
        print(f"\n{len(demo.checks) - len(failed)}/{len(demo.checks)} passed in {time.monotonic() - begun:.0f} s")
        print("Console: http://127.0.0.1:8443 (sign-in details are in the cloud file, not printed here)")
        return 1 if failed else 0
    if args.command == "wan":
        demo.compose("stop" if args.state == "off" else "start", *LINKS, timeout=60)
        print(f"WAN {args.state}: the feeds and the Edge are untouched")
        return 0
    if args.command == "check":
        print(json.dumps({"health": {k: v for k, v in demo.api("GET", "/edge/v1/health").items() if k in ("cloud", "disk")},
                          "report": demo.report(), "auditChain": demo.api("GET", "/edge/v1/audit/verify")}, indent=2))
        return 0
    if args.command == "estimate":
        measured = demo.compose("exec", "-T", "edge", "fairplay-edge", "measure")
        sys.stdout.write(subprocess.run(demo.exec_cmd("fairplay-edge", "worksheet", "--from", "-"), input=measured, text=True, cwd=ROOT, env=demo.env(),
                                        capture_output=True, check=True, encoding="utf-8").stdout)
        return 0
    demo.compose("down", "-v", "--remove-orphans", check=False)
    if OUT.exists():
        shutil.rmtree(OUT)
    print("the demo's recordings and records are deleted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
