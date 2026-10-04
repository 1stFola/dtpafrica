import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { VisionClockService } from "../clock/clock.service";
import { clockAt, onPitchFor, parseSubstitution, windowOnClock, type OnPitch, type Substitution } from "../clock/match-clock";
import { recordedMinuteOf, recorderHalfLength, timelineOfReading, timelineSpanOfRecorded } from "../clock/recorder-minute";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";

/**
 * Who a track is: roster-assisted, time-aware, and never a machine's word.
 *
 * docs/vision/09-ML-PIPELINE.md builds identity from evidence in order -- team,
 * jersey, roster, time, then a person. Jersey reading is not here yet (no digit
 * model is licensed), so what the machine contributes is the side a track is on,
 * and what this service does with it is narrow the roster: a track on side A may
 * only be someone in side A's match squad. A person picks from that list, or says
 * *unknown*, and a second person accepts before anything is attributed in public.
 *
 * Time-awareness is the window on a track. A track may carry two people in turn
 * (a split: two windows), and one person may span several tracks (a merge:
 * `propagated` rows). A new assignment supersedes every current one its window
 * overlaps; nothing is edited. What is *not* time-aware yet is the roster itself:
 * substitutions are recorded against the match clock and the footage has no
 * anchor to it, so the candidate list is the whole match squad, starters marked.
 *
 * These are mostly minors. Nothing here pressures a null toward a guess.
 */

export type TeamLabel = "A" | "B";

export type RosterCandidate = {
  matchSquadPlayerId: string;
  playerId: string | null;
  name: string;
  jerseyNumber: number | null;
  position: string | null;
  isStarter: boolean;
  sbTeamId: string;
  sbTeamSquadId: string | null;
  /** Whether the slot was on the pitch for the track's window, once the clock is anchored. */
  onPitch: OnPitch | null;
};

export type AssignIdentityInput = {
  /** A roster slot of this match, or null for *unknown*. */
  matchSquadPlayerId: string | null;
  validFromMs?: number;
  validToMs?: number;
  note?: string;
  /** Other tracks of the same asset this person also is: a merge. */
  propagateTo?: string[];
  /** The slot's team is not the track's side: say so, and the side is marked corrected. */
  acceptSideMismatch?: boolean;
};

/** A 90-minute match at 25fps is far more than this; see `positions`. */
const MAX_ARTIFACT_BYTES = 32 * 1_048_576;
const ARTIFACT_CACHE_ENTRIES = 4;

type ParsedArtifact = { trackerVersionId?: string; tracks: { localTrackId: number; positions: unknown[] }[] };

const CLOCK_NOTE =
  "The match clock is not anchored to the footage, so substitutions are not applied; the whole match squad is listed, starters marked.";
const CLOCK_APPLIED = "The match clock is anchored; substitutions are applied, and only players on the pitch for the track's window are listed, those crossing a change marked partly.";

@Injectable()
export class VisionIdentityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig,
    @Inject(VisionClockService) private readonly clock: VisionClockService
  ) {}

  // ── Sides ────────────────────────────────────────────────────────────────

  /**
   * Which of the match's two teams cluster A is, and which B. One decision per
   * identify job, both sides at once, by a person.
   */
  async setSides(inferenceJobId: string, sides: { A: string; B: string }, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "decide which team a side is");
    const job = await this.prisma.visionJob.findUnique({
      where: { id: inferenceJobId },
      select: { id: true, type: true, state: true, videoAsset: { select: { id: true, sbMatchId: true } } },
    });
    if (!job) throw new NotFoundException(`Unknown job ${inferenceJobId}`);
    if (job.type !== "identify" || job.state !== "succeeded") {
      throw new ConflictException({
        statusCode: 409,
        error: "NotAnIdentifyJob",
        message: `Job ${inferenceJobId} is a ${job.state} ${job.type} job; sides belong to a succeeded identify job.`,
        remediation: "Name the identify job whose clusters you are labelling.",
      });
    }
    const match = await this.matchOf(job.videoAsset?.sbMatchId ?? null);
    const teams = new Set([match.homeTeamId, match.awayTeamId]);
    if (sides.A === sides.B) {
      throw new ConflictException({
        statusCode: 409,
        error: "SidesSame",
        message: "Both sides name the same team.",
        remediation: "A and B are the two teams of the match, one each.",
      });
    }
    if (!teams.has(sides.A) || !teams.has(sides.B)) {
      throw new ConflictException({
        statusCode: 409,
        error: "SidesNotTheMatch",
        message: `The match is ${match.homeTeamId} v ${match.awayTeamId}; a side must be one of those.`,
        remediation: "Use the match's own team ids.",
      });
    }

    const rows = await this.prisma.$transaction(
      (["A", "B"] as const).map((team) =>
        this.prisma.visionTeamSide.upsert({
          where: { inferenceJobId_team: { inferenceJobId, team } },
          create: { inferenceJobId, team, sbTeamId: sides[team], decidedBy: person.userId },
          update: { sbTeamId: sides[team], decidedBy: person.userId },
        })
      )
    );
    await this.audit.record(
      { action: "identity.sides.decided", targetKind: "vision_job", targetId: inferenceJobId, data: { A: sides.A, B: sides.B } },
      actor
    );
    return { inferenceJobId, sides: Object.fromEntries(rows.map((r) => [r.team, r.sbTeamId])), decidedBy: person.userId };
  }

  // ── Candidates ───────────────────────────────────────────────────────────

  /**
   * Who a track could be: the match squad, narrowed to the track's side when a
   * person has said which team that side is and the kit clustering named one,
   * and -- once the match clock is anchored to the footage -- to the players who
   * were on the pitch for the track's window, substitutions applied from the
   * match record. A player taken off before the window, or brought on after it,
   * is not listed; one whose change falls inside the window is listed as
   * `partly`. `wholeMatch` lifts the side narrowing (not the clock's), for a
   * reviewer about to say the kit was read wrongly.
   */
  async candidates(trackId: string, wholeMatch = false) {
    const track = await this.loadTrack(trackId);
    const side = await this.sideOf(track);
    const match = await this.matchOf(track.videoAsset.sbMatchId);
    const narrowTo = wholeMatch ? null : side.sbTeamId;
    const [slots, anchors, events] = await Promise.all([
      this.prisma.sbMatchSquadPlayer.findMany({
        where: { matchId: match.id, ...(narrowTo ? { teamId: narrowTo } : {}) },
        orderBy: [{ teamId: "asc" }, { isStarter: "desc" }, { jerseyNumber: "asc" }],
        select: { id: true, playerId: true, playerName: true, jerseyNumber: true, position: true, isStarter: true, teamId: true, squadId: true },
      }),
      this.clock.currentAnchors(track.videoAssetId),
      this.prisma.sbMatchEvent.findMany({ where: { matchId: match.id, type: "substitution" }, select: { teamId: true, minute: true, playerId: true, detail: true, metadata: true } }),
    ]);
    const window = windowOnClock(anchors, track.startMs, track.endMs);
    /* The track is read off the footage on a stopwatch; the substitutions are in the
       recorder's minutes, on this match's half length. Both go onto one timeline before
       they are compared (docs/vision/56). */
    const halfLength = recorderHalfLength(match.statisticsSheet?.clock, match.competition?.formatConfig);
    const from = clockAt(anchors, track.startMs);
    const to = clockAt(anchors, track.endMs);
    const played = from.status === "on" && to.status === "on" ? { fromMinute: timelineOfReading(from), toMinute: timelineOfReading(to) } : null;
    const subs = events.flatMap((event): Substitution[] => {
      const sub = parseSubstitution(event);
      return sub ? [{ ...sub, span: timelineSpanOfRecorded(recordedMinuteOf(event, halfLength), halfLength) }] : [];
    });
    const all: RosterCandidate[] = slots.map((s) => ({
      matchSquadPlayerId: s.id,
      playerId: s.playerId,
      name: s.playerName,
      jerseyNumber: s.jerseyNumber,
      position: s.position,
      isStarter: s.isStarter,
      sbTeamId: s.teamId,
      sbTeamSquadId: s.squadId,
      onPitch: played ? onPitchFor(s, subs.filter((sub) => sub.teamId === s.teamId), played) : null,
    }));
    const candidates = window ? all.filter((c) => c.onPitch !== "no") : all;
    return {
      trackId,
      matchId: match.id,
      side: side.team,
      sbTeamId: side.sbTeamId,
      narrowedBy: narrowTo ? ("side" as const) : ("match" as const),
      candidates,
      clock: window ? CLOCK_APPLIED : CLOCK_NOTE,
      window: window ? { ...window, substitutions: subs.length, offPitch: all.length - candidates.length } : null,
    };
  }

  // ── Assign ───────────────────────────────────────────────────────────────

  /**
   * A person says who a track is for a window of it, or that it is unknown.
   *
   * The slot must be on this match's squad, and on the track's side when the side
   * is known -- unless the person says the side is wrong, in which case the kit
   * assignment is marked `corrected` and the identity stands. The window must lie
   * within the track and be non-empty. Every current assignment the window
   * overlaps is superseded. `propagateTo` writes the same person onto other
   * tracks of the asset as `propagated` rows, under the same rules.
   */
  async assign(trackId: string, input: AssignIdentityInput, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "say who a track is");
    const track = await this.loadTrack(trackId);
    const window = windowWithin(track, input.validFromMs, input.validToMs);
    const slot = await this.slotFor(track, input.matchSquadPlayerId);

    const side = await this.sideOf(track);
    let sideCorrected = false;
    if (slot && side.sbTeamId && slot.teamId !== side.sbTeamId) {
      if (!input.acceptSideMismatch) {
        throw new ConflictException({
          statusCode: 409,
          error: "SideDisagrees",
          message: `${slot.playerName} is on team ${slot.teamId}; the kit clustering put this track on side ${side.team} (${side.sbTeamId}).`,
          remediation: "If the kit was read wrongly, send acceptSideMismatch: true and the side will be marked corrected.",
        });
      }
      sideCorrected = true;
    }

    const propagateTo = [...new Set(input.propagateTo ?? [])].filter((id) => id !== track.id);
    if (!slot && propagateTo.length) {
      throw new ConflictException({
        statusCode: 409,
        error: "PropagateUnknownRefused",
        message: "Unknown cannot be propagated: two unknown tracks are not the same person.",
        remediation: "Mark each track unknown on its own.",
      });
    }
    const others = propagateTo.length
      ? await this.prisma.visionTrack.findMany({ where: { id: { in: propagateTo } }, select: { id: true, videoAssetId: true, startMs: true, endMs: true } })
      : [];
    const missing = propagateTo.filter((id) => !others.some((o) => o.id === id));
    const foreign = others.filter((o) => o.videoAssetId !== track.videoAssetId);
    if (missing.length || foreign.length) {
      throw new ConflictException({
        statusCode: 409,
        error: "PropagateTargetInvalid",
        message: `${missing.length} track(s) do not exist and ${foreign.length} belong to another asset.`,
        remediation: "Propagate only to tracks of the same asset.",
        missing,
        foreign: foreign.map((o) => o.id),
      });
    }
    // The same roster rule holds on every track the person is written onto.
    const correctedSides: string[] = [];
    for (const other of others) {
      const otherSide = await this.sideOf(other);
      if (slot && otherSide.sbTeamId && slot.teamId !== otherSide.sbTeamId) {
        if (!input.acceptSideMismatch) {
          throw new ConflictException({
            statusCode: 409,
            error: "SideDisagrees",
            message: `${slot.playerName} is on team ${slot.teamId}; the kit clustering put track ${other.id} on side ${otherSide.team} (${otherSide.sbTeamId}).`,
            remediation: "If the kit was read wrongly, send acceptSideMismatch: true and the side will be marked corrected.",
          });
        }
        if (otherSide.assignmentId) correctedSides.push(otherSide.assignmentId);
      }
    }
    if (sideCorrected && side.assignmentId) correctedSides.push(side.assignmentId);

    const base = {
      playerId: slot?.playerId ?? null,
      matchSquadPlayerId: slot?.id ?? null,
      sbTeamSquadId: slot?.squadId ?? null,
      sbTeamId: slot?.teamId ?? null,
      confidence: 1,
      decidedBy: person.userId,
      note: input.note ?? null,
    };

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.visionIdentityAssignment.create({
        data: { ...base, trackId: track.id, method: "manual", validFromMs: window.from, validToMs: window.to },
      });
      await this.supersedeOverlaps(tx, track.id, row.id, window);
      if (correctedSides.length) {
        await tx.visionTeamAssignment.updateMany({ where: { id: { in: correctedSides } }, data: { reviewState: "corrected" } });
      }
      const propagated = [];
      for (const other of others) {
        const p = await tx.visionIdentityAssignment.create({
          data: { ...base, trackId: other.id, method: "propagated", validFromMs: other.startMs, validToMs: other.endMs, note: `propagated from ${row.id}` },
        });
        await this.supersedeOverlaps(tx, other.id, p.id, { from: other.startMs, to: other.endMs });
        propagated.push(p);
      }
      return { row, propagated };
    });

    await this.audit.record(
      {
        action: "identity.assigned",
        targetKind: "vision_track",
        targetId: track.id,
        data: {
          assignmentId: created.row.id,
          playerId: base.playerId,
          matchSquadPlayerId: base.matchSquadPlayerId,
          window: [window.from, window.to],
          propagatedTo: created.propagated.map((p) => p.trackId),
          sidesCorrected: correctedSides,
        },
      },
      actor
    );
    return { assignment: created.row, propagated: created.propagated, sideCorrected: correctedSides.length > 0 };
  }

  // ── Review ───────────────────────────────────────────────────────────────

  /** A second person accepts; the person who assigned may not. Only accepted rows are public. */
  async accept(assignmentId: string, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "accept an identity");
    const row = await this.loadAssignment(assignmentId);
    if (row.decidedBy === person.userId) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "SelfAcceptanceRefused",
        message: "You cannot accept an identity you assigned.",
        remediation: "A second person with vision.review accepts. That is the whole control before a name goes public.",
      });
    }
    const updated = await this.prisma.visionIdentityAssignment.update({
      where: { id: row.id },
      data: { reviewState: "accepted", reviewedBy: person.userId },
    });
    await this.audit.record({ action: "identity.accepted", targetKind: "vision_identity_assignment", targetId: row.id }, actor);
    return updated;
  }

  async reject(assignmentId: string, reason: string, actor?: AdminAuthContext) {
    const person = requirePerson(actor, "reject an identity");
    const row = await this.loadAssignment(assignmentId);
    const updated = await this.prisma.visionIdentityAssignment.update({
      where: { id: row.id },
      data: { reviewState: "rejected", reviewedBy: person.userId, note: [row.note, `rejected: ${reason}`].filter(Boolean).join(" | ") },
    });
    await this.audit.record({ action: "identity.rejected", targetKind: "vision_identity_assignment", targetId: row.id, reason }, actor);
    return updated;
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  /**
   * The asset's tracks as a reviewer sees them: side, decided team, current
   * identity windows. `publicOnly` is what anything public may read: accepted by a
   * second person, naming a player, not superseded.
   */
  async forAsset(videoAssetId: string, publicOnly = false) {
    const asset = await this.prisma.visionVideoAsset.findUnique({
      where: { id: videoAssetId },
      select: {
        id: true,
        sbMatchId: true,
        sbMatch: { select: { id: true, homeTeam: { select: { id: true, name: true } }, awayTeam: { select: { id: true, name: true } } } },
        variants: { where: { kind: "proxy" }, orderBy: { createdAt: "desc" }, take: 1, select: { fps: true, sourceOffsetMs: true, durationMs: true, width: true, height: true } },
      },
    });
    if (!asset) throw new NotFoundException(`Unknown video asset ${videoAssetId}`);
    const tracks = await this.prisma.visionTrack.findMany({
      where: { videoAssetId },
      orderBy: [{ inferenceJobId: "desc" }, { startMs: "asc" }, { localTrackId: "asc" }],
      take: 2000,
      include: {
        teamAssignments: { orderBy: { createdAt: "desc" }, take: 1 },
        identities: {
          where: { supersededBy: null, ...(publicOnly ? { reviewState: "accepted", playerId: { not: null } } : {}) },
          orderBy: { validFromMs: "asc" },
        },
      },
    });
    const jobIds = [...new Set(tracks.map((t) => t.teamAssignments[0]?.inferenceJobId).filter((x): x is string => !!x))];
    const sides = jobIds.length ? await this.prisma.visionTeamSide.findMany({ where: { inferenceJobId: { in: jobIds } } }) : [];
    const sideOf = new Map(sides.map((s) => [`${s.inferenceJobId}:${s.team}`, s.sbTeamId]));
    const anchors = await this.clock.currentAnchors(videoAssetId);
    const slotIds = [...new Set(tracks.flatMap((t) => t.identities.map((a) => a.matchSquadPlayerId)).filter((x): x is string => !!x))];
    const slots = slotIds.length
      ? await this.prisma.sbMatchSquadPlayer.findMany({ where: { id: { in: slotIds } }, select: { id: true, playerName: true, jerseyNumber: true } })
      : [];
    const slotOf = new Map(slots.map((s) => [s.id, { name: s.playerName, jerseyNumber: s.jerseyNumber }]));
    const rows = tracks
      .map((t) => {
        const team = t.teamAssignments[0] ?? null;
        const sbTeamId = team?.team ? (sideOf.get(`${team.inferenceJobId}:${team.team}`) ?? null) : null;
        return {
          id: t.id,
          localTrackId: t.localTrackId,
          inferenceJobId: t.inferenceJobId,
          artifactKey: t.artifactKey,
          class: t.class,
          startMs: t.startMs,
          endMs: t.endMs,
          /** The track's window on the match clock, when the clock is anchored. */
          matchClock: anchors.length ? `${clockAt(anchors, t.startMs).display}–${clockAt(anchors, t.endMs).display}` : null,
          team: team ? { team: team.team, confidence: team.confidence, method: team.method, kitDescription: team.kitDescription, reviewState: team.reviewState, inferenceJobId: team.inferenceJobId } : null,
          sbTeamId,
          identities: t.identities.map((a) => ({ ...a, slot: a.matchSquadPlayerId ? (slotOf.get(a.matchSquadPlayerId) ?? null) : null })),
        };
      })
      .filter((t) => !publicOnly || t.identities.length);
    const match = asset.sbMatch
      ? { id: asset.sbMatch.id, homeTeam: asset.sbMatch.homeTeam, awayTeam: asset.sbMatch.awayTeam }
      : null;
    const proxy = asset.variants[0] ?? null;
    return {
      videoAssetId,
      matchId: asset.sbMatchId,
      match,
      proxy,
      publicOnly,
      clock: { anchored: anchors.length > 0, anchors },
      sidesDecided: sides.map((s) => ({ inferenceJobId: s.inferenceJobId, team: s.team, sbTeamId: s.sbTeamId })),
      tracks: rows,
      count: rows.length,
    };
  }

  /**
   * A presigned URL for the asset's proxy -- always the proxy, never the master --
   * so the review screen can show a track on the frame it was tracked on. Same
   * shape and TTL as the annotation workstation's media.
   */
  async media(videoAssetId: string) {
    const asset = await this.prisma.visionVideoAsset.findUnique({
      where: { id: videoAssetId },
      select: { id: true, variants: { where: { kind: "proxy" }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!asset) throw new NotFoundException(`Unknown video asset ${videoAssetId}`);
    const proxy = asset.variants[0];
    if (!proxy) {
      throw new ConflictException({
        statusCode: 409,
        error: "ProxyMissing",
        message: "This asset has no proxy to review on.",
        remediation: "Run transcode; the master is not an option.",
      });
    }
    return {
      url: await this.store.presignGet("derived", proxy.objectKey, this.config.playback.urlTtlSeconds),
      fps: proxy.fps,
      sourceOffsetMs: proxy.sourceOffsetMs,
      durationMs: proxy.durationMs,
      width: proxy.width,
      height: proxy.height,
      expiresInSeconds: this.config.playback.urlTtlSeconds,
    };
  }

  /**
   * One track's positions, read out of the artifact in object storage.
   *
   * The positions stay in the bucket (docs/vision/04 § CV outputs) and a browser
   * cannot read the bucket -- a presigned GET of JSON is refused by its CORS policy,
   * where a `<video>` source is not -- so the control plane reads the artifact and
   * hands back the one track asked for. The artifact is cached by key for the few
   * tracks a reviewer clicks through in a row, and refused above a size this box
   * should not be asked to parse; a match-length artifact needs splitting per
   * track at the worker, which is noted in docs/vision/36.
   */
  async positions(trackId: string) {
    const track = await this.prisma.visionTrack.findUnique({ where: { id: trackId }, select: { id: true, artifactKey: true, localTrackId: true } });
    if (!track) throw new NotFoundException(`Unknown track ${trackId}`);
    const artifact = await this.loadArtifact(track.artifactKey);
    const found = artifact.tracks.find((t) => t.localTrackId === track.localTrackId);
    return {
      trackId: track.id,
      localTrackId: track.localTrackId,
      key: track.artifactKey,
      trackerVersionId: artifact.trackerVersionId ?? null,
      positions: found?.positions ?? [],
    };
  }

  private readonly artifactCache = new Map<string, ParsedArtifact>();

  private async loadArtifact(key: string): Promise<ParsedArtifact> {
    const cached = this.artifactCache.get(key);
    if (cached) return cached;
    const body = await this.store.getSmallObject("derived", key);
    if (!body) {
      throw new ConflictException({
        statusCode: 409,
        error: "ArtifactMissing",
        message: `The track artifact ${key} is not in object storage.`,
        remediation: "Re-run track for the asset; the rows name an artifact that no longer exists.",
      });
    }
    if (body.byteLength > MAX_ARTIFACT_BYTES) {
      throw new ConflictException({
        statusCode: 409,
        error: "ArtifactTooLarge",
        message: `The track artifact is ${(body.byteLength / 1_048_576).toFixed(1)} MB; this box reads at most ${MAX_ARTIFACT_BYTES / 1_048_576} MB per track artifact.`,
        remediation: "A match-length artifact needs splitting per track at the worker.",
      });
    }
    const raw = JSON.parse(body.toString("utf8")) as { trackerVersionId?: string; tracks?: { localTrackId: number; positions?: unknown[] }[] };
    const parsed: ParsedArtifact = {
      trackerVersionId: typeof raw.trackerVersionId === "string" ? raw.trackerVersionId : undefined,
      tracks: (raw.tracks ?? []).map((t) => ({ localTrackId: Number(t.localTrackId), positions: Array.isArray(t.positions) ? t.positions : [] })),
    };
    if (this.artifactCache.size >= ARTIFACT_CACHE_ENTRIES) {
      const oldest = this.artifactCache.keys().next().value;
      if (oldest !== undefined) this.artifactCache.delete(oldest);
    }
    this.artifactCache.set(key, parsed);
    return parsed;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async loadTrack(trackId: string) {
    const track = await this.prisma.visionTrack.findUnique({
      where: { id: trackId },
      select: { id: true, videoAssetId: true, startMs: true, endMs: true, class: true, videoAsset: { select: { sbMatchId: true } } },
    });
    if (!track) throw new NotFoundException(`Unknown track ${trackId}`);
    return track;
  }

  private async loadAssignment(id: string) {
    const row = await this.prisma.visionIdentityAssignment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Unknown identity assignment ${id}`);
    if (row.supersededBy) {
      throw new ConflictException({
        statusCode: 409,
        error: "AssignmentSuperseded",
        message: `Assignment ${id} was superseded by ${row.supersededBy}.`,
        remediation: "Review the current assignment instead.",
      });
    }
    return row;
  }

  private async matchOf(sbMatchId: string | null) {
    if (!sbMatchId) {
      throw new ConflictException({
        statusCode: 409,
        error: "AssetWithoutMatch",
        message: "This footage is not linked to a ScoreBoard match, so it has no roster.",
        remediation: "Link the asset's source record to its fixture first.",
      });
    }
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: sbMatchId },
      select: { id: true, homeTeamId: true, awayTeamId: true, competition: { select: { formatConfig: true } }, statisticsSheet: { select: { clock: true } } },
    });
    if (!match) throw new NotFoundException(`Unknown match ${sbMatchId}`);
    return match;
  }

  /** The track's latest kit side, and the team a person said that side is, if any. */
  private async sideOf(track: { id: string }): Promise<{ team: TeamLabel | null; sbTeamId: string | null; assignmentId: string | null; inferenceJobId: string | null }> {
    const latest = await this.prisma.visionTeamAssignment.findFirst({ where: { trackId: track.id }, orderBy: { createdAt: "desc" } });
    if (!latest) return { team: null, sbTeamId: null, assignmentId: null, inferenceJobId: null };
    const team = latest.team === "A" || latest.team === "B" ? latest.team : null;
    if (!team) return { team: null, sbTeamId: null, assignmentId: latest.id, inferenceJobId: latest.inferenceJobId };
    const side = await this.prisma.visionTeamSide.findUnique({ where: { inferenceJobId_team: { inferenceJobId: latest.inferenceJobId, team } } });
    return { team, sbTeamId: side?.sbTeamId ?? null, assignmentId: latest.id, inferenceJobId: latest.inferenceJobId };
  }

  private async slotFor(track: { videoAsset: { sbMatchId: string | null } }, matchSquadPlayerId: string | null) {
    if (matchSquadPlayerId === null) return null;
    const match = await this.matchOf(track.videoAsset.sbMatchId);
    const slot = await this.prisma.sbMatchSquadPlayer.findUnique({
      where: { id: matchSquadPlayerId },
      select: { id: true, matchId: true, teamId: true, squadId: true, playerId: true, playerName: true },
    });
    if (!slot || slot.matchId !== match.id) {
      throw new ConflictException({
        statusCode: 409,
        error: "NotOnThisMatchSquad",
        message: `${matchSquadPlayerId} is not a roster slot of match ${match.id}.`,
        remediation: "Pick from GET /vision/review/tracks/:trackId/candidates.",
      });
    }
    return slot;
  }

  private async supersedeOverlaps(
    tx: Prisma.TransactionClient,
    trackId: string,
    byId: string,
    window: { from: number; to: number }
  ) {
    await tx.visionIdentityAssignment.updateMany({
      where: { trackId, supersededBy: null, id: { not: byId }, validFromMs: { lt: window.to }, validToMs: { gt: window.from } },
      data: { supersededBy: byId },
    });
  }
}

function windowWithin(track: { startMs: number; endMs: number }, from?: number, to?: number): { from: number; to: number } {
  const f = from ?? track.startMs;
  const t = to ?? track.endMs;
  if (!Number.isInteger(f) || !Number.isInteger(t) || f < track.startMs || t > track.endMs) {
    throw new ConflictException({
      statusCode: 409,
      error: "WindowOutsideTrack",
      message: `The window ${f}-${t}ms is not inside the track's ${track.startMs}-${track.endMs}ms.`,
      remediation: "An identity window is in source milliseconds within the track.",
    });
  }
  if (t <= f) {
    throw new ConflictException({
      statusCode: 409,
      error: "WindowEmpty",
      message: `The window ${f}-${t}ms is empty.`,
      remediation: "validToMs must be after validFromMs.",
    });
  }
  return { from: f, to: t };
}

function requirePerson(actor: AdminAuthContext | undefined, what: string): { userId: string; email?: string } {
  if (!actor?.userId) {
    throw new ForbiddenException({
      statusCode: 403,
      error: "IdentityNeedsAPerson",
      message: `Only a signed-in person may ${what}.`,
      detail: "These are mostly minors. A name is attached by a person, accepted by a second person, and the shared operator key is neither.",
      remediation: "Sign in as yourself.",
    });
  }
  return { userId: actor.userId, email: actor.email };
}
