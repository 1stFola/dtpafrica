"""The background loop: watch, scan, and (when enabled) retain.

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
from .config import Settings
from .manifest import Scanner
from .mediamtx import MediaMtx
from .store import Store
from .watchdog import Watchdog

log = logging.getLogger("fairplay.service")

RETENTION_EVERY_SECONDS = 3600


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
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._last_retention = 0.0
        self.passes = 0
        self.last_pass_error: str | None = None

    def run_once(self) -> None:
        snapshot = self.watchdog.poll()
        self.scanner.scan(snapshot.publishing())
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
