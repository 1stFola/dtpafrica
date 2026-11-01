"""What a match costs in disk and money (Phase 6.6; docs/fairplay/cost-worksheet.md).

Arithmetic only: it reads no recording and changes nothing. Bitrates come from `fairplay-edge
measure` or are typed in, and everything else is an assumption the output names, because
no real match has been measured. A result is called a venue figure only when its operator says so.
Sizes are decimal GB, as `measure` reports them.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

# As services/api/src/fairplay/fairplay.config.ts; a test holds the two together.
PRICES = {"storagePerGbMonth": 0.015, "classAPerMillion": 4.5, "classBPerMillion": 0.36}
PRICES_CHECKED = "2026-11-01"
REPLAY_CACHE_GB = 2 * 1024**3 / 1e9  # api.REPLAY_CACHE_BYTES


class WorksheetError(ValueError):
    pass


@dataclass(frozen=True)
class Assumptions:
    hours_per_match: float = 3.0  # cameras on 60 minutes before kick-off, to some time after full time
    matches_per_month: float = 10  # as Phase 4's estimate
    matches_in_retention: int | None = None  # the most inside one retention period; None spreads the month evenly
    incidents_per_match: float = 10  # as Phase 4's estimate
    clip_seconds: float = 30  # the default pre-roll and post-roll
    retention_days: int = 14  # D9
    r2_days: int = 90  # D10
    edge_evidence_months: float = 18  # D10: end of season + 12 months, for a season assumed to be 6 months
    segment_minutes: float = 5  # FAIRPLAY_RECORD_SEGMENT_DURATION
    soft_free_gb: float = 20  # FAIRPLAY_DISK_SOFT_FREE_GB


def rates_from_report(report: dict) -> dict[str, float]:
    """Each camera's rate from `fairplay-edge measure`'s JSON."""
    if not isinstance(report, dict) or not isinstance(report.get("sources"), list):
        raise WorksheetError("that is not the output of `fairplay-edge measure`")
    rates = {s["source"]: s["mbitPerSecond"] for s in report["sources"] if s.get("mbitPerSecond")}
    if not rates:
        raise WorksheetError("that report holds no camera with a measured bitrate")
    return rates


def parse_rate(text: str) -> tuple[str, float]:
    name, _, value = text.partition("=")
    try:
        rate = float(value)
    except ValueError:
        rate = 0.0
    if not name or not math.isfinite(rate) or rate <= 0:
        raise WorksheetError(f"--mbit takes camera=rate with a rate above 0, not {text!r}")
    return name, rate


def work_out(rates: dict[str, float], a: Assumptions = Assumptions(), *, measured_at_venue: bool = False) -> dict:
    numbers = {k: v for k, v in asdict(a).items() if v is not None}
    if not rates or any(v <= 0 for v in rates.values()) or any(v <= 0 for k, v in numbers.items() if k != "soft_free_gb") or a.soft_free_gb < 0:
        raise WorksheetError("every rate and assumption must be above 0")
    mbit = sum(rates.values())

    def gb(seconds: float) -> float:
        return seconds * mbit / 8 / 1000

    recording = gb(a.hours_per_match * 3600)
    clips = gb(a.incidents_per_match * a.clip_seconds)
    # An incident's hold covers every camera and whole segments. A window straddles two segments
    # in clip_seconds / segment_seconds of cases. Counted apart: never more than the recording.
    segment = a.segment_minutes * 60
    kept = min(recording, gb(a.incidents_per_match * (segment + a.clip_seconds)))
    in_retention = a.matches_in_retention or math.ceil(a.matches_per_month * a.retention_days / 30)

    r2_months = a.r2_days / 30
    held_in_r2 = clips * a.matches_per_month * r2_months
    uploads = len(rates) * a.incidents_per_match * a.matches_per_month
    class_a, class_b = uploads * 2, uploads * 2  # generously, as the usage panel counts, with one read per clip
    storage_usd = held_in_r2 * PRICES["storagePerGbMonth"]
    ops_usd = class_a / 1e6 * PRICES["classAPerMillion"] + class_b / 1e6 * PRICES["classBPerMillion"]

    evidence = clips * a.matches_per_month * a.edge_evidence_months
    kept_total = kept * a.matches_per_month * a.edge_evidence_months
    base = recording * in_retention + evidence + REPLAY_CACHE_GB + a.soft_free_gb
    return {
        "bitrates": {"cameras": rates, "allCamerasMbit": round(mbit, 2),
                     "kind": "measured at the venue" if measured_at_venue else "NOT A VENUE FIGURE: synthetic, typed or unstated"},
        "assumptions": asdict(a) | {"matches_in_retention": in_retention},
        "perMatch": {"recordingGb": round(recording, 2), "clipsGb": round(clips, 3), "uploadGb": round(clips, 3),
                     "keptPastRetentionGb": round(kept, 2), "keptSharePercent": round(kept * 100 / recording, 1)},
        "edgeDisk": {"recordingsInRetentionGb": round(recording * in_retention, 1), "clipsGb": round(evidence, 1),
                     "replayCacheGb": round(REPLAY_CACHE_GB, 1), "softLimitGb": a.soft_free_gb,
                     "keptPastRetentionGb": round(kept_total, 1), "keptGrowthGbPerMonth": round(kept * a.matches_per_month, 1),
                     "neededIfHoldsEndGb": round(base, 1), "neededAsBuiltGb": round(base + kept_total, 1),
                     "sustainedWriteMBps": round(mbit / 8, 2), "sustainedWriteTargetMBps": round(3 * mbit / 8, 2)},
        "backup": {"gbAfterTheseMonths": round(evidence, 1), "note": "clips and the record; recordings are not in a backup"},
        "r2": {"gbHeldAtSteadyState": round(held_in_r2, 2), "classAPerMonth": round(class_a), "classBPerMonth": round(class_b),
               "storageUsdPerMonth": round(storage_usd, 3), "operationsUsdPerMonth": round(ops_usd, 3),
               "totalUsdPerMonth": round(storage_usd + ops_usd, 3), "pricesUsd": PRICES, "pricesChecked": PRICES_CHECKED,
               "note": "gross, before R2's account-wide free allowance, which Vision's buckets share; only approved clips upload, so this is an upper bound"},
        "ifFullMatchesWentToR2": {"built": False, "usdPerMonth": round(recording * a.matches_per_month * r2_months * PRICES["storagePerGbMonth"], 2)},
    }


def render(out: dict) -> str:
    a, match, disk, r2 = out["assumptions"], out["perMatch"], out["edgeDisk"], out["r2"]
    cameras = ", ".join(f"{name} {rate}" for name, rate in out["bitrates"]["cameras"].items())
    return "\n".join([
        "FAIRPLAY COST WORKSHEET",
        f"Bitrates ({out['bitrates']['kind']}): {cameras}; all cameras {out['bitrates']['allCamerasMbit']} Mbit/s",
        f"Assumed: {a['hours_per_match']} h a match; {a['matches_per_month']} matches a month, at most {a['matches_in_retention']} in "
        f"{a['retention_days']} days; {a['incidents_per_match']} incidents a match, {a['clip_seconds']} s clips from every camera; "
        f"clips on the Edge {a['edge_evidence_months']} months, in R2 {a['r2_days']} days",
        "",
        "One match",
        f"  recordings                        {match['recordingGb']} GB",
        f"  clips (also the upload)           {match['clipsGb']} GB",
        f"  kept past retention, as built     {match['keptPastRetentionGb']} GB ({match['keptSharePercent']}% of the recording)",
        "",
        "The Edge's disk",
        f"  recordings inside retention       {disk['recordingsInRetentionGb']} GB",
        f"  clips                             {disk['clipsGb']} GB",
        f"  replay cache, at most             {disk['replayCacheGb']} GB",
        f"  free space to keep                {disk['softLimitGb']} GB",
        f"  NEEDED, if incident holds end     {disk['neededIfHoldsEndGb']} GB",
        f"  footage kept, as built            {disk['keptPastRetentionGb']} GB, growing {disk['keptGrowthGbPerMonth']} GB a month with no end",
        f"  NEEDED, as built                  {disk['neededAsBuiltGb']} GB",
        f"  sustained write: all cameras {disk['sustainedWriteMBps']} MB/s; target at 3x {disk['sustainedWriteTargetMBps']} MB/s",
        "",
        f"Backup disk: at least {out['backup']['gbAfterTheseMonths']} GB ({out['backup']['note']})",
        "",
        f"R2, a month (gross, prices checked {r2['pricesChecked']})",
        f"  {r2['gbHeldAtSteadyState']} GB held: ${r2['storageUsdPerMonth']}; {r2['classAPerMonth']} class A and {r2['classBPerMonth']} class B: ${r2['operationsUsdPerMonth']}",
        f"  total ${r2['totalUsdPerMonth']}. {r2['note']}",
        f"Full matches in R2 are not built. If they were, these would cost ${out['ifFullMatchesWentToR2']['usdPerMonth']} a month.",
        "",
    ])
