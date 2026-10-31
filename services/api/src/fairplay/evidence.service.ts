import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import type { AdminAuthContext } from "../admin/auth/admin-auth.types";
import { hasPermission } from "../admin/auth/admin-auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { refusal } from "../vision/shared/refusals";
import { actorFields, assertCompetition, EVIDENCE_READERS, readerOf } from "./access";
import type { DeviceIdentity } from "./devices.service";
import { FAIRPLAY_CONFIG, type FairPlayConfig } from "./fairplay.config";
import { FairPlayAuditService, deviceActor, SYSTEM_ACTOR } from "./fairplay-audit.service";
import { EVIDENCE_STORE, type EvidenceStore } from "./storage/evidence-store";

/**
 * Evidence in R2: what may go up, how the cloud knows it arrived intact, who may read it,
 * and when it is deleted (ADR-0006, decisions.md D1 and D10).
 *
 * What may go up is what may be released, decided the way the Edge decides it
 * (`evidence.released`): approved, its incident's finding standing (reviewed or archived),
 * and the session's latest rights record permitting it (synthetic footage, or release
 * permitted with a consent reference wherever players may be minors). Only clips and their
 * manifests: a whole-match upload is not built, and would need its own approval and budget.
 *
 * Upload: the Edge asks for a URL with the size and SHA-256 it computed, gets a presigned
 * PUT that R2 accepts only for those bytes, uploads, then asks the cloud to confirm. The
 * cloud HEADs the object and compares the size and the SHA-256 R2 reports, never the ETag.
 * A mismatch deletes the object and says so; the Edge uploads again.
 *
 * Read: a presigned GET of at most five minutes, after the permission, the competition
 * scope and the release rule are checked again at that moment, and every read is audited.
 *
 * Withdrawn (decisions.md D11, requests.service.ts): a clip withdrawn on request is never
 * released, uploaded or confirmed again, and its objects are removed: at once when it is
 * withdrawn here, by the next sweep when the Edge reports it withdrawn there.
 */

export const KINDS = ["clip", "manifest"] as const;
export type ObjectKind = (typeof KINDS)[number];
const CONTENT_TYPE: Record<ObjectKind, string> = { clip: "video/mp4", manifest: "application/json" };
const RETENTION_SWEEP_MS = 60 * 60 * 1000;

export type Releasable = { ok: boolean; reason: string };

const WITHDRAWN_REASON = "withdrawn on request (decisions.md D11)";

@Injectable()
export class FairPlayEvidenceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("FairPlayEvidence");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FAIRPLAY_CONFIG) private readonly config: FairPlayConfig,
    @Inject(EVIDENCE_STORE) private readonly store: EvidenceStore,
    @Inject(FairPlayAuditService) private readonly audit: FairPlayAuditService
  ) {}

  onModuleInit(): void {
    if (!this.store.configured || process.env.FAIRPLAY_RETENTION_SWEEP === "off") return;
    this.timer = setInterval(() => void this.sweep().catch((e: Error) => this.log.error(`retention sweep failed: ${e.message}`)), RETENTION_SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private requireStore(): void {
    if (!this.store.configured) {
      throw new ServiceUnavailableException({ statusCode: 503, error: "EvidenceStorageOff",
        message: "FairPlay evidence storage is not configured.", remediation: "Nothing is uploaded until the evidence bucket exists (FAIRPLAY_STORAGE_BACKEND=r2)." });
    }
  }

  static key(sessionId: string, evidenceId: string, kind: ObjectKind): string {
    return `sessions/${sessionId}/evidence/${evidenceId}/${kind === "clip" ? "clip.mp4" : "manifest.json"}`;
  }

  async releasable(evidenceId: string): Promise<Releasable> {
    const ev = await this.prisma.fairPlayEvidence.findUnique({ where: { id: evidenceId }, include: { withdrawal: { select: { id: true } } } });
    if (!ev) return { ok: false, reason: "unknown evidence" };
    if (ev.withdrawal) return { ok: false, reason: "withdrawn on request" };
    if (ev.state !== "approved") return { ok: false, reason: "not approved for release" };
    const incident = await this.prisma.fairPlayIncident.findUnique({ where: { id: ev.incidentId } });
    if (!incident || !["reviewed", "archived"].includes(incident.state)) {
      return { ok: false, reason: "the incident's finding is not complete (or it was reopened); its evidence is withheld" };
    }
    const rights = await this.currentRights(ev.sessionId);
    if (!rights) return { ok: false, reason: "no rights record has been received for this session" };
    if (rights.footage_kind === "synthetic") return { ok: true, reason: "synthetic test footage: no player is shown" };
    if (rights.status !== "external_release_permitted") return { ok: false, reason: "the session's rights do not permit release" };
    if (rights.minors_present !== "no" && !rights.consent_reference) return { ok: false, reason: "players may be minors and no consent reference is recorded" };
    return { ok: true, reason: "release permitted by the recorded rights" };
  }

  private async currentRights(sessionId: string) {
    const rows = await this.prisma.fairPlayRecord.findMany({ where: { sessionId, entityType: "rights" } });
    type Rights = { footage_kind?: string; status?: string; minors_present?: string; consent_reference?: string | null; created_utc?: string };
    const all = rows.map((r) => r.payload as Rights).sort((a, b) => String(a.created_utc).localeCompare(String(b.created_utc)));
    return all.at(-1) ?? null;
  }

  // ── uploads, by the Edge ────────────────────────────────────────────────

  async presign(device: DeviceIdentity, evidenceId: string, body: { kind?: unknown; bytes?: unknown; sha256?: unknown }) {
    this.requireStore();
    const kind = body.kind as ObjectKind;
    if (!KINDS.includes(kind)) throw refusal(400, "KindInvalid", "kind is clip or manifest", "Whole-match upload is not available.");
    const ev = await this.ownEvidence(device, evidenceId);
    const bytes = Number(body.bytes);
    const sha256 = String(body.sha256 ?? "");
    const expected = kind === "clip" ? { sha256: ev.sha256, bytes: Number(ev.bytes) } : { sha256: ev.manifestSha256, bytes };
    if (sha256 !== expected.sha256) throw refusal(409, "HashMismatch", `The ${kind}'s SHA-256 is not the one this evidence was synced with.`, "Re-verify the file on the Edge.");
    const limit = kind === "clip" ? this.config.maxClipBytes : this.config.maxManifestBytes;
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes !== expected.bytes || bytes > limit) {
      throw refusal(400, "SizeInvalid", `The ${kind}'s size is wrong or above ${limit} bytes.`, "Send the file's exact size.");
    }
    const release = await this.releasable(evidenceId);
    if (!release.ok) throw refusal(409, "NotReleasable", `Not uploaded: ${release.reason}.`, "Only approved, released evidence goes to the cloud.");
    const key = FairPlayEvidenceService.key(ev.sessionId, ev.id, kind);
    const held = await this.prisma.fairPlayEvidenceObject.findUnique({ where: { evidenceId_kind: { evidenceId, kind } } });
    if (held?.state === "stored") return { stored: true, key, storedAt: held.storedAt };
    if (held?.state === "deleted") throw refusal(409, "Deleted", "This object was deleted under the retention rule.", "It is not uploaded again.");
    const signed = await this.store.presignPut(key, bytes, sha256, CONTENT_TYPE[kind], this.config.uploadUrlTtlSeconds);
    await this.prisma.fairPlayEvidenceObject.upsert({
      where: { evidenceId_kind: { evidenceId, kind } },
      create: { evidenceId, kind, key, sha256, bytes: BigInt(bytes), presignedAt: new Date(), attempts: 1 },
      update: { presignedAt: new Date(), attempts: { increment: 1 } },
    });
    await this.audit.record("upload.presigned", { kind: "evidence", id: evidenceId }, deviceActor(device.deviceId), { kind, key, bytes, sha256 });
    return { stored: false, key, upload: signed };
  }

  async confirm(device: DeviceIdentity, evidenceId: string, kindRaw: string) {
    this.requireStore();
    const kind = kindRaw as ObjectKind;
    if (!KINDS.includes(kind)) throw refusal(400, "KindInvalid", "kind is clip or manifest", "Use clip or manifest.");
    const ev = await this.ownEvidence(device, evidenceId);
    const obj = await this.prisma.fairPlayEvidenceObject.findUnique({ where: { evidenceId_kind: { evidenceId, kind } } });
    if (!obj) throw refusal(404, "NotFound", `No upload was started for this ${kind}.`, "Ask for an upload URL first.");
    if (await this.prisma.fairPlayWithdrawal.findUnique({ where: { evidenceId: ev.id }, select: { id: true } })) {
      // An upload under way when the clip was withdrawn: whatever arrived is removed, not stored.
      await this.removeWithdrawn(evidenceId);
      throw refusal(409, "Withdrawn", "This clip was withdrawn on request; it is not stored.", "Nothing to upload: the Edge removes its copy.");
    }
    if (obj.state === "stored") return { stored: true, key: obj.key, storedAt: obj.storedAt };
    const head = await this.store.head(obj.key);
    if (!head) throw refusal(409, "NotUploaded", "The bucket does not hold the object yet.", "Upload it, then confirm.");
    const problems: string[] = [];
    if (head.bytes !== Number(obj.bytes)) problems.push(`size ${head.bytes}, expected ${obj.bytes}`);
    if (!head.sha256) problems.push("the store reported no SHA-256 checksum, so the object cannot be verified");
    else if (head.sha256 !== obj.sha256) problems.push("its SHA-256 differs from the Edge's");
    if (problems.length) {
      await this.store.remove(obj.key, `corrupt upload: ${problems.join("; ")}`);
      await this.audit.record("upload.corrupt", { kind: "evidence", id: evidenceId }, deviceActor(device.deviceId), { kind, key: obj.key, problems });
      throw refusal(409, "UploadCorrupt", `The uploaded ${kind} was not intact (${problems.join("; ")}) and has been removed.`, "Upload it again.");
    }
    const deleteAfter = await this.deleteAfter(evidenceId);
    const stored = await this.prisma.fairPlayEvidenceObject.update({ where: { id: obj.id },
      data: { state: "stored", storedAt: new Date(), etag: head.etag, deleteAfter } });
    await this.audit.record("upload.stored", { kind: "evidence", id: evidenceId }, deviceActor(device.deviceId),
      { kind, key: obj.key, sha256: obj.sha256, bytes: Number(obj.bytes), deleteAfter: deleteAfter.toISOString() });
    return { stored: true, key: obj.key, storedAt: stored.storedAt, deleteAfter };
  }

  /** D10: 90 days after the finding, meaning the latest completed review of the incident. */
  private async deleteAfter(evidenceId: string): Promise<Date> {
    const ev = await this.prisma.fairPlayEvidence.findUniqueOrThrow({ where: { id: evidenceId } });
    const review = await this.prisma.fairPlayReview.findFirst({ where: { incidentId: ev.incidentId, completedAt: { not: null } }, orderBy: { completedAt: "desc" } });
    const finding = review?.completedAt ?? ev.approvedAt ?? new Date();
    return new Date(finding.getTime() + this.config.evidenceRetentionDays * 86_400_000);
  }

  private async ownEvidence(device: DeviceIdentity, evidenceId: string) {
    const ev = await this.prisma.fairPlayEvidence.findUnique({ where: { id: evidenceId }, include: { session: { select: { deviceId: true } } } });
    if (!ev || ev.session.deviceId !== device.deviceId) throw refusal(404, "NotFound", `Unknown evidence ${evidenceId}`, "Sync the evidence record first.");
    return ev;
  }

  // ── reads, by people ────────────────────────────────────────────────────

  async readUrl(evidenceId: string, kindRaw: string | undefined, reason: string | undefined, ctx: AdminAuthContext) {
    this.requireStore();
    const reader = readerOf(ctx);
    if (reader.kind === "staff" && !EVIDENCE_READERS.some((p) => hasPermission(ctx, p))) {
      throw refusal(403, "EvidenceNotPermitted", "Reading evidence needs a review, export or session permission.", "Ask a FairPlay admin.");
    }
    const kind = (kindRaw ?? "clip") as ObjectKind;
    if (!KINDS.includes(kind)) throw refusal(400, "KindInvalid", "kind is clip or manifest", "Use clip or manifest.");
    const ev = await this.prisma.fairPlayEvidence.findUnique({ where: { id: evidenceId }, include: { session: { select: { competitionId: true } } } });
    if (!ev) throw refusal(404, "NotFound", `Unknown evidence ${evidenceId}`, "Check the id.");
    assertCompetition(reader, ev.session.competitionId, "evidence", evidenceId);
    const release = await this.releasable(evidenceId);
    if (!release.ok) throw refusal(409, "Withheld", `Withheld: ${release.reason}.`, "It becomes readable when the finding stands and the rights permit it.");
    const obj = await this.prisma.fairPlayEvidenceObject.findUnique({ where: { evidenceId_kind: { evidenceId, kind } } });
    if (!obj || obj.state !== "stored") {
      throw refusal(409, obj?.state === "deleted" ? "Deleted" : "NotUploaded",
        obj?.state === "deleted" ? `Deleted under the retention rule on ${obj.deletedAt?.toISOString().slice(0, 10)}.` : "Not uploaded from the venue yet.",
        obj?.state === "deleted" ? "The hash and the reason are kept in the audit log." : "Check the Edge's connection; it uploads when it can.");
    }
    const ttl = this.config.readUrlTtlSeconds;
    const url = await this.store.presignGet(obj.key, ttl, `${ev.id}-${kind === "clip" ? "clip.mp4" : "manifest.json"}`);
    await this.audit.record("evidence.read", { kind: "evidence", id: evidenceId }, actorFields(ctx),
      { kind, key: obj.key, sha256: obj.sha256, reader: reader.kind }, reason?.trim().slice(0, 500) || null);
    return { url, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), sha256: obj.sha256, bytes: Number(obj.bytes) };
  }

  // ── retention ───────────────────────────────────────────────────────────

  /** Deletes what is past its date, and what was withdrawn. The row stays, with its hash, the date and the reason. */
  async sweep(now = new Date()): Promise<{ deleted: number }> {
    if (!this.store.configured) return { deleted: 0 };
    const due = await this.prisma.fairPlayEvidenceObject.findMany({ where: { state: "stored", deleteAfter: { lte: now } }, take: 500 });
    let deleted = 0;
    for (const obj of due) {
      await this.removeObject(obj, `retention: ${this.config.evidenceRetentionDays} days after the finding (decisions.md D10)`, now);
      deleted += 1;
    }
    const withdrawn = await this.prisma.fairPlayEvidenceObject.findMany({
      where: { state: { in: ["stored", "pending"] }, evidence: { withdrawal: { isNot: null } } }, take: 500 });
    for (const obj of withdrawn) {
      await this.removeObject(obj, WITHDRAWN_REASON, now);
      deleted += 1;
    }
    return { deleted };
  }

  /** A withdrawn clip's objects, removed now: stored ones, and any upload still under way. */
  async removeWithdrawn(evidenceId: string, now = new Date()): Promise<number> {
    if (!this.store.configured) return 0;
    const objects = await this.prisma.fairPlayEvidenceObject.findMany({ where: { evidenceId, state: { in: ["stored", "pending"] } } });
    for (const obj of objects) await this.removeObject(obj, WITHDRAWN_REASON, now);
    return objects.length;
  }

  private async removeObject(obj: { id: string; evidenceId: string; kind: string; key: string; sha256: string; bytes: bigint }, reason: string, now: Date) {
    await this.store.remove(obj.key, reason);
    await this.prisma.fairPlayEvidenceObject.update({ where: { id: obj.id }, data: { state: "deleted", deletedAt: now, deleteReason: reason } });
    await this.audit.record("evidence.deleted", { kind: "evidence", id: obj.evidenceId }, SYSTEM_ACTOR,
      { kind: obj.kind, key: obj.key, sha256: obj.sha256, bytes: Number(obj.bytes) }, reason);
  }
}
