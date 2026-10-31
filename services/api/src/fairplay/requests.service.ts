import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { AdminAuthContext } from "../admin/auth/admin-auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { refusal } from "../vision/shared/refusals";
import { actorFields, assertCompetition, readerOf } from "./access";
import type { DeviceIdentity } from "./devices.service";
import { FairPlayEvidenceService } from "./evidence.service";
import { FairPlayAuditService } from "./fairplay-audit.service";

/**
 * A player's or a parent's request about what FairPlay holds on them (decisions.md D11,
 * blockers.md B15), handled by an Edge admin, within the competitions their account is
 * scoped to:
 *
 *   held       everything that names the player (by the reference incidents record, never
 *              by name): each incident, its finding, its clips with their hashes, where
 *              each copy is held and until when, and how long the match's recordings are
 *              kept. Clips are downloaded one at a time through the audited read URL, with
 *              the request as the reason; nothing here hands out video.
 *   withdraw   a clip: its objects leave the bucket now, it is never released or uploaded
 *              again, and its Edge removes its file the next time it connects
 *              (`GET device/withdrawals`), then confirms by syncing the withdrawal back.
 *              The withdrawal row keeps the hash, the size, the reason and the requester.
 *
 * Audit rows name the request and the clip by id and hash. The requester's name and the
 * player reference stay on the request row (D13).
 */

export const RELATIONSHIPS = ["player", "parent_or_guardian", "representative"] as const;
/** D9: full-match recordings are kept on the Edge for 14 days. */
export const RECORDINGS_KEPT_DAYS = 14;

type Payload = Record<string, unknown>;

/** "#7 home", "7 Home" and "7home" are the same player; "#17 home" is not. */
export function sameRef(a: unknown, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[#\s]/g, "");
  return typeof a === "string" && norm(a) !== "" && norm(a) === norm(b);
}

function text(value: unknown, field: string, min: number, max: number): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length < min || s.length > max) throw refusal(400, "FieldInvalid", `${field} must be ${min} to ${max} characters`, `Fill in ${field}.`);
  return s;
}

@Injectable()
export class FairPlayRequestsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FairPlayAuditService) private readonly audit: FairPlayAuditService,
    @Inject(FairPlayEvidenceService) private readonly evidence: FairPlayEvidenceService
  ) {}

  async create(body: Payload, ctx: AdminAuthContext) {
    const reader = readerOf(ctx);
    const competitionId = text(body.competitionId, "competitionId", 1, 64);
    const competition = await this.prisma.sbCompetition.findUnique({ where: { id: competitionId }, select: { id: true } });
    if (!competition) throw refusal(404, "NotFound", `Unknown competition ${competitionId}`, "Check the id.");
    assertCompetition(reader, competitionId, "competition", competitionId);
    const relationship = String(body.relationship ?? "");
    if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) {
      throw refusal(400, "RelationshipInvalid", `relationship is one of ${RELATIONSHIPS.join(", ")}`, "Say who is asking.");
    }
    const row = await this.prisma.fairPlayRequest.create({ data: {
      competitionId, playerRef: text(body.playerRef, "playerRef", 1, 60), requesterName: text(body.requesterName, "requesterName", 2, 120),
      relationship, reference: body.reference === undefined || body.reference === null ? null : text(body.reference, "reference", 0, 300) || null,
      createdById: ctx.userId ?? null, createdByEmail: ctx.email ?? null,
    } });
    await this.audit.record("request.created", { kind: "request", id: row.id }, actorFields(ctx), { competitionId });
    return this.get(row.id, ctx);
  }

  async list(ctx: AdminAuthContext) {
    const reader = readerOf(ctx);
    const rows = await this.prisma.fairPlayRequest.findMany({
      where: reader.competitions ? { competitionId: { in: reader.competitions } } : {},
      orderBy: { createdAt: "desc" }, take: 200, include: { _count: { select: { withdrawals: true } } },
    });
    return rows.map(({ _count, ...r }) => ({ ...r, withdrawals: _count.withdrawals }));
  }

  private async owned(id: string, ctx: AdminAuthContext) {
    const row = await this.prisma.fairPlayRequest.findUnique({ where: { id } });
    if (!row) throw refusal(404, "NotFound", `Unknown request ${id}`, "Check the id.");
    assertCompetition(readerOf(ctx), row.competitionId, "request", id);
    return row;
  }

  /** The request, the incidents that name its player, and what has been withdrawn. */
  async get(id: string, ctx: AdminAuthContext) {
    const request = await this.owned(id, ctx);
    const [incidents, withdrawals] = await Promise.all([this.incidentsFor(request.competitionId, request.playerRef),
      this.prisma.fairPlayWithdrawal.findMany({ where: { requestId: id }, orderBy: { createdAt: "asc" } })]);
    return { ...request, incidents, withdrawals: withdrawals.map(withdrawalView) };
  }

  private async incidentsFor(competitionId: string, playerRef: string) {
    const sessions = await this.prisma.fairPlaySession.findMany({ where: { competitionId },
      include: { device: { select: { label: true } }, incidents: { include: { reviews: true } },
        evidence: { include: { objects: true, withdrawal: true } } } });
    const out = [];
    for (const s of sessions) {
      for (const inc of s.incidents) {
        const p = inc.payload as Payload;
        if (!sameRef(p.player_ref, playerRef)) continue;
        const current = inc.reviews.find((r) => r.id === p.current_review_id) ?? inc.reviews.filter((r) => r.state === "completed").at(-1);
        const rp = (current?.payload ?? {}) as Payload;
        out.push({
          id: inc.id, sessionId: s.id, match: s.matchSnapshot, eventUtc: inc.eventUtc, period: inc.period, matchMinute: inc.matchMinute,
          matchSecond: inc.matchSecond, category: inc.category, state: inc.state, playerRef: p.player_ref, note: p.note ?? null,
          finding: current?.state === "completed"
            ? { result: current.result, onFieldDecision: rp.on_field_decision ?? null, factualNotes: rp.factual_notes ?? null, completedAt: current.completedAt }
            : null,
          evidence: s.evidence.filter((e) => e.incidentId === inc.id).map((e) => ({
            id: e.id, source: e.source, sha256: e.sha256, bytes: Number(e.bytes), windowStartUtc: e.windowStartUtc,
            windowDurationMs: e.windowDurationMs, footageKind: e.footageKind,
            withdrawn: e.withdrawal ? { id: e.withdrawal.id, at: e.withdrawal.createdAt, edgeConfirmedAt: e.withdrawal.edgeAppliedAt } : null,
            heldOnEdge: !e.withdrawal ? `the Edge "${s.device.label}", until the end of the season plus 12 months (decisions.md D10)`
              : e.withdrawal.edgeAppliedAt ? null : `the Edge "${s.device.label}", until it next connects: it then removes the withdrawn file`,
            inCloud: e.objects.map((o) => ({ kind: o.kind, state: o.state, deleteAfter: o.deleteAfter, deletedAt: o.deletedAt, deleteReason: o.deleteReason })),
          })),
        });
      }
    }
    return out.sort((a, b) => a.eventUtc.getTime() - b.eventUtc.getTime());
  }

  /** What is held about the player, as one JSON document for the requester. Audited. */
  async held(id: string, ctx: AdminAuthContext) {
    const request = await this.get(id, ctx);
    const sessions = await this.prisma.fairPlaySession.findMany({ where: { competitionId: request.competitionId,
      id: { in: [...new Set(request.incidents.map((i) => i.sessionId))] } }, include: { device: { select: { label: true } } } });
    const matches = sessions.map((s) => {
      const ended = s.endedAt ?? s.edgeCreatedAt ?? s.createdAt;
      return { sessionId: s.id, match: s.matchSnapshot,
        recordings: { heldOn: `the Edge "${s.device.label}"`, deletedBy: new Date(ended.getTime() + RECORDINGS_KEPT_DAYS * 86_400_000),
          note: `Full-match recordings are kept ${RECORDINGS_KEPT_DAYS} days (decisions.md D9) and are not exported here.` } };
    });
    const clips = request.incidents.reduce((n, i) => n + i.evidence.length, 0);
    await this.audit.record("request.held_exported", { kind: "request", id }, actorFields(ctx), { incidents: request.incidents.length, clips });
    return {
      schema: "fairplay.held-about-a-player/v1",
      generatedAt: new Date().toISOString(),
      generatedBy: ctx.email ?? null,
      request: { id: request.id, receivedAt: request.createdAt, relationship: request.relationship, reference: request.reference },
      playerRef: request.playerRef,
      notice: "What DTP FairPlay holds that names this player, by the reference its staff record (a shirt number or register id). "
        + "FairPlay is a shadow review: none of this changed a decision or a result. Clips are listed with their SHA-256; "
        + "a copy of each is sent separately.",
      matches,
      incidents: request.incidents,
      withdrawn: request.withdrawals,
    };
  }

  async withdraw(id: string, body: Payload, ctx: AdminAuthContext) {
    const request = await this.owned(id, ctx);
    if (request.state !== "open") throw refusal(409, "RequestClosed", `This request is ${request.state}.`, "Open a new request.");
    const evidenceId = text(body.evidenceId, "evidenceId", 36, 36);
    const reason = text(body.reason, "reason", 5, 500);
    const ev = await this.prisma.fairPlayEvidence.findUnique({ where: { id: evidenceId }, include: { session: { select: { competitionId: true } }, withdrawal: true } });
    // Another competition's clip answers as an unknown one.
    if (!ev || ev.session.competitionId !== request.competitionId) throw refusal(404, "NotFound", `Unknown evidence ${evidenceId}`, "Check the id.");
    if (ev.withdrawal) {
      if (ev.withdrawal.requestId === id) return { ...withdrawalView(ev.withdrawal), objectsRemoved: 0 };
      throw refusal(409, "AlreadyWithdrawn", "This clip has already been withdrawn.", "See the withdrawal it already has.");
    }
    const withdrawal = await this.prisma.fairPlayWithdrawal.create({ data: {
      id: randomUUID(), evidenceId, requestId: id, origin: "cloud", reason, requester: `${request.requesterName} (${request.relationship})`,
      clipSha256: ev.sha256, clipBytes: ev.bytes, createdById: ctx.userId ?? null, createdByEmail: ctx.email ?? null,
    } });
    await this.audit.record("evidence.withdrawn", { kind: "evidence", id: evidenceId }, actorFields(ctx),
      { withdrawalId: withdrawal.id, requestId: id, sha256: ev.sha256, origin: "cloud" });
    const removed = await this.evidence.removeWithdrawn(evidenceId);
    return { ...withdrawalView(withdrawal), objectsRemoved: removed };
  }

  async close(id: string, body: Payload, ctx: AdminAuthContext) {
    const request = await this.owned(id, ctx);
    if (request.state !== "open") throw refusal(409, "RequestClosed", `This request is already ${request.state}.`, "Nothing to do.");
    const outcome = String(body.outcome ?? "");
    if (!["completed", "refused"].includes(outcome)) throw refusal(400, "OutcomeInvalid", "outcome is completed or refused", "Say how it ended.");
    await this.prisma.fairPlayRequest.update({ where: { id }, data: { state: outcome, outcomeNote: text(body.note, "note", 5, 2000),
      closedAt: new Date(), closedByEmail: ctx.email ?? null } });
    await this.audit.record("request.closed", { kind: "request", id }, actorFields(ctx), { outcome });
    return this.get(id, ctx);
  }

  // ── the Edge ────────────────────────────────────────────────────────────

  /** Withdrawals of this device's clips that it has not yet confirmed. */
  async pendingFor(device: DeviceIdentity) {
    const rows = await this.prisma.fairPlayWithdrawal.findMany({
      where: { edgeAppliedAt: null, evidence: { session: { deviceId: device.deviceId } } }, orderBy: { createdAt: "asc" }, take: 100 });
    return rows.map((w) => ({ id: w.id, evidenceId: w.evidenceId, reason: w.reason, requester: w.requester, requestId: w.requestId,
      clipSha256: w.clipSha256, createdAt: w.createdAt }));
  }
}

function withdrawalView(w: { id: string; evidenceId: string; requestId: string | null; origin: string; reason: string; requester: string;
  clipSha256: string; clipBytes: bigint; createdByEmail: string | null; createdAt: Date; edgeAppliedAt: Date | null }) {
  return { id: w.id, evidenceId: w.evidenceId, requestId: w.requestId, origin: w.origin, reason: w.reason, requester: w.requester,
    clipSha256: w.clipSha256, clipBytes: Number(w.clipBytes), withdrawnBy: w.createdByEmail, withdrawnAt: w.createdAt, edgeConfirmedAt: w.edgeAppliedAt };
}
