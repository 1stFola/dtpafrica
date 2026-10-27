"""`fairplay-edge` command line."""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import sys
from pathlib import Path

from .config import ConfigError, is_loopback, load_settings, require_secret


def _settings(need_api_token: bool = True):
    try:
        return load_settings(need_api_token=need_api_token)
    except ConfigError as exc:
        print(f"fairplay-edge: refusing to start: {exc}", file=sys.stderr)
        raise SystemExit(2)


def cmd_serve(_: argparse.Namespace) -> int:
    import uvicorn

    from .api import create_app
    from .service import EdgeService

    settings = _settings()
    listen = os.environ.get("FAIRPLAY_EDGE_LISTEN", settings.host_bind)
    # Inside a container the process listens on all interfaces and the port mapping decides
    # who can reach it (FAIRPLAY_EDGE_HOST_BIND, checked in load_settings). Outside one,
    # listening beyond loopback needs TLS just the same.
    if os.environ.get("FAIRPLAY_IN_CONTAINER") != "1" and not is_loopback(listen) and settings.tls_cert is None:
        print("fairplay-edge: refusing to listen beyond loopback without TLS", file=sys.stderr)
        return 2
    app = create_app(EdgeService(settings))
    uvicorn.run(
        app,
        host=listen,
        port=int(os.environ.get("FAIRPLAY_EDGE_PORT", "8443")),
        ssl_certfile=str(settings.tls_cert) if settings.tls_cert else None,
        ssl_keyfile=str(settings.tls_key) if settings.tls_key else None,
        log_level="info",
        timeout_graceful_shutdown=20,
    )
    return 0


def cmd_render(args: argparse.Namespace) -> int:
    from .mediamtx_config import write

    settings = _settings(need_api_token=False)
    try:
        write(settings, dict(os.environ), Path(args.out), mode=args.mode)
    except ConfigError as exc:
        print(f"fairplay-edge: refusing to render: {exc}", file=sys.stderr)
        return 2
    print(f"wrote {args.out}")
    return 0


def cmd_synth(args: argparse.Namespace) -> int:
    from .synth import Feed, run

    password = require_secret(dict(os.environ), f"FAIRPLAY_PUBLISH_PASSWORD_{args.source.upper().replace('-', '_')}")
    target = os.environ.get("FAIRPLAY_SYNTH_TARGET", "mediamtx:8554")
    feed = Feed(
        source=args.source,
        url=f"rtsp://pub-{args.source}:{password}@{target}/{args.source}",
        label=args.label or f"SYNTHETIC {args.source.upper()} - NOT REAL FOOTAGE",
        pattern=args.pattern,
        clock_offset_ms=args.clock_offset_ms,
        audio=not args.no_audio,
        duration_s=args.duration,
    )
    return run(feed)


def cmd_scan(_: argparse.Namespace) -> int:
    from .service import EdgeService

    service = EdgeService(_settings(need_api_token=False))
    service.run_once()
    print(json.dumps({"passes": service.passes}))
    return 0


def cmd_verify_all(_: argparse.Namespace) -> int:
    from .service import EdgeService

    service = EdgeService(_settings(need_api_token=False))
    rows = service.store.query("SELECT id FROM segments WHERE state IN ('finalized','partial','corrupt')")
    results = [service.scanner.verify(r["id"])["result"] for r in rows]
    summary = {k: results.count(k) for k in sorted(set(results))}
    print(json.dumps({"checked": len(results), **summary}))
    return 0 if set(results) <= {"match"} else 1


def cmd_retention(args: argparse.Namespace) -> int:
    from . import retention
    from .service import EdgeService

    service = EdgeService(_settings(need_api_token=False))
    if args.apply:
        if service.settings.retention_days is None:
            print("fairplay-edge: retention is off (FAIRPLAY_RETENTION_DAYS unset); nothing applied", file=sys.stderr)
            return 2
        print(json.dumps({"deleted": retention.apply(service.settings, service.store, service.scanner)}, indent=2))
        return 0
    rows = retention.plan(service.store, args.days or service.settings.retention_days or 30)
    print(json.dumps([{k: r[k] for k in ("id", "source", "rel_path", "state", "end_utc")} for r in rows], indent=2))
    return 0


def cmd_healthcheck(_: argparse.Namespace) -> int:
    """Container healthcheck: liveness only, so it needs no token and reveals nothing."""
    import ssl
    import urllib.request

    tls = bool(os.environ.get("FAIRPLAY_EDGE_TLS_CERT"))
    url = f"{'https' if tls else 'http'}://127.0.0.1:{os.environ.get('FAIRPLAY_EDGE_PORT', '8443')}/edge/v1/healthz"
    # The certificate names the Edge's LAN address and localhost, not 127.0.0.1; this probe
    # only proves the process answers, so it does not verify it.
    context = ssl._create_unverified_context() if tls else None
    try:
        with urllib.request.urlopen(url, timeout=3, context=context) as response:
            return 0 if response.status == 200 else 1
    except OSError:
        return 1


def cmd_api(args: argparse.Namespace) -> int:
    """Call this Edge's own API from the machine it runs on, with the token from the environment.
    Used by the fixtures through `docker compose exec`, so they work with the network cut."""
    import ssl
    import urllib.error
    import urllib.request

    token = require_secret(dict(os.environ), "FAIRPLAY_EDGE_API_TOKEN")
    tls = bool(os.environ.get("FAIRPLAY_EDGE_TLS_CERT"))
    url = f"{'https' if tls else 'http'}://127.0.0.1:{os.environ.get('FAIRPLAY_EDGE_PORT', '8443')}{args.path}"
    data = args.body.encode() if args.body else None
    request = urllib.request.Request(url, data=data, method=args.method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    context = ssl._create_unverified_context() if tls else None
    try:
        with urllib.request.urlopen(request, timeout=args.timeout, context=context) as response:
            payload = response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        payload, status = exc.read(), exc.code
    if args.out:
        Path(args.out).write_bytes(payload)
        print(json.dumps({"status": status, "bytes": len(payload), "out": args.out}))
    else:
        sys.stdout.write(payload.decode(errors="replace") + "\n")
    return 0 if status < 400 else 1


def cmd_check_egress(args: argparse.Namespace) -> int:
    """For the WAN-outage drill: try to reach the internet and report whether anything answered."""
    results = {}
    for target in args.targets:
        host, _, port = target.rpartition(":")
        try:
            with socket.create_connection((host, int(port)), timeout=args.timeout):
                results[target] = "reachable"
        except OSError as exc:
            results[target] = f"unreachable ({exc.__class__.__name__})"
    print(json.dumps(results))
    return 0 if all(v.startswith("unreachable") for v in results.values()) else 1


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="fairplay-edge")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("serve", help="run the Edge API and its background loop").set_defaults(fn=cmd_serve)
    render = sub.add_parser("render-mediamtx", help="write MediaMTX's hardened configuration")
    render.add_argument("--out", required=True)
    render.add_argument("--mode", choices=("docker", "native"), default="docker")
    render.set_defaults(fn=cmd_render)
    synth = sub.add_parser("synth", help="publish a SYNTHETIC test feed (development only)")
    synth.add_argument("--source", required=True)
    synth.add_argument("--label")
    synth.add_argument("--pattern", default="testsrc2")
    synth.add_argument("--clock-offset-ms", type=int, default=0)
    synth.add_argument("--no-audio", action="store_true")
    synth.add_argument("--duration", type=float)
    synth.set_defaults(fn=cmd_synth)
    sub.add_parser("scan-once", help="one watchdog + manifest pass").set_defaults(fn=cmd_scan)
    sub.add_parser("verify-all", help="re-hash every final segment").set_defaults(fn=cmd_verify_all)
    ret = sub.add_parser("retention", help="preview retention, or apply the configured rule")
    ret.add_argument("--days", type=int)
    ret.add_argument("--apply", action="store_true")
    ret.set_defaults(fn=cmd_retention)
    sub.add_parser("healthcheck", help="liveness probe for the container").set_defaults(fn=cmd_healthcheck)
    api = sub.add_parser("api", help="call this Edge's API locally with the configured token")
    api.add_argument("method", choices=("GET", "POST"))
    api.add_argument("path")
    api.add_argument("--body")
    api.add_argument("--out")
    api.add_argument("--timeout", type=float, default=60)
    api.set_defaults(fn=cmd_api)
    egress = sub.add_parser("check-egress", help="report whether the internet is reachable")
    egress.add_argument("targets", nargs="*", default=["1.1.1.1:443", "8.8.8.8:53", "www.dtp.africa:443"])
    egress.add_argument("--timeout", type=float, default=3.0)
    egress.set_defaults(fn=cmd_check_egress)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
