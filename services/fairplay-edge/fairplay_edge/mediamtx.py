"""Client for MediaMTX's control API and playback server, which only the Edge can reach."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import httpx

from .naming import iso


class MediaMtxUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class PathStatus:
    name: str
    ready: bool
    ready_time: str | None
    source_type: str | None
    tracks: tuple[str, ...]
    codec_props: tuple[dict, ...]
    bytes_received: int
    readers: int


class MediaMtx:
    def __init__(self, api_url: str, playback_url: str, user: str, password: str, timeout: float = 3.0):
        self.api_url = api_url
        self.playback_url = playback_url
        self.auth = (user, password)
        self.timeout = timeout

    def _get(self, url: str, params: dict | None = None) -> httpx.Response:
        try:
            response = httpx.get(url, params=params, auth=self.auth, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise MediaMtxUnavailable(f"{url}: {exc.__class__.__name__}: {exc}") from exc
        if response.status_code in (401, 403):
            raise MediaMtxUnavailable(f"{url}: MediaMTX refused the Edge's credentials ({response.status_code})")
        return response

    def paths(self) -> dict[str, PathStatus]:
        response = self._get(f"{self.api_url}/v3/paths/list", {"itemsPerPage": 1000})
        if response.status_code != 200:
            raise MediaMtxUnavailable(f"paths/list returned {response.status_code}")
        out: dict[str, PathStatus] = {}
        for item in response.json().get("items", []):
            source = item.get("source") or {}
            tracks2 = item.get("tracks2") or []
            out[item["name"]] = PathStatus(
                name=item["name"],
                ready=bool(item.get("ready")),
                ready_time=item.get("readyTime"),
                source_type=source.get("type"),
                tracks=tuple(item.get("tracks") or ()),
                codec_props=tuple(
                    {"codec": t.get("codec"), **(t.get("codecProps") or {})} for t in tracks2 if isinstance(t, dict)
                ),
                bytes_received=int(item.get("bytesReceived") or 0),
                readers=len(item.get("readers") or ()),
            )
        return out

    def spans(self, path: str, start: datetime | None = None, end: datetime | None = None) -> list[dict]:
        """Recorded timespans, as MediaMTX's playback server reports them. 404 means none."""
        params = {"path": path}
        if start:
            params["start"] = iso(start)
        if end:
            params["end"] = iso(end)
        response = self._get(f"{self.playback_url}/list", params)
        if response.status_code == 404:
            return []
        if response.status_code != 200:
            raise MediaMtxUnavailable(f"playback /list returned {response.status_code}: {response.text[:200]}")
        return [{"start": s["start"], "duration": float(s["duration"])} for s in response.json()]

    def get_url(self, path: str, start: datetime, duration_s: float, fmt: str = "mp4") -> tuple[str, dict]:
        return f"{self.playback_url}/get", {
            "path": path,
            "start": iso(start),
            "duration": f"{duration_s:.3f}",
            "format": fmt,
        }
