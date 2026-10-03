/**
 * Putting a promotion back on the recorder's event after the recorder's sheet
 * is rebuilt.
 *
 * The console deletes the rows it published when an approved sheet is sent
 * back, and writes them fresh when it is approved again
 * (`admin-match-stats.service.ts`). A row Vision had enriched goes with the
 * rest: its stamp and its second are lost, and the candidate's link is nulled
 * by the foreign key. The candidate still says it was promoted (`promotedAt`),
 * so the service refuses to promote it again as if nothing had happened
 * (docs/vision/50, appendix B; docs/vision/55).
 *
 * When the sheet is approved again, each such candidate is put through the
 * same rule that promoted it: read on the clock it was accepted on, in the
 * recorder's minutes, against the rows as they now are. Where that names one
 * recorder event, the stamp goes back on it and the candidate is linked
 * again. Where it names none, or two, or the clock has been re-anchored since
 * the acceptance, the candidate is left stale on purpose: a person corrects
 * it, a second person reviews it against the record as it now stands.
 *
 * Only what was enriched is put back. A goal Vision *created* is not the
 * console's row and is not deleted by a rebuild.
 *
 * Plain functions over the database, like `linkMatchGoals`, so the recorder's
 * service does not import the Vision module to call them.
 */

import type { PrismaClient } from "@prisma/client";
import type { VisionEventPromotionV1, VisionEventType } from "@dtp/vision-contracts";
import { clockAt, sortAnchors, type ClockAnchor, type Half } from "../clock/match-clock";
import { recordedMinuteOf, recorderHalfLength, recorderMinuteAt } from "../clock/recorder-minute";
import { isEventType, matchRecorderEvent, scoreboardTypeOf, secondToWrite, type RecorderEvent } from "./event-taxonomy";

type Db = Pick<PrismaClient, "sbMatch" | "sbMatchEvent" | "visionEventCandidate" | "visionClockAnchor" | "$transaction">;

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

export async function reapplyEnrichment(db: Db, matchId: string): Promise<{ reapplied: string[]; stale: string[] }> {
  const reapplied: string[] = [];
  const stale: string[] = [];
  const waiting = await db.visionEventCandidate.findMany({
    where: { sbMatchId: matchId, supersededBy: null, reviewState: "accepted", promotionKind: "enriched", promotedAt: { not: null }, promotedEventId: null },
    orderBy: { promotedAt: "asc" },
  });
  if (!waiting.length) return { reapplied, stale };

  const match = await db.sbMatch.findUnique({ where: { id: matchId }, select: { competition: { select: { formatConfig: true } }, statisticsSheet: { select: { clock: true } } } });
  if (!match) return { reapplied, stale: waiting.map((c) => c.id) };
  const halfLength = recorderHalfLength(match.statisticsSheet?.clock, match.competition?.formatConfig);
  const rows = await db.sbMatchEvent.findMany({
    where: { matchId },
    select: { id: true, type: true, minute: true, teamId: true, playerId: true, metadata: true, secondInMinute: true, visionCandidate: { select: { id: true } } },
  });
  const taken = new Set(rows.filter((r) => r.visionCandidate).map((r) => r.id));
  const anchorsOf = new Map<string, { id: string; half: number; sourceMs: number; endMs: number | null }[]>();

  for (const candidate of waiting) {
    const scoreboardType = isEventType(candidate.type) ? scoreboardTypeOf(candidate.type) : null;
    let anchors = anchorsOf.get(candidate.videoAssetId);
    if (!anchors) {
      anchors = await db.visionClockAnchor.findMany({ where: { videoAssetId: candidate.videoAssetId, supersededBy: null }, select: { id: true, half: true, sourceMs: true, endMs: true } });
      anchorsOf.set(candidate.videoAssetId, anchors);
    }
    const clock: ClockAnchor[] = sortAnchors(anchors.map((a) => ({ half: a.half as Half, sourceMs: a.sourceMs, endMs: a.endMs })));
    const reading = clockAt(clock, candidate.startMs);
    // On the clock it was accepted on, or not at all: the same hold `promote` keeps.
    const anchor = reading.status === "on" ? anchors.find((a) => a.half === reading.half) : undefined;
    const at = reading.status === "on" ? recorderMinuteAt(reading, halfLength) : null;
    if (!scoreboardType || !anchor || anchor.id !== candidate.acceptedAnchorId || !at) {
      stale.push(candidate.id);
      continue;
    }
    const open: RecorderEvent[] = rows.filter((r) => !taken.has(r.id)).map((r) => ({ id: r.id, type: r.type, teamId: r.teamId, playerId: r.playerId, ...recordedMinuteOf(r, halfLength) }));
    const outcome = matchRecorderEvent({ scoreboardType, half: at.half, minute: at.minute, addedMinute: at.addedMinute, sbTeamId: candidate.sbTeamId, actorPlayerId: candidate.actorPlayerId }, open);
    if (outcome.kind !== "matched") {
      stale.push(candidate.id);
      continue;
    }
    const row = rows.find((r) => r.id === outcome.event.id)!;
    const stamp: VisionEventPromotionV1 = {
      contract: "VisionEventPromotionV1",
      candidateId: candidate.id,
      videoAssetId: candidate.videoAssetId,
      type: candidate.type as VisionEventType,
      taxonomyVersion: candidate.taxonomyVersion,
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      actorTrackId: candidate.actorTrackId,
      // When a publisher promoted it; putting it back is not a second promotion.
      promotedAt: candidate.promotedAt!.toISOString(),
    };
    const writeSecond = secondToWrite(at.second, outcome.sameMinute, row.secondInMinute ?? null);
    const linked = await db
      .$transaction(async (tx) => {
        // Only a candidate still waiting on its event: not corrected, not linked by someone else meanwhile.
        const claim = await tx.visionEventCandidate.updateMany({ where: { id: candidate.id, supersededBy: null, promotedEventId: null, promotedAt: { not: null } }, data: { promotedEventId: row.id } });
        if (claim.count !== 1) return false;
        await tx.sbMatchEvent.update({ where: { id: row.id }, data: { metadata: { ...record(row.metadata), vision: stamp } as never, ...(writeSecond !== null ? { secondInMinute: writeSecond } : {}) } });
        return true;
      })
      // The link is unique: a row another candidate took in the meantime refuses this one, which stays stale.
      .catch(() => false);
    if (linked) {
      taken.add(row.id);
      reapplied.push(candidate.id);
    } else {
      stale.push(candidate.id);
    }
  }
  return { reapplied, stale };
}
