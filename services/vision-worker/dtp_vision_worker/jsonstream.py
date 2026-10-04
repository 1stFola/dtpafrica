"""Reading one large JSON artifact without holding it.

A detect artifact for a ninety-minute match is a single JSON object whose
`frames` array has a hundred and forty thousand elements; a track artifact is the
same shape under `tracks`. `json.load` turns either into millions of small
objects -- several gigabytes on a worker class that has eight (docs/vision/50,
appendix C). Each element on its own is small, so this walks the top-level
object and hands the elements of one named array over one at a time, and the
other top-level values whole.

The standard library's decoder does the parsing (`raw_decode`), on a buffer
that is refilled as it is consumed. No dependency, so nothing for the licence
register.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

_WHITESPACE = " \t\r\n"
_AFTER_VALUE = _WHITESPACE + ",]}:"
_READ = 1 << 20


class JsonStreamError(ValueError):
    """The file is not the JSON object this module reads."""


class _Reader:
    def __init__(self, path: Path) -> None:
        self._handle = path.open("r", encoding="utf-8")
        self._decoder = json.JSONDecoder()
        self._buffer = ""
        self._pos = 0
        self._eof = False
        self._read_size = _READ

    def close(self) -> None:
        self._handle.close()

    def _fill(self) -> bool:
        """Read more. False once the file is exhausted."""
        if self._eof:
            return False
        more = self._handle.read(self._read_size)
        if not more:
            self._eof = True
            return False
        # Drop what has been consumed, so the buffer holds one value's worth and not the file.
        self._buffer = self._buffer[self._pos :] + more
        self._pos = 0
        return True

    def _skip_whitespace(self) -> None:
        while True:
            while self._pos < len(self._buffer) and self._buffer[self._pos] in _WHITESPACE:
                self._pos += 1
            if self._pos < len(self._buffer) or not self._fill():
                return

    def peek(self) -> str:
        """The next character that is not whitespace, or '' at the end of the file."""
        self._skip_whitespace()
        return self._buffer[self._pos] if self._pos < len(self._buffer) else ""

    def take(self, expected: str) -> None:
        got = self.peek()
        if got != expected:
            raise JsonStreamError(f"expected {expected!r}, found {got!r}")
        self._pos += 1

    def value(self) -> Any:
        """Decode one whole value at the cursor, reading as much more of the file as it needs."""
        self._skip_whitespace()
        while True:
            try:
                decoded, end = self._decoder.raw_decode(self._buffer, self._pos)
            except json.JSONDecodeError as exc:
                # Cut off by the end of the buffer, unless the file has ended too.
                self._read_size = min(self._read_size * 2, 1 << 26)
                if not self._fill():
                    raise JsonStreamError(f"invalid JSON: {exc.msg}") from exc
                continue
            # A number that runs to the end of the buffer may be cut short: "12" of "123", or
            # "1.25" of "1.25e-05" with the "e" already read. Only what may follow a value --
            # whitespace, a comma, a closing bracket -- or the file's end says it is whole.
            if (end == len(self._buffer) or self._buffer[end] not in _AFTER_VALUE) and self._fill():
                continue
            self._pos = end
            self._read_size = _READ
            return decoded


def scan(path: Path, array_key: str) -> Iterator[tuple[str, Any]]:
    """Walk a JSON object in file order.

    Yields `("item", element)` for each element of the top-level array `array_key`,
    and `("field", (key, value))` for every other top-level key. Raises
    `JsonStreamError` when the file is not a JSON object, or `array_key` is there and
    is not an array.
    """
    reader = _Reader(path)
    try:
        reader.take("{")
        if reader.peek() == "}":
            reader.take("}")
            return
        while True:
            key = reader.value()
            if not isinstance(key, str):
                raise JsonStreamError("expected a key")
            reader.take(":")
            if key == array_key:
                if reader.peek() == "n":  # null: an artifact that names the key and has nothing under it
                    reader.value()
                else:
                    reader.take("[")
                    if reader.peek() == "]":
                        reader.take("]")
                    else:
                        while True:
                            yield "item", reader.value()
                            if reader.peek() == ",":
                                reader.take(",")
                                continue
                            reader.take("]")
                            break
            else:
                yield "field", (key, reader.value())
            if reader.peek() == ",":
                reader.take(",")
                continue
            reader.take("}")
            break
        if reader.peek() != "":
            raise JsonStreamError("content after the object")
    finally:
        reader.close()


def fields(path: Path, array_key: str) -> dict[str, Any]:
    """Every top-level value except the array, wherever in the file it sits.

    A whole pass over the file, with the array's elements decoded and dropped one
    at a time: slower than a seek and flat in memory, and it does not depend on the
    writer having put the small keys first.
    """
    out: dict[str, Any] = {}
    for kind, payload in scan(path, array_key):
        if kind == "field":
            out[payload[0]] = payload[1]
    return out


def items(path: Path, array_key: str) -> Iterator[Any]:
    """The elements of the top-level array `array_key`, one at a time."""
    for kind, payload in scan(path, array_key):
        if kind == "item":
            yield payload
