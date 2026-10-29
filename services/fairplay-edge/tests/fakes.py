from fairplay_edge.mediamtx import MediaMtxUnavailable, PathStatus


class FakeMediaMtx:
    """Stands in for MediaMTX's API and playback server."""

    def __init__(self):
        self.ready: dict[str, bool] = {}
        self.down = False
        self.recorded: dict[str, list[dict]] = {}
        self.auth = ("fairplay-edge", "x")
        self.publisher: dict[str, tuple[str, str]] = {}  # path -> (publisher session id, its IP address)

    def paths(self):
        if self.down:
            raise MediaMtxUnavailable("connection refused")
        return {
            name: PathStatus(name=name, ready=ready, ready_time="2026-10-27T14:00:00Z" if ready else None,
                             source_type="rtspSession", tracks=("H264", "MPEG-4 Audio"),
                             codec_props=({"codec": "H264", "width": 1280, "height": 720},),
                             bytes_received=1000, readers=0,
                             source_id=self.publisher.get(name, (f"session-{name}", ""))[0])
            for name, ready in self.ready.items()
        }

    def publisher_address(self, status):
        if self.down:
            raise MediaMtxUnavailable("connection refused")
        return self.publisher.get(status.name, ("", None))[1]

    def spans(self, path, start=None, end=None):
        if self.down:
            raise MediaMtxUnavailable("connection refused")
        return list(self.recorded.get(path, []))

    def get_url(self, path, start, duration_s, fmt="mp4"):
        return "http://mediamtx:9996/get", {"path": path}
