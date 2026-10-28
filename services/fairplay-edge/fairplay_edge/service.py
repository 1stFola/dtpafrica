"""The background loop: watch, scan, sample the clock, and (when enabled) retain.

It runs inside the API process, in a worker thread so hashing never blocks a request. If
this process stops, MediaMTX keeps recording: the next start scans what was written while
it was down. Stopping waits for the current pass, so a hash is never cut off half-way.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

from . import retention
from .auth import AuthError, Bundle, Sessions, load_trusted_keys, verify_bundle
from .config import Settings
from .manifest import Scanner
from .mediamtx import MediaMtx
from .store import Store
from .timing import ClockWatch
from .watchdog import Watchdog

log = logging.getLogger("fairplay.service")

RETENTION_EVERY_SECONDS = 3600
CLOCK_EVERY_SECONDS = 60


class EdgeService:
    def __init__(self, settings: Settings):
        self.settings = settings
        for folder in (settings.data_dir, settings.manifests_dir, settings.repaired_dir):
            folder.mkdir(parents=True, exist_ok=True)
        self.store = Store(settings.db_path)
        self.mediamtx = MediaMtx(
            settings.mediamtx_api_url, settings.mediamtx_playback_url, settings.mediamtx_user, settings.mediamtx_password
        )
        self.watchdog = Watchdog(settings, self.store, self.mediamtx)
        self.scanner = Scanner(settings, self.store)
        self.sessions = Sessions(self.store)
        self.clock = ClockWatch(self.store)
        self.bundle: Bundle | None = None
        self.bundle_error: str | None = None
        self._bundle_mtime: float | None = None
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._last_retention = 0.0
        self._last_clock = 0.0
        self.passes = 0
        self.last_pass_error: str | None = None
        self.reload_bundle()

    def reload_bundle(self) -> None:
        """Load the operator bundle if it changed. A bad bundle signs nobody in; it never half-loads."""
        path = self.settings.bundle_file
        if path is None or not path.exists():
            self.bundle, self.bundle_error, self._bundle_mtime = None, "no operator bundle installed", None
            return
        mtime = path.stat().st_mtime
        if mtime == self._bundle_mtime:
            return
        self._bundle_mtime = mtime
        try:
            trusted = load_trusted_keys(self.settings.trusted_keys_file)
            self.bundle = verify_bundle(json.loads(path.read_text(encoding="utf-8")), trusted,
                                        allow_dev=self.settings.allow_dev_bundles)
            self.bundle_error = None
            log.info(json.dumps({"event": "bundle.loaded", "bundleId": self.bundle.bundle_id,
                                 "issuer": self.bundle.issuer, "members": len(self.bundle.members)}))
        except (AuthError, ValueError, KeyError, OSError) as exc:
            self.bundle, self.bundle_error = None, str(exc)
            log.warning(json.dumps({"event": "bundle.refused", "error": str(exc)}))

    def run_once(self) -> None:
        snapshot = self.watchdog.poll()
        self.scanner.scan(snapshot.publishing())
        if time.monotonic() - self._last_clock >= CLOCK_EVERY_SECONDS:
            self._last_clock = time.monotonic()
            self.clock.sample()
        self.reload_bundle()
        if self.settings.retention_days is not None and time.monotonic() - self._last_retention > RETENTION_EVERY_SECONDS:
            self._last_retention = time.monotonic()
            deleted = retention.apply(self.settings, self.store, self.scanner)
            if deleted:
                log.info(json.dumps({"event": "retention.run", "deleted": len(deleted)}))
        self.passes += 1

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.to_thread(self.run_once)
                self.last_pass_error = None
            except Exception as exc:  # a failed pass must not end the loop
                self.last_pass_error = f"{exc.__class__.__name__}: {exc}"
                log.exception("edge pass failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.settings.poll_seconds)
            except asyncio.TimeoutError:
                pass

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop(), name="fairplay-edge-loop")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            await self._task
