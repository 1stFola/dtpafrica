"""TEST ONLY: a stand-in for the DTP cloud, for the failure drills (run_drills.py).

It answers the two calls an Edge makes on its own, over HTTPS with a certificate from a CA
made for the run:
  POST /api/v1/fairplay/sync/batch   applies each record once; a record sent again with the
                                     same payload hash is "replayed", with another hash a
                                     "conflict" (as the real API answers);
  GET  /api/v1/fairplay/device/bundle  "no bundle" (the drill signs its own DEV bundle).

Every batch is appended to <data>/received.jsonl and fsynced before it is answered, so the
drill can see what the cloud took even when the Edge never heard back. <data>/mode holds
`normal` or `slow <seconds>`: answer each batch only after a pause, so the drill can kill
the Edge while a batch is in flight. It holds no real data and is never run at a venue.

    python -I drill_cloud.py --data /drill --cert server.pem --key server-key.pem --token-file token
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def results_for(items: list[dict], seen: dict[str, str]) -> list[dict]:
    """One result per item, the way the cloud's sync endpoint answers; `seen` is updated."""
    out = []
    for item in items:
        key, digest = item.get("idempotencyKey"), item.get("payloadHash")
        if key in seen:
            status = "replayed" if seen[key] == digest else "conflict"
        else:
            seen[key] = digest
            status = "applied"
        out.append({"idempotencyKey": key, "status": status})
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--listen", default="0.0.0.0:9443")
    args = parser.parse_args()
    token = args.token_file.read_text(encoding="utf-8").strip()
    log = args.data / "received.jsonl"
    seen: dict[str, str] = {}
    if log.exists():  # a restarted sink remembers what it applied
        for line in log.read_text(encoding="utf-8").splitlines():
            for r in json.loads(line).get("items", []):
                if r["status"] == "applied":
                    seen[r["idempotencyKey"]] = r["payloadHash"]
    lock = threading.Lock()

    def mode() -> float:
        try:
            parts = (args.data / "mode").read_text(encoding="utf-8").split()
        except OSError:
            return 0.0
        return float(parts[1]) if len(parts) == 2 and parts[0] == "slow" else 0.0

    class Handler(BaseHTTPRequestHandler):
        def _answer(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorised(self) -> bool:
            if self.headers.get("x-fairplay-device-token") != token:
                self._answer(401, {"error": "DeviceTokenInvalid"})
                return False
            return True

        def do_GET(self):  # noqa: N802
            if not self._authorised():
                return
            if self.path.split("?")[0] == "/api/v1/fairplay/device/bundle":
                self._answer(200, {"bundle": None, "reason": "drill cloud: no bundle"})
            else:
                self._answer(404, {"error": "NotFound"})

        def do_POST(self):  # noqa: N802
            if not self._authorised():
                return
            if self.path != "/api/v1/fairplay/sync/batch":
                self._answer(404, {"error": "NotFound"})
                return
            body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
            items = body.get("items") or []
            pause = mode()
            with lock:
                results = results_for(items, seen)
                record = {"at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                          "deviceId": body.get("deviceId"), "pauseS": pause,
                          "items": [{"idempotencyKey": i.get("idempotencyKey"), "entityType": i.get("entityType"),
                                     "payloadHash": i.get("payloadHash"), "status": r["status"]}
                                    for i, r in zip(items, results)]}
                with log.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(record) + "\n")
                    fh.flush()
                    os.fsync(fh.fileno())
            if pause:
                time.sleep(pause)
            self._answer(200, {"results": results})

        def log_message(self, fmt, *a):
            print(f"drill-cloud {self.address_string()} {fmt % a}", flush=True)

    host, port = args.listen.rsplit(":", 1)
    server = ThreadingHTTPServer((host, int(port)), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(args.cert, args.key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f"drill-cloud listening on {args.listen} (TEST ONLY)", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
