import { Inject, Injectable } from "@nestjs/common";
import type { AdminAuthContext } from "../admin/auth/admin-auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { refusal } from "../vision/shared/refusals";
import { actorFields, assertCompetition, readerOf } from "./access";
import { FairPlayEvidenceService } from "./evidence.service";
import { FAIRPLAY_CONFIG, type FairPlayConfig } from "./fairplay.config";
import { FairPlayAuditService } from "./fairplay-audit.service";

/**
 * The session report (JSON; the web admin prints it as HTML) and the storage usage panel.
 *
 * The report says what the venue recorded and nothing more. Findings are the reviewer's
 * own result, stated in the four fixed terms; there is no field for a ruling, a score or a
 * change to the match record, and the report says so at the top. The ScoreBoard event an
 * incident refers to is looked up by reference and shown as it stands (ADR-0009).
 */

export const REPORT_NOTICE =
  "Shadow review only. These findings are not decisions of the match officials, do not change the match record, " +
  "and are not a FIFA-authorised VAR or FVS review.";

export const RESULT_TERMS: Record<string, string> = {
  supports_original: "The footage supports the on-field decision.",
  supports_alternative: "The footage supports a different outcome from the on-field decision.",
  inconclusive: "The footage is inconclusive.",
  footage_unavailable: "No footage of the moment was available.",
};

type Payload = Record<string, unknown>;

@Injectable()
export class FairPlayReportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FAIRPLAY_CONFIG) private readonly config: FairPlayConfig,
    @Inject(FairPlayEvidenceService) private readonly evidence: FairPlayEvidenceService,
    @Inject(FairPlayAuditService) private readonly audit: FairPlayAuditService
  ) {}

  async report(sessionId: string, ctx: AdminAuthContext) {
    const reader = readerOf(ctx);
    const session = await this.prisma.fairPlaySession.findUnique({
      where: { id: sessionId },
      include: {
        incidents: { orderBy: { eventUtc: "asc" }, include: { reviews: true } },
        evidence: { include: { objects: true } },
      },
    });
    if (!session) throw refusal(404, "NotFound", `Unknown session ${sessionId}`, "Check the id.");
    assertCompetition(reader, session.competitionId, "session", sessionId);
    const organiser = reader.kind === "organiser";

    const events = session.matchId
      ? await this.prisma.sbMatchEvent.findMany({ where: { matchId: session.matchId }, select: { id: true, type: true, minute: true, metadata: true } })
      : [];
    const bySheetId = new Map<string, { id: string; type: string; minute: number }>();
    for (const e of events) {
      const sheetEventId = (e.metadata as Payload | null)?.sheetEventId;
      if (typeof sheetEventId === "string") bySheetId.set(sheetEventId, { id: e.id, type: e.type, minute: e.minute });
    }

    const incidents = [];
    for (const inc of session.incidents) {
      const p = inc.payload as Payload;
      const current = inc.reviews.find((r) => r.id === p.current_review_id) ?? inc.reviews.filter((r) => r.state === "completed").at(-1);
      const rp = (current?.payload ?? {}) as Payload;
      const evidence = [];
      for (const ev of session.evidence.filter((e) => e.incidentId === inc.id)) {
        const release = await this.evidence.releasable(ev.id);
        // An organiser sees only what is released; staff see everything, marked.
        if (organiser && !release.ok) continue;
        const clip = ev.objects.find((o) => o.kind === "clip");
        evidence.push({ id: ev.id, source: ev.source, coverage: ev.coverage, windowStartUtc: ev.windowStartUtc,
          windowDurationMs: ev.windowDurationMs, sha256: ev.sha256, manifestSha256: ev.manifestSha256, footageKind: ev.footageKind,
          released: release.ok, withheldBecause: release.ok ? null : release.reason,
          stored: clip?.state ?? "not_uploaded", deleteAfter: clip?.deleteAfter ?? null, deletedAt: clip?.deletedAt ?? null });
      }
      incidents.push({
        id: inc.id, category: inc.category, eventUtc: inc.eventUtc, period: inc.period, matchMinute: inc.matchMinute,
        matchSecond: inc.matchSecond, state: inc.state, version: inc.version,
        scoreboardEvent: inc.sheetEventId ? bySheetId.get(inc.sheetEventId) ?? { sheetEventId: inc.sheetEventId, unresolved: true } : null,
        ...(organiser ? {} : { note: p.note ?? null, playerRef: p.player_ref ?? null, reopenedCount: p.reopened_count ?? 0 }),
        finding: current && current.state === "completed"
          ? { result: current.result, statement: current.result ? RESULT_TERMS[current.result] ?? null : null,
              onFieldDecision: rp.on_field_decision ?? null, factualNotes: rp.factual_notes ?? null,
              reviewer: current.reviewerName, completedAt: current.completedAt, authorityMode: current.authorityMode }
          : null,
        evidence,
      });
    }

    await this.audit.record("report.read", { kind: "session", id: sessionId }, actorFields(ctx), { reader: reader.kind });
    return {
      schema: "fairplay.session-report/v1",
      notice: REPORT_NOTICE,
      generatedAt: new Date().toISOString(),
      session: { id: session.id, label: session.label, mode: session.mode, angleMode: session.angleMode, match: session.matchSnapshot,
        matchStillExists: session.matchId !== null, edgeCreatedAt: session.edgeCreatedAt, endedAt: session.endedAt, lastSyncAt: session.lastSyncAt },
      incidents,
    };
  }

  /** What the evidence bucket holds and costs, from the cloud's own records of what it allowed. */
  async usage() {
    const [stored, deleted, withdrawn, uploads, reads] = await Promise.all([
      this.prisma.fairPlayEvidenceObject.aggregate({ where: { state: "stored" }, _count: true, _sum: { bytes: true } }),
      this.prisma.fairPlayEvidenceObject.count({ where: { state: "deleted" } }),
      // Of those, removed because the clip was withdrawn on request (D11), not by the retention rule.
      this.prisma.fairPlayEvidenceObject.count({ where: { state: "deleted", evidence: { withdrawal: { isNot: null } } } }),
      this.prisma.fairPlayAuditLog.count({ where: { action: "upload.presigned", createdAt: { gte: monthStart() } } }),
      this.prisma.fairPlayAuditLog.count({ where: { action: "evidence.read", createdAt: { gte: monthStart() } } }),
    ]);
    const bytes = Number(stored._sum.bytes ?? 0n);
    const gb = bytes / 1024 ** 3;
    const p = this.config.prices;
    // Each upload is a PUT and a HEAD at most a few times over; each read a GET. Count generously.
    const classA = uploads * 2;
    const classB = uploads + reads;
    // Gross, before R2's free allowance: the allowance is per account and Vision's buckets
    // already use it, so FairPlay's share of it cannot be assumed.
    const estimate = gb * p.storagePerGbMonth + (classA / 1e6) * p.classAPerMillion + (classB / 1e6) * p.classBPerMillion;
    return {
      backend: this.config.storage.backend, bucket: this.config.storage.bucket,
      objects: stored._count, bytes, deletedObjects: deleted, withdrawnObjects: withdrawn, retentionDays: this.config.evidenceRetentionDays,
      thisMonth: { uploads, reads, classAOperations: classA, classBOperations: classB },
      estimatedMonthlyUsd: Math.round(estimate * 100) / 100,
      pricesUsd: p,
      note: "Gross, before R2's account-wide free allowance (shared with Vision). R2 list prices as configured; recheck before relying on the estimate. Egress from R2 is free.",
    };
  }
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
