"""Whether the Edge's wall clock is synchronised, asked of the kernel (Phase 5.6, F11).

The kernel keeps the clock-discipline state that chrony, systemd-timesyncd or ntpd set, and
`adjtimex` with no mode bits reads it without changing anything. That needs no privilege
and works inside a container, whose clock is the host's. The answer is one of:

  synced    a time daemon is disciplining the clock, and the kernel's maximum error is
            within `FAIRPLAY_CLOCK_MAX_ERROR_MS`
  drifting  it was synchronised, but not lately: the maximum error has grown past the bound
            (the kernel adds 0.5 ms a second while no update arrives, as when the venue is
            offline)
  unsynced  the kernel marks the clock unsynchronised: no time daemon, or none for long
  unknown   the kernel could not be asked (not Linux, or the call was refused)

Only wall times depend on this: when an event happened by the Edge's clock against the match
console's. Offsets between cameras are measured on the one Edge clock, so they hold whatever
the clock's error.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import sys

STA_UNSYNC = 0x0040
TIME_ERROR = 5


class _Timeval(ctypes.Structure):
    _fields_ = [("tv_sec", ctypes.c_long), ("tv_usec", ctypes.c_long)]


class _Timex(ctypes.Structure):
    # struct timex, linux/timex.h: the kernel reads `modes` and fills in the rest.
    _fields_ = [("modes", ctypes.c_uint), ("offset", ctypes.c_long), ("freq", ctypes.c_long),
                ("maxerror", ctypes.c_long), ("esterror", ctypes.c_long), ("status", ctypes.c_int),
                ("constant", ctypes.c_long), ("precision", ctypes.c_long), ("tolerance", ctypes.c_long),
                ("time", _Timeval), ("tick", ctypes.c_long), ("ppsfreq", ctypes.c_long), ("jitter", ctypes.c_long),
                ("shift", ctypes.c_int), ("stabil", ctypes.c_long), ("jitcnt", ctypes.c_long),
                ("calcnt", ctypes.c_long), ("errcnt", ctypes.c_long), ("stbcnt", ctypes.c_long),
                ("tai", ctypes.c_int), ("_reserved", ctypes.c_int * 11)]


def kernel_timex() -> dict | None:
    """The kernel's clock state, or None where it cannot be read."""
    if not sys.platform.startswith("linux"):
        return None
    try:
        libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
        tx = _Timex()  # modes = 0: read only
        rc = libc.adjtimex(ctypes.byref(tx))
    except (OSError, AttributeError):
        return None
    if rc < 0:
        return None
    return {"rc": rc, "status": tx.status, "maxErrorUs": tx.maxerror, "estErrorUs": tx.esterror}


def judge(tx: dict | None, max_error_ms: int) -> dict:
    """The state, and what the kernel says the clock's error is."""
    if tx is None:
        return {"state": "unknown", "maxErrorMs": None, "estErrorMs": None, "source": "none"}
    out = {"maxErrorMs": round(tx["maxErrorUs"] / 1000), "estErrorMs": round(tx["estErrorUs"] / 1000), "source": "kernel"}
    if tx["status"] & STA_UNSYNC or tx["rc"] == TIME_ERROR:
        return {"state": "unsynced", **out}
    if tx["maxErrorUs"] > max_error_ms * 1000:
        return {"state": "drifting", **out}
    return {"state": "synced", **out}


def read(max_error_ms: int) -> dict:
    return judge(kernel_timex(), max_error_ms)
