"""Comparing JSON evidence that has been through the control plane's database.

A float written with 17 significant digits can come back from the job row with 16, a
unit in the last place away (51/3615 = 0.014107883817427386 in an artifact,
0.01410788381742739 in the queued params; docs/vision/97). Bytes are pinned by
checksum; parsed evidence is compared by value, with numbers equal to the last few
digits and everything else exact.
"""
import math
from typing import Any

RELATIVE_TOLERANCE = 1e-12


def same_evidence(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if a == b:
            return True
        return math.isfinite(a) and math.isfinite(b) and abs(a - b) <= RELATIVE_TOLERANCE * max(abs(a), abs(b))
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same_evidence(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same_evidence(a[k], b[k]) for k in a)
    return type(a) is type(b) and a == b
