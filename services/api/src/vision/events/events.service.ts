import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EVIDENCE_KINDS, VISION_EVENT_TAXONOMY_VERSION, type VisionEventPromotionV1, type VisionEventType } from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { VisionClockService } from "../clock/clock.service";
import { clockAt, type ClockAnchor } from "../clock/match-clock";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { isEventType, isPlay, matchRecorderEvent, scoreboardTypeOf, secondToWrite, windowProblem } from "./event-taxonomy";
import { buildQueue, type QueueIdentityRow } from "./review-queue";

/**
 * Event candidates: a person's (later, a model's) proposal that something
 * happened, filed with the evidence it rests on, reviewed by a second person,
 * and promoted into the recorder's match record only by a publisher's hand.
 *
 * Three rules hold throughout (docs/vision/02 D10, docs/vision/13 Q7,
 * docs/vision/09 § Replay):
 *
 *   - Nothing is edited. A correction is a new row superseding the old, and
 *     a corrected candidate is unreviewed again.
 *   - The recorder's `SbMatchEvent` is canonical. Promotion enriches a matching
 *     one; it creates one only where the recorder logged nothing, only for a
 *     type the recorder has, only with the team known, and only when the
 *     publisher said `create`.
 *   - A candidate inside a replay, intro or halftime segment is flagged and
 *     never promoted -- checked again at promotion against the segments as
 *     they are then, because a segment may be declared after the candidate.
 */

type EvidenceInput = { kind: string; targetId: string; note?: string | null };

export type ProposeInput = {
  videoAssetId: string;
  type: string;
  startMs: number;
  endMs: number;
  actorTrackId?: string | null;
  actorMatchSquadPlayerId?: string | null;
  sbTeamId?: string | null;
  confidence?: number;
  note?: string | null;
  evidence?: EvidenceInput[];
};

export type CorrectInput = Partial<Omit<ProposeInput, "videoAssetId">>;

/** Evidence the service attaches itself, from what it can see; a caller's links are added beside them. */
const AUTO_KINDS = new Set(["track", "camera_segment", "calibration", "identity", "clock_anchor"]);

@Injectable()
export class VisionEventsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionClockService) private readonly clock: VisionClockService
  ) {}

  // ── Proposing and correcting ─────────────────────────────────────────────

  async propose(input: ProposeInput, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "propose an event");
    const resolved = await this.resolve(input.videoAssetId, input);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visionEventCandidate.create({
        data: {
          videoAssetId: input.videoAssetId,
          sbMatchId: resolved.sbMatchId,
          type: resolved.type,
          taxonomyVersion: VISION_EVENT_TAXONOMY_VERSION,
          startMs: input.startMs,
          endMs: input.endMs,
          actorTrackId: resolved.actorTrackId,
          actorPlayerId: resolved.actorPlayerId,
          actorMatchSquadPlayerId: resolved.actorMatchSquadPlayerId,
          sbTeamId: resolved.sbTeamId,
          confidence: input.confidence ?? 1,
          method: "manual",
          cameraSegmentId: resolved.cameraSegmentId,
          inPlay: resolved.inPlay,
          decidedBy: person.userId,
          note: input.note ?? null,
        },
      });
      await tx.visionEvidenceLink.createMany({ data: resolved.evidence.map((e) => ({ candidateId: created.id, kind: e.kind, targetId: e.targetId, note: e.note ?? null })) });
      return created;
    });
    await this.audit.record(
      { action: "event.proposed", targetKind: "vision_event_candidate", targetId: row.id, data: { videoAssetId: input.videoAssetId, type: row.type, startMs: row.startMs, endMs: row.endMs, inPlay: row.inPlay, evidence: resolved.evidence.length } },
      actor
    );
    return this.get(row.id);
  }

  /** A correction: a new row with the changes, superseding the old; the review starts again. */
  async correct(candidateId: string, changes: CorrectInput, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "correct an event");
    const current = await this.loadCurrent(candidateId);
    this.refuseIfPromoted(current);
    const merged: ProposeInput = {
      videoAssetId: current.videoAssetId,
      type: changes.type ?? current.type,
      startMs: changes.startMs ?? current.startMs,
      endMs: changes.endMs ?? current.endMs,
      actorTrackId: changes.actorTrackId === undefined ? current.actorTrackId : changes.actorTrackId,
      actorMatchSquadPlayerId: changes.actorMatchSquadPlayerId === undefined ? current.actorMatchSquadPlayerId : changes.actorMatchSquadPlayerId,
      sbTeamId: changes.sbTeamId === undefined ? (current.actorMatchSquadPlayerId ? null : current.sbTeamId) : changes.sbTeamId,
      confidence: changes.confidence ?? current.confidence,
      note: changes.note === undefined ? current.note : changes.note,
      evidence: changes.evidence ?? current.evidence.filter((e) => !AUTO_KINDS.has(e.kind)).map((e) => ({ kind: e.kind, targetId: e.targetId, note: e.note })),
    };
    const resolved = await this.resolve(current.videoAssetId, merged);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visionEventCandidate.create({
        data: {
          videoAssetId: current.videoAssetId,
          sbMatchId: resolved.sbMatchId,
          type: resolved.type,
          taxonomyVersion: VISION_EVENT_TAXONOMY_VERSION,
          startMs: merged.startMs,
          endMs: merged.endMs,
          actorTrackId: resolved.actorTrackId,
          actorPlayerId: resolved.actorPlayerId,
          actorMatchSquadPlayerId: resolved.actorMatchSquadPlayerId,
          sbTeamId: resolved.sbTeamId,
          confidence: merged.confidence ?? 1,
          method: current.method,
          modelVersionId: current.modelVersionId,
          cameraSegmentId: resolved.cameraSegmentId,
          inPlay: resolved.inPlay,
          decidedBy: person.userId,
          note: merged.note ?? null,
        },
      });
      await tx.visionEvidenceLink.createMany({ data: resolved.evidence.map((e) => ({ candidateId: created.id, kind: e.kind, targetId: e.targetId, note: e.note ?? null })) });
      await tx.visionEventCandidate.update({ where: { id: current.id }, data: { supersededBy: created.id } });
      return created;
    });
    await this.audit.record({ action: "event.corrected", targetKind: "vision_event_candidate", targetId: row.id, data: { supersedes: current.id, changed: Object.keys(changes) } }, actor);
    return { ...(await this.get(row.id)), supersedes: current.id };
  }

  // ── Review ───────────────────────────────────────────────────────────────

  async decide(candidateId: string, decision: "accepted" | "rejected", reason: string | undefined, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "review an event");
    const current = await this.loadCurrent(candidateId);
    this.refuseIfPromoted(current);
    if (decision === "accepted" && current.decidedBy === person.userId) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "SelfAcceptanceRefused",
        message: "You cannot accept an event you proposed.",
        remediation: "A second person with vision.review accepts. That is the whole control before an event can reach the match record.",
      });
    }
    if (decision === "rejected" && !reason?.trim()) {
      throw new ConflictException({ statusCode: 409, error: "ReasonRequired", message: "A rejection says why.", remediation: "Give a reason: wrong window, wrong actor, not an event, a replay." });
    }
    await this.prisma.visionEventCandidate.update({ where: { id: current.id }, data: { reviewState: decision, reviewedBy: person.userId, reviewNote: reason?.trim() || null } });
    await this.audit.record(
      { action: decision === "accepted" ? "event.accepted" : "event.rejected", targetKind: "vision_event_candidate", targetId: current.id, reason: reason?.trim() || undefined },
      actor
    );
    return this.get(current.id);
  }

  // ── Promotion ────────────────────────────────────────────────────────────

  /**
   * Into the match record. Enriches the recorder event this is the same event
   * as; creates one only where none matches, the type is one the recorder has,
   * the team is known, and the publisher said so.
   */
  async promote(candidateId: string, opts: { create?: boolean }, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "promote an event");
    const current = await this.loadCurrent(candidateId);
    if (current.promotedEventId) {
      throw new ConflictException({ statusCode: 409, error: "AlreadyPromoted", message: `Candidate ${current.id} was promoted into event ${current.promotedEventId}.`, remediation: "Nothing to do." });
    }
    if (current.reviewState !== "accepted") {
      throw new ConflictException({ statusCode: 409, error: "NotAccepted", message: `Candidate ${current.id} is ${current.reviewState}.`, remediation: "A second person accepts it first." });
    }
    if (!current.sbMatchId) {
      throw new ConflictException({ statusCode: 409, error: "NoMatchLinked", message: "This footage is not linked to a match, so there is no match record to promote into.", remediation: "Link the asset to its match." });
    }
    const scoreboardType = isEventType(current.type) ? scoreboardTypeOf(current.type) : null;
    if (!scoreboardType) {
      throw new ConflictException({
        statusCode: 409,
        error: "NoScoreBoardType",
        message: `The match record has no event type for a ${current.type}.`,
        remediation: "It stays Vision evidence: accepted candidates are read by the metrics phase. Only a goal_candidate promotes today.",
      });
    }
    const segment = await this.segmentAt(current.videoAssetId, current.startMs);
    if (!isPlay(segment?.kind ?? null)) {
      if (current.inPlay) await this.prisma.visionEventCandidate.update({ where: { id: current.id }, data: { inPlay: false, cameraSegmentId: segment?.id ?? null } });
      throw new ConflictException({
        statusCode: 409,
        error: "NotInPlay",
        message: `The candidate sits inside a ${segment?.kind} segment; a replayed goal is not a second goal.`,
        remediation: "Propose the event where it happened in play, or correct the segment if it is wrong.",
      });
    }
    // With the actor: a player- or guardian-level withdrawal applies only when the
    // check names the player, and promotion is what names a minor in the match record
    // (docs/vision/50, PR-4).
    const rights = await this.rights.canPublishHighlight({
      videoAssetId: current.videoAssetId,
      ...(current.actorPlayerId ? { playerId: current.actorPlayerId } : {}),
    });
    if (!rights.allowed) {
      throw new ForbiddenException({ statusCode: 403, error: "PublicationRightsRefused", message: rights.reason, remediation: "Publication needs a rights scope that allows it." });
    }
    const anchors = await this.clock.currentAnchors(current.videoAssetId);
    const reading = clockAt(anchors, current.startMs);
    if (reading.status !== "on") {
      throw new ConflictException({
        statusCode: 409,
        error: "ClockNotAnchored",
        message: `The candidate's moment reads "${reading.display}" on the match clock; the match record is in match minutes.`,
        remediation: "Anchor the half's kick-off in the calibration editor first.",
      });
    }
    const minute = reading.minute;
    const second = reading.second;
    const recorded = await this.prisma.sbMatchEvent.findMany({
      where: { matchId: current.sbMatchId, type: scoreboardType },
      select: { id: true, type: true, minute: true, teamId: true, playerId: true },
    });
    const outcome = matchRecorderEvent({ scoreboardType, minute, sbTeamId: current.sbTeamId, actorPlayerId: current.actorPlayerId }, recorded);
    if (outcome.kind === "ambiguous") {
      throw new ConflictException({
        statusCode: 409,
        error: "AmbiguousRecorderEvent",
        message: `Two recorder events are equally near minute ${minute}: ${outcome.events.map((e) => `${e.id} (${e.minute}')`).join(", ")}.`,
        remediation: "Correct the candidate's actor or team so one of them is ruled out, or ask the recorder.",
      });
    }
    if (outcome.kind === "none" && !opts.create) {
      throw new ConflictException({
        statusCode: 409,
        error: "NoMatchingEvent",
        message: outcome.nearest ? `No ${scoreboardType} within a minute of ${minute}'; the nearest is at ${outcome.nearest.minute}'.` : `The recorder logged no ${scoreboardType} for this match.`,
        remediation: "If the recorder missed it, promote again with create: true to add it to the match record.",
        nearest: outcome.nearest,
      });
    }
    if (outcome.kind === "none" && !current.sbTeamId) {
      throw new ConflictException({ statusCode: 409, error: "TeamUnknown", message: `A ${scoreboardType} cannot be added to the match record without a team.`, remediation: "Correct the candidate with the roster slot or the team first." });
    }
    const stamp: VisionEventPromotionV1 = {
      contract: "VisionEventPromotionV1",
      candidateId: current.id,
      videoAssetId: current.videoAssetId,
      type: current.type as VisionEventType,
      taxonomyVersion: current.taxonomyVersion,
      startMs: current.startMs,
      endMs: current.endMs,
      actorTrackId: current.actorTrackId,
      promotedAt: new Date().toISOString(),
    };
    const result = await this.prisma.$transaction(async (tx) => {
      if (outcome.kind === "matched") {
        const existing = await tx.sbMatchEvent.findUnique({ where: { id: outcome.event.id }, select: { id: true, metadata: true, secondInMinute: true } });
        if (!existing) throw new NotFoundException(`Recorder event ${outcome.event.id} vanished`);
        const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? (existing.metadata as Record<string, unknown>) : {};
        /* The second lands beside the recorder's minute only when it is the same minute and the
           recorder gave none; the minute itself is the recorder's and is never rewritten. */
        const existingSecond = existing.secondInMinute ?? null;
        const writeSecond = secondToWrite(second, outcome.minutesApart, existingSecond);
        await tx.sbMatchEvent.update({
          where: { id: existing.id },
          data: { metadata: { ...metadata, vision: stamp } as never, ...(writeSecond !== null ? { secondInMinute: writeSecond } : {}) },
        });
        await tx.visionEventCandidate.update({ where: { id: current.id }, data: { promotedEventId: existing.id, promotionKind: "enriched", promotedBy: person.userId, promotedAt: new Date() } });
        return { kind: "enriched" as const, eventId: existing.id, minute: outcome.event.minute, second: writeSecond ?? existingSecond, minutesApart: outcome.minutesApart };
      }
      const slot = current.actorMatchSquadPlayerId ? await tx.sbMatchSquadPlayer.findUnique({ where: { id: current.actorMatchSquadPlayerId }, select: { playerName: true } }) : null;
      const created = await tx.sbMatchEvent.create({
        data: {
          matchId: current.sbMatchId!,
          teamId: current.sbTeamId,
          playerId: current.actorPlayerId,
          playerLabel: slot?.playerName ?? null,
          type: scoreboardType,
          minute,
          secondInMinute: second,
          detail: "Added from video evidence",
          metadata: { vision: stamp } as never,
        },
      });
      await tx.visionEventCandidate.update({ where: { id: current.id }, data: { promotedEventId: created.id, promotionKind: "created", promotedBy: person.userId, promotedAt: new Date() } });
      return { kind: "created" as const, eventId: created.id, minute, second, minutesApart: 0 };
    });
    await this.audit.record({ action: "event.promoted", targetKind: "vision_event_candidate", targetId: current.id, data: { ...result, scoreboardType } }, actor);
    return { ...(await this.get(current.id)), promotion: result };
  }

  // ── The queue ────────────────────────────────────────────────────────────

  /**
   * What this person should look at next: every current, undecided identity
   * and event candidate that is not their own, oldest first, with the words a
   * list needs -- the footage, the match clock, the roster slot named.
   */
  async queue(opts: { assetId?: string; limit?: number }, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "read the review queue");
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? 100), 1), 500);
    const assetFilter = opts.assetId ? { videoAssetId: opts.assetId } : {};
    const [events, identities] = await Promise.all([
      this.prisma.visionEventCandidate.findMany({
        where: { supersededBy: null, reviewState: "unreviewed", ...assetFilter },
        orderBy: { createdAt: "asc" },
        select: { id: true, videoAssetId: true, type: true, startMs: true, endMs: true, actorTrackId: true, decidedBy: true, createdAt: true },
      }),
      this.prisma.visionIdentityAssignment.findMany({
        where: { supersededBy: null, reviewState: "unreviewed", track: assetFilter },
        orderBy: { createdAt: "asc" },
        select: { id: true, trackId: true, matchSquadPlayerId: true, validFromMs: true, validToMs: true, decidedBy: true, createdAt: true, track: { select: { localTrackId: true, videoAssetId: true } } },
      }),
    ]);
    const identityRows: QueueIdentityRow[] = identities.map(({ track, ...a }) => ({ ...a, videoAssetId: track.videoAssetId, localTrackId: track.localTrackId }));
    const built = buildQueue(person.userId, events, identityRows, limit);

    const assetIds = [...new Set(built.items.map((i) => i.videoAssetId))];
    const slotIds = [...new Set(built.items.flatMap((i) => (i.kind === "identity" && i.matchSquadPlayerId ? [i.matchSquadPlayerId] : [])))];
    const [assets, slots, anchorsByAsset] = await Promise.all([
      assetIds.length
        ? this.prisma.visionVideoAsset.findMany({
            where: { id: { in: assetIds } },
            select: { id: true, sbMatchId: true, sourceVideoRecord: { select: { title: true } }, sbMatch: { select: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } } },
          })
        : [],
      slotIds.length ? this.prisma.sbMatchSquadPlayer.findMany({ where: { id: { in: slotIds } }, select: { id: true, playerName: true, jerseyNumber: true } }) : [],
      Promise.all(assetIds.map(async (id) => [id, await this.clock.currentAnchors(id)] as const)),
    ]);
    const assetOf = new Map(assets.map((a) => [a.id, { title: a.sourceVideoRecord?.title ?? null, match: a.sbMatch ? `${a.sbMatch.homeTeam.name} v ${a.sbMatch.awayTeam.name}` : null }]));
    const slotOf = new Map(slots.map((s) => [s.id, { name: s.playerName, jerseyNumber: s.jerseyNumber }]));
    const anchorsOf = new Map<string, ClockAnchor[]>(anchorsByAsset);
    return {
      me: person.userId,
      waiting: built.waiting,
      count: built.items.length,
      items: built.items.map((i) => {
        const anchors = anchorsOf.get(i.videoAssetId) ?? [];
        return {
          ...i,
          asset: assetOf.get(i.videoAssetId) ?? { title: null, match: null },
          matchClock: anchors.length ? clockAt(anchors, i.sourceMs).display : null,
          slot: i.kind === "identity" && i.matchSquadPlayerId ? (slotOf.get(i.matchSquadPlayerId) ?? null) : null,
        };
      }),
    };
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  async forAsset(videoAssetId: string, includeSuperseded = false) {
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { id: true, sbMatchId: true } });
    if (!asset) throw new NotFoundException(`Unknown video asset ${videoAssetId}`);
    const [rows, anchors] = await Promise.all([
      this.prisma.visionEventCandidate.findMany({
        where: { videoAssetId, ...(includeSuperseded ? {} : { supersededBy: null }) },
        orderBy: [{ startMs: "asc" }, { createdAt: "asc" }],
        include: { evidence: { orderBy: { createdAt: "asc" } } },
      }),
      this.clock.currentAnchors(videoAssetId),
    ]);
    return {
      videoAssetId,
      matchId: asset.sbMatchId,
      taxonomyVersion: VISION_EVENT_TAXONOMY_VERSION,
      clock: { anchored: anchors.length > 0 },
      candidates: rows.map((r) => this.view(r, anchors)),
      count: rows.length,
    };
  }

  async get(candidateId: string) {
    const row = await this.prisma.visionEventCandidate.findUnique({ where: { id: candidateId }, include: { evidence: { orderBy: { createdAt: "asc" } } } });
    if (!row) throw new NotFoundException(`Unknown event candidate ${candidateId}`);
    const anchors = await this.clock.currentAnchors(row.videoAssetId);
    return this.view(row, anchors);
  }

  private view(row: CandidateRow, anchors: ClockAnchor[]) {
    const scoreboardType = isEventType(row.type) ? scoreboardTypeOf(row.type) : null;
    return {
      ...row,
      matchClock: anchors.length ? clockAt(anchors, row.startMs).display : null,
      scoreboardType,
      promotable: scoreboardType !== null,
      evidence: row.evidence.map((e) => ({ id: e.id, kind: e.kind, targetId: e.targetId, note: e.note })),
    };
  }

  // ── Resolution ───────────────────────────────────────────────────────────

  private async resolve(videoAssetId: string, input: ProposeInput) {
    const asset = await this.prisma.visionVideoAsset.findUnique({ where: { id: videoAssetId }, select: { id: true, durationMs: true, sbMatchId: true } });
    if (!asset) throw new NotFoundException(`Unknown video asset ${videoAssetId}`);
    if (!isEventType(input.type)) {
      throw new ConflictException({ statusCode: 409, error: "UnknownEventType", message: `"${input.type}" is not in taxonomy ${VISION_EVENT_TAXONOMY_VERSION}.`, remediation: "Use one of the taxonomy's types." });
    }
    const problem = windowProblem(input.startMs, input.endMs, asset.durationMs);
    if (problem) throw new ConflictException({ statusCode: 409, error: "EventOutsideAsset", message: problem, remediation: "The window is in source milliseconds, inside the footage." });

    let actorTrackId: string | null = null;
    if (input.actorTrackId) {
      const track = await this.prisma.visionTrack.findUnique({ where: { id: input.actorTrackId }, select: { id: true, videoAssetId: true } });
      if (!track || track.videoAssetId !== videoAssetId) {
        throw new ConflictException({ statusCode: 409, error: "ActorNotOnThisAsset", message: `Track ${input.actorTrackId} is not a track of this footage.`, remediation: "Name a track from this asset." });
      }
      actorTrackId = track.id;
    }

    let actorMatchSquadPlayerId: string | null = null;
    let actorPlayerId: string | null = null;
    let sbTeamId: string | null = null;
    if (input.actorMatchSquadPlayerId) {
      const slot = await this.prisma.sbMatchSquadPlayer.findUnique({ where: { id: input.actorMatchSquadPlayerId }, select: { id: true, matchId: true, teamId: true, playerId: true } });
      if (!slot || !asset.sbMatchId || slot.matchId !== asset.sbMatchId) {
        throw new ConflictException({ statusCode: 409, error: "NotOnThisMatchSquad", message: `Slot ${input.actorMatchSquadPlayerId} is not on this match's squads.`, remediation: "Name a slot from the match the footage is linked to." });
      }
      actorMatchSquadPlayerId = slot.id;
      actorPlayerId = slot.playerId;
      sbTeamId = slot.teamId;
    } else if (input.sbTeamId) {
      const match = asset.sbMatchId ? await this.prisma.sbMatch.findUnique({ where: { id: asset.sbMatchId }, select: { homeTeamId: true, awayTeamId: true } }) : null;
      if (!match || (match.homeTeamId !== input.sbTeamId && match.awayTeamId !== input.sbTeamId)) {
        throw new ConflictException({ statusCode: 409, error: "TeamNotInThisMatch", message: `Team ${input.sbTeamId} is not playing in this match.`, remediation: "Name the home or away team." });
      }
      sbTeamId = input.sbTeamId;
    }

    const segment = await this.segmentAt(videoAssetId, input.startMs);
    const evidence = new Map<string, EvidenceInput>();
    const add = (e: EvidenceInput) => evidence.set(`${e.kind}:${e.targetId}`, e);
    if (actorTrackId) {
      add({ kind: "track", targetId: actorTrackId, note: "the actor" });
      const identity = await this.prisma.visionIdentityAssignment.findFirst({
        where: { trackId: actorTrackId, supersededBy: null, validFromMs: { lte: input.startMs }, validToMs: { gte: input.startMs } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (identity) add({ kind: "identity", targetId: identity.id, note: "who the actor was said to be at that moment" });
    }
    if (segment) {
      add({ kind: "camera_segment", targetId: segment.id, note: `${segment.kind} segment covering the start` });
      if (segment.calibrationId) add({ kind: "calibration", targetId: segment.calibrationId, note: "the segment's current calibration" });
    }
    const anchors = await this.clock.currentAnchors(videoAssetId);
    const reading = clockAt(anchors, input.startMs);
    if (reading.status === "on") {
      const anchor = await this.prisma.visionClockAnchor.findFirst({ where: { videoAssetId, half: reading.half, supersededBy: null }, select: { id: true } });
      if (anchor) add({ kind: "clock_anchor", targetId: anchor.id, note: "the half's kick-off" });
    }
    for (const e of input.evidence ?? []) {
      if (!(EVIDENCE_KINDS as readonly string[]).includes(e.kind)) {
        throw new ConflictException({ statusCode: 409, error: "UnknownEvidenceKind", message: `"${e.kind}" is not an evidence kind.`, remediation: `One of ${EVIDENCE_KINDS.join(", ")}.` });
      }
      add(e);
    }

    return {
      type: input.type as VisionEventType,
      sbMatchId: asset.sbMatchId,
      actorTrackId,
      actorMatchSquadPlayerId,
      actorPlayerId,
      sbTeamId,
      cameraSegmentId: segment?.id ?? null,
      inPlay: isPlay(segment?.kind ?? null),
      evidence: [...evidence.values()],
    };
  }

  /** The camera segment covering a millisecond, with its current calibration's id. Segments never overlap. */
  private async segmentAt(videoAssetId: string, sourceMs: number): Promise<{ id: string; kind: string; calibrationId: string | null } | null> {
    const segment = await this.prisma.visionCameraSegment.findFirst({
      where: { videoAssetId, startMs: { lte: sourceMs }, endMs: { gte: sourceMs } },
      orderBy: { startMs: "asc" },
      select: { id: true, kind: true, calibrations: { where: { supersededBy: null }, take: 1, select: { id: true } } },
    });
    if (!segment) return null;
    return { id: segment.id, kind: segment.kind, calibrationId: segment.calibrations[0]?.id ?? null };
  }

  private async loadCurrent(candidateId: string) {
    const row = await this.prisma.visionEventCandidate.findUnique({ where: { id: candidateId }, include: { evidence: true } });
    if (!row) throw new NotFoundException(`Unknown event candidate ${candidateId}`);
    if (row.supersededBy) {
      throw new ConflictException({ statusCode: 409, error: "EventSuperseded", message: `Candidate ${candidateId} was superseded by ${row.supersededBy}.`, remediation: "Act on the current candidate instead." });
    }
    return row;
  }

  private refuseIfPromoted(row: { id: string; promotedEventId: string | null }) {
    if (row.promotedEventId) {
      throw new ConflictException({
        statusCode: 409,
        error: "EventPromoted",
        message: `Candidate ${row.id} is in the match record as event ${row.promotedEventId}.`,
        remediation: "A promoted candidate is not corrected or re-reviewed here; correcting what the public saw is the staleness work of Phase 7.",
      });
    }
  }
}

type CandidateRow = {
  id: string;
  videoAssetId: string;
  sbMatchId: string | null;
  type: string;
  taxonomyVersion: string;
  startMs: number;
  endMs: number;
  actorTrackId: string | null;
  actorPlayerId: string | null;
  actorMatchSquadPlayerId: string | null;
  sbTeamId: string | null;
  confidence: number;
  method: string;
  modelVersionId: string | null;
  cameraSegmentId: string | null;
  inPlay: boolean;
  reviewState: string;
  decidedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  note: string | null;
  promotedEventId: string | null;
  promotionKind: string | null;
  promotedBy: string | null;
  promotedAt: Date | null;
  supersededBy: string | null;
  createdAt: Date;
  evidence: { id: string; kind: string; targetId: string; note: string | null }[];
};

function requirePerson(actor: AdminAuthContext | undefined, what: string): { userId: string } {
  if (!actor?.userId) {
    throw new ForbiddenException({
      statusCode: 403,
      error: "EventNeedsAPerson",
      message: `Only a signed-in person may ${what}.`,
      detail: "An event is a claim about what happened with a name on it; the shared operator key has none.",
      remediation: "Sign in as yourself.",
    });
  }
  return { userId: actor.userId };
}
