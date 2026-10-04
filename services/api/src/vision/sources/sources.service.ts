import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  ACQUISITION_METHODS,
  RIGHTS_SCOPE_KEYS,
  SOURCE_QUALITY_PREFERENCE,
  readRestrictions,
  visionKeys,
} from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { VisionDatasetsService } from "../datasets/datasets.service";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import { partnerHasUploadedEvidence } from "../rights/rights-evidence";
import { JOB_QUEUE, JobNotClaimableError, type JobQueue } from "../jobs/job-queue";
import { notFound, refusal } from "../shared/refusals";

/**
 * The partner source catalog.
 *
 * Cataloguing and acquisition are deliberately separate workflows. Registering a
 * URL records that a match exists somewhere in the world; it grants nothing and
 * can never become a dataset member. Acquisition is a rights-gated human decision
 * on top of that. See docs/vision/03-RIGHTS-AND-GOVERNANCE.md.
 */

export type SourceListFilters = {
  partnerId?: string;
  acquisitionStatus?: string;
  sbCompetitionId?: string;
  q?: string;
};

@Injectable()
export class VisionSourcesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig,
    // Every parameter is explicit: mixing @Inject() with a reflected type makes the
    // reflected ones undefined at runtime. See vision-di.spec.ts.
    @Inject(VisionDatasetsService) private readonly datasets: VisionDatasetsService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue
  ) {}

  // ── Partners ─────────────────────────────────────────────────────────────

  async listPartners() {
    const partners = await this.prisma.visionSourcePartner.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { videoRecords: true, evidence: true, signatories: true } },
      },
    });
    return { partners };
  }

  async createPartner(
    dto: { name: string; academyId?: string; contactName?: string; contactEmail?: string; contactPhone?: string; notes?: string },
    actor?: AdminAuthContext
  ) {
    const partner = await this.prisma.visionSourcePartner.create({ data: dto });
    await this.audit.record(
      { action: "source.registered", targetKind: "vision_source_partner", targetId: partner.id, data: { name: dto.name } },
      actor
    );
    return partner;
  }

  /** Who at a partner may authorise an acquisition. Q1: Team Managers. */
  async addSignatory(
    partnerId: string,
    dto: { name: string; role: string; contactEmail?: string; contactPhone?: string; authorityEvidenceId?: string; activeFrom?: string },
    actor?: AdminAuthContext
  ) {
    await this.requirePartner(partnerId);
    const signatory = await this.prisma.visionPartnerAuthorizedSignatory.create({
      data: {
        partnerId,
        name: dto.name,
        role: dto.role,
        contactEmail: dto.contactEmail ?? null,
        contactPhone: dto.contactPhone ?? null,
        authorityEvidenceId: dto.authorityEvidenceId ?? null,
        activeFrom: dto.activeFrom ? new Date(dto.activeFrom) : new Date(),
      },
    });
    await this.audit.record(
      { action: "source.updated", targetKind: "vision_signatory", targetId: signatory.id, data: { partnerId, role: dto.role } },
      actor
    );
    return signatory;
  }

  // ── Rights evidence ──────────────────────────────────────────────────────

  /**
   * Issue a signed URL for the agreement document, then record it.
   *
   * The document goes to the master bucket alongside the footage it authorises,
   * because the two must not be separable.
   */
  /** Begin the evidence row the ordinary way, then put the bytes where its signed URL would have. */
  async attachEvidenceFile(
    partnerId: string,
    dto: { kind: string; extension: string; documentDate?: string; notes?: string },
    bytes: Buffer,
    contentType: string,
    actor?: AdminAuthContext
  ) {
    const begun = await this.beginEvidenceUpload(partnerId, dto, actor);
    await this.store.putSmallObject(begun.bucket, begun.key, bytes, contentType || contentTypeFor(dto.extension));
    return { evidenceId: begun.evidenceId, bucket: begun.bucket, key: begun.key, bytes: bytes.length };
  }

  async beginEvidenceUpload(
    partnerId: string,
    dto: { kind: string; extension: string; documentDate?: string; notes?: string },
    actor?: AdminAuthContext
  ) {
    await this.requirePartner(partnerId);

    const evidence = await this.prisma.visionRightsEvidence.create({
      data: {
        partnerId,
        kind: dto.kind,
        objectKey: "",
        documentDate: dto.documentDate ? new Date(dto.documentDate) : null,
        notes: dto.notes ?? null,
        uploadedBy: actor?.userId ?? null,
      },
    });

    const ref = visionKeys.rightsEvidence(partnerId, evidence.id, dto.extension);
    await this.prisma.visionRightsEvidence.update({
      where: { id: evidence.id },
      data: { objectKey: ref.key },
    });

    const url = await this.store.presignPut(ref.bucket, ref.key, this.config.upload.partUrlTtlSeconds, {
      contentType: contentTypeFor(dto.extension),
    });

    await this.audit.record(
      { action: "rights.evidence.attached", targetKind: "vision_rights_evidence", targetId: evidence.id, data: { partnerId, kind: dto.kind } },
      actor
    );

    return {
      evidenceId: evidence.id,
      bucket: ref.bucket,
      key: ref.key,
      uploadUrl: url,
      expiresInSeconds: this.config.upload.partUrlTtlSeconds,
    };
  }

  async listEvidence(partnerId: string) {
    const evidence = await this.prisma.visionRightsEvidence.findMany({
      where: { partnerId },
      orderBy: { createdAt: "desc" },
    });
    return { evidence };
  }

  // ── Rights scopes ────────────────────────────────────────────────────────

  /**
   * Grant scopes at partner, source or player level.
   *
   * Exactly one target, because the level decides precedence: most specific wins,
   * and deny beats allow. A grant with two targets would have no defined place in
   * that order.
   */
  async grantScope(
    dto: {
      partnerId?: string;
      sourceVideoRecordId?: string;
      playerId?: string;
      canAnalyze?: boolean;
      canTrain?: boolean;
      canPublishHighlight?: boolean;
      canShareWithScout?: boolean;
      expiresAt?: string;
      evidenceId?: string;
      restrictions?: Record<string, unknown>;
    },
    actor?: AdminAuthContext
  ) {
    /* Restrictions are read before they are stored. A `deny` entry that is not a scope
       would look like a restriction and restrict nothing, so it is refused here; a flag
       the policy does not understand is stored, and the reply says it denies everything. */
    const restrictions = readRestrictions(dto.restrictions);
    if (!restrictions.ok) {
      throw new BadRequestException({ statusCode: 400, error: "RestrictionsInvalid", message: restrictions.problem, remediation: "Use `deny` with scope names, and `note` for anything a person should read." });
    }
    const targets = [dto.partnerId, dto.sourceVideoRecordId, dto.playerId].filter(Boolean);
    if (targets.length !== 1) {
      throw refusal(400, "GrantLevelAmbiguous", "Grant exactly one of partnerId, sourceVideoRecordId or playerId — the level decides precedence.", "Name one of partnerId, sourceVideoRecordId or playerId.");
    }

    const grantLevel = dto.partnerId ? "partner" : dto.sourceVideoRecordId ? "source" : "player";

    if (!RIGHTS_SCOPE_KEYS.some((key) => dto[key])) {
      throw refusal(400, "GrantHasNoScope", `Grant at least one scope: ${RIGHTS_SCOPE_KEYS.join(", ")}.`, "Set at least one of the scopes to true.");
    }

    // Evidence is what the claim rests on. A grant with no document behind it is
    // an assertion, not a record.
    if (dto.evidenceId) {
      const evidence = await this.prisma.visionRightsEvidence.findUnique({
        where: { id: dto.evidenceId },
        select: { id: true },
      });
      if (!evidence) throw notFound("rights evidence", dto.evidenceId);
    }

    const scope = await this.prisma.visionRightsScope.create({
      data: {
        partnerId: dto.partnerId ?? null,
        sourceVideoRecordId: dto.sourceVideoRecordId ?? null,
        playerId: dto.playerId ?? null,
        grantLevel,
        canAnalyze: dto.canAnalyze ?? false,
        canTrain: dto.canTrain ?? false,
        canPublishHighlight: dto.canPublishHighlight ?? false,
        canShareWithScout: dto.canShareWithScout ?? false,
        grantedAt: new Date(),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        evidenceId: dto.evidenceId ?? null,
        restrictions: (dto.restrictions ?? undefined) as never,
      },
    });

    await this.audit.record(
      {
        action: "rights.scope.granted",
        targetKind: "vision_rights_scope",
        targetId: scope.id,
        data: { grantLevel, scopes: RIGHTS_SCOPE_KEYS.filter((k) => dto[k]), ...(restrictions.unrecognised.length ? { unrecognisedRestrictions: restrictions.unrecognised } : {}) },
      },
      actor
    );
    return restrictions.unrecognised.length
      ? {
          ...scope,
          restrictionsWarning: `The policy does not understand ${restrictions.unrecognised.map((k) => `"${k}"`).join(", ")}, so this grant denies every scope. Use \`deny\` to restrict a scope and \`note\` for text.`,
        }
      : scope;
  }

  /**
   * Withdraw a grant.
   *
   * Immediate and synchronous: every future rights check fails from this moment,
   * with no cleanup job in between. What follows — unpublishing, retraining
   * exclusion, deletion requests — is separate work, but the *block* is instant.
   */
  async revokeScope(scopeId: string, reason: string, actor?: AdminAuthContext) {
    const scope = await this.prisma.visionRightsScope.findUnique({
      where: { id: scopeId },
      select: {
        id: true,
        revokedAt: true,
        canTrain: true,
        partnerId: true,
        sourceVideoRecordId: true,
        playerId: true,
      },
    });
    if (!scope) throw notFound("rights scope", scopeId);
    if (scope.revokedAt) throw refusal(400, "ScopeAlreadyRevoked", "This grant is already withdrawn", "Nothing to do: the grant was withdrawn already.");

    const updated = await this.prisma.visionRightsScope.update({
      where: { id: scopeId },
      data: { revokedAt: new Date(), revokedReason: reason, revokedBy: actor?.userId ?? null },
    });

    await this.audit.record(
      { action: "rights.scope.revoked", targetKind: "vision_rights_scope", targetId: scopeId, reason },
      actor
    );

    /**
     * Withdrawing a training right has to reach the datasets that already used it.
     *
     * Without this the grant flipped to revoked and every frozen dataset stayed
     * unflagged, so a later training run would use footage whose consent was gone.
     * The datasets are flagged, never edited — see
     * `VisionDatasetsService.flagVersionsContaining`.
     */
    let datasets: { datasetVersions: string[]; unresolvedPlayerScope: boolean } = {
      datasetVersions: [],
      unresolvedPlayerScope: false,
    };
    if (scope.canTrain) {
      datasets = await this.datasets.flagVersionsForRevokedScope(scope, reason, actor);
    }

    const cancelledJobs = await this.cancelJobsNoLongerAnalysable(scope, reason, actor);

    return {
      ...updated,
      affectedDatasetVersions: datasets.datasetVersions,
      cancelledJobs,
      // Surfaced rather than swallowed: a player-level withdrawal needs the identity
      // graph (Phase 4) to resolve to assets, so an operator must know it still has
      // to be actioned by hand.
      ...(datasets.unresolvedPlayerScope
        ? {
            warning:
              "Player-level withdrawal: affected datasets cannot be resolved automatically until player identity linking lands. Review datasets holding this player's footage manually.",
          }
        : {}),
    };
  }

  /**
   * docs/vision/03 §Revocation, step 1: no further work on footage whose grant is gone.
   *
   * Every queued or running job on an asset the scope covered is cancelled -- but only
   * where the asset can no longer be analysed at all: another grant may still allow
   * it, and most-specific-wins decides, not this withdrawal alone. A running job's
   * worker learns at its next heartbeat (a 409) and stops. Claim re-checks rights as
   * well, so a job queued in the moment between is caught there. A player-level scope
   * resolves to no assets yet, as for datasets above.
   */
  private async cancelJobsNoLongerAnalysable(
    scope: { partnerId: string | null; sourceVideoRecordId: string | null },
    reason: string,
    actor?: AdminAuthContext
  ): Promise<string[]> {
    const where = scope.sourceVideoRecordId
      ? { videoAsset: { sourceVideoRecordId: scope.sourceVideoRecordId } }
      : scope.partnerId
        ? { videoAsset: { sourceVideoRecord: { partnerId: scope.partnerId } } }
        : null;
    if (!where) return [];

    const open = await this.prisma.visionJob.findMany({
      where: { ...where, state: { in: ["queued", "claimed", "running"] } },
      select: { id: true, videoAssetId: true },
    });
    const allowed = new Map<string, boolean>();
    const cancelled: string[] = [];
    for (const job of open) {
      if (!job.videoAssetId) continue;
      if (!allowed.has(job.videoAssetId)) {
        allowed.set(job.videoAssetId, (await this.rights.canAnalyze({ videoAssetId: job.videoAssetId })).allowed);
      }
      if (allowed.get(job.videoAssetId)) continue;
      try {
        await this.queue.cancel(job.id, `rights withdrawn: ${reason}`, actor?.userId ?? null);
        cancelled.push(job.id);
      } catch (error) {
        // Finished in the meantime: nothing left to stop.
        if (!(error instanceof JobNotClaimableError)) throw error;
      }
    }
    if (cancelled.length) {
      await this.audit.record(
        {
          action: "job.cancelled",
          targetKind: "vision_rights_scope",
          targetId: null,
          data: { jobIds: cancelled, reason: "rights withdrawn" },
        },
        actor
      );
    }
    return cancelled;
  }

  // ── Source records ───────────────────────────────────────────────────────

  async listSources(filters: SourceListFilters) {
    const sources = await this.prisma.visionSourceVideoRecord.findMany({
      where: {
        ...(filters.partnerId ? { partnerId: filters.partnerId } : {}),
        ...(filters.acquisitionStatus ? { acquisitionStatus: filters.acquisitionStatus } : {}),
        ...(filters.sbCompetitionId ? { sbCompetitionId: filters.sbCompetitionId } : {}),
        ...(filters.q
          ? { OR: [{ title: { contains: filters.q, mode: "insensitive" as const } }, { url: { contains: filters.q } }] }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      include: {
        partner: { select: { id: true, name: true } },
        sbMatch: { select: { id: true, slug: true } },
        sbCompetition: { select: { id: true, name: true } },
        _count: { select: { videoAssets: true } },
      },
    });
    return { sources };
  }

  /**
   * Register a source. **Metadata only.**
   *
   * A URL registered here grants nothing and can never become a dataset member —
   * that is enforced downstream by the corpus and acquisition checks, not by
   * politeness here.
   */
  async createSource(
    dto: {
      partnerId: string;
      channelId?: string;
      externalVideoId?: string;
      url?: string;
      title?: string;
      publishedAt?: string;
      durationSeconds?: number;
      sbMatchId?: string;
      sbCompetitionId?: string;
      rightsOwnerName?: string;
      sourceQualityRank: string;
      originalAvailable?: boolean;
      notes?: string;
    },
    actor?: AdminAuthContext
  ) {
    await this.requirePartner(dto.partnerId);

    const source = await this.prisma.visionSourceVideoRecord.create({
      data: {
        partnerId: dto.partnerId,
        channelId: dto.channelId ?? null,
        externalVideoId: dto.externalVideoId ?? null,
        url: dto.url ?? null,
        title: dto.title ?? null,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
        durationSeconds: dto.durationSeconds ?? null,
        sbMatchId: dto.sbMatchId ?? null,
        sbCompetitionId: dto.sbCompetitionId ?? null,
        rightsOwnerName: dto.rightsOwnerName ?? null,
        sourceQualityRank: dto.sourceQualityRank,
        originalAvailable: dto.originalAvailable ?? false,
        // Always catalogued. Acquisition is a separate, authorised decision.
        acquisitionStatus: "catalogued",
        notes: dto.notes ?? null,
      },
    });

    await this.audit.record(
      {
        action: "source.registered",
        targetKind: "vision_source_video_record",
        targetId: source.id,
        data: { partnerId: dto.partnerId, url: dto.url ?? null, rank: dto.sourceQualityRank },
      },
      actor
    );
    return source;
  }

  /** Bulk metadata import. Fetches nothing — a URL is a reference, not a file. */
  async importSources(
    partnerId: string,
    rows: { url?: string; externalVideoId?: string; title?: string; sourceQualityRank?: string; durationSeconds?: number }[],
    actor?: AdminAuthContext
  ) {
    await this.requirePartner(partnerId);

    const created: string[] = [];
    const skipped: { row: number; reason: string }[] = [];

    for (const [index, row] of rows.entries()) {
      if (!row.url && !row.externalVideoId) {
        skipped.push({ row: index + 1, reason: "no url or externalVideoId" });
        continue;
      }
      try {
        const source = await this.prisma.visionSourceVideoRecord.create({
          data: {
            partnerId,
            url: row.url ?? null,
            externalVideoId: row.externalVideoId ?? null,
            title: row.title ?? null,
            durationSeconds: row.durationSeconds ?? null,
            sourceQualityRank: row.sourceQualityRank ?? "platform_copy",
            acquisitionStatus: "catalogued",
          },
        });
        created.push(source.id);
      } catch {
        // Almost always the (channel, externalVideoId) uniqueness — a re-import of
        // a catalogue someone already loaded.
        skipped.push({ row: index + 1, reason: "already catalogued" });
      }
    }

    await this.audit.record(
      { action: "source.registered", targetKind: "vision_source_partner", targetId: partnerId, data: { imported: created.length, skipped: skipped.length } },
      actor
    );
    return { created: created.length, skipped, ids: created };
  }

  /** The full rights picture for one source, for the detail screen. */
  async getSource(id: string) {
    const source = await this.prisma.visionSourceVideoRecord.findUnique({
      where: { id },
      include: {
        partner: {
          include: {
            evidence: { orderBy: { createdAt: "desc" } },
            signatories: { orderBy: { activeFrom: "desc" } },
            rightsScopes: { orderBy: { grantedAt: "desc" } },
          },
        },
        rightsScopes: { orderBy: { grantedAt: "desc" } },
        authorizedBy: true,
        sbMatch: { select: { id: true, slug: true, kickoffAt: true } },
        sbCompetition: { select: { id: true, name: true } },
        videoAssets: {
          select: {
            id: true,
            ingestState: true,
            ingestError: true,
            objectKey: true,
            durationMs: true,
            videoCodec: true,
            duplicateClusterId: true,
            createdAt: true,
            // Whether the review proxy exists: the workstation screens open on it.
            variants: { where: { kind: "proxy" }, select: { kind: true, durationMs: true }, take: 1 },
          },
        },
        uploadGrants: {
          select: { id: true, expiresAt: true, usedAt: true, revokedAt: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!source) throw notFound("source record", id);

    /**
     * What the rights engine actually decides, rather than what the rows suggest.
     *
     * Resolved against a representative **asset** when this record has one, not
     * against the record alone. `canTrain` insists on an asset — training happens
     * on a copy, not on a catalogue entry — so resolving the record by itself made
     * the Train row read "not granted" on every screen, however acquired the
     * footage and however complete the paperwork. Worse, it hid the real answer:
     * research-only footage showed "pending acquisition" instead of naming the
     * corpus firewall as the reason.
     *
     * The oldest asset, so the answer is stable between requests rather than
     * depending on row order.
     */
    const representative = [...source.videoAssets].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    )[0];
    const decisions = await this.rights.describe(
      representative
        ? { sourceVideoRecordId: id, videoAssetId: representative.id }
        : { sourceVideoRecordId: id }
    );

    return {
      source,
      decisions,
      // Which copy the decisions describe, so the screen is never ambiguous about
      // what "granted" refers to.
      decisionsResolvedAgainstAssetId: representative?.id ?? null,
      preference: SOURCE_QUALITY_PREFERENCE[
        source.sourceQualityRank as keyof typeof SOURCE_QUALITY_PREFERENCE
      ] ?? null,
    };
  }

  /**
   * Authorise acquisition, naming the signatory who approved it.
   *
   * The signatory is required: "the partner agreed" is not a record, and without a
   * name an acquisition cannot be defended later.
   */
  async authorizeAcquisition(
    id: string,
    dto: { acquisitionMethod: string; signatoryId: string },
    actor?: AdminAuthContext
  ) {
    const source = await this.prisma.visionSourceVideoRecord.findUnique({
      where: { id },
      select: { id: true, partnerId: true, acquisitionStatus: true },
    });
    if (!source) throw notFound("source record", id);
    if (source.acquisitionStatus === "acquired") {
      throw refusal(400, "SourceAlreadyAcquired", "This source has already been acquired", "Nothing to do: the footage is in DTP's hands.");
    }

    if (!ACQUISITION_METHODS.includes(dto.acquisitionMethod as never)) {
      throw refusal(400, "AcquisitionMethodInvalid", `acquisitionMethod must be one of ${ACQUISITION_METHODS.join(", ")}. There is no fourth option: V1 ships no downloader.`, "Choose one of the methods listed.");
    }

    const signatory = await this.prisma.visionPartnerAuthorizedSignatory.findUnique({
      where: { id: dto.signatoryId },
      select: { id: true, partnerId: true, activeTo: true, name: true, role: true },
    });
    if (!signatory || signatory.partnerId !== source.partnerId) {
      throw refusal(400, "SignatoryNotOfPartner", "The signatory must belong to this source's partner", "Choose a signatory recorded for this source's partner, or add one.");
    }
    if (signatory.activeTo && signatory.activeTo < new Date()) {
      throw refusal(400, "SignatoryInactive", `${signatory.name} is no longer an active signatory`, "Choose a signatory who is active, or add one.");
    }

    // A document that reached the store, not a row whose signed URL was never used.
    if (!(await partnerHasUploadedEvidence(this.prisma, this.store, source.partnerId))) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: "No rights evidence is attached for this partner.",
        reason: "no_scope",
        remediation: "Upload the signed agreement against the partner first.",
      });
    }

    const updated = await this.prisma.visionSourceVideoRecord.update({
      where: { id },
      data: {
        acquisitionStatus: "authorized",
        acquisitionMethod: dto.acquisitionMethod,
        acquisitionAuthorizedBySignatoryId: signatory.id,
        acquisitionAuthorizedAt: new Date(),
      },
    });

    await this.audit.record(
      {
        action: "acquisition.authorized",
        targetKind: "vision_source_video_record",
        targetId: id,
        data: { method: dto.acquisitionMethod, signatory: `${signatory.name} (${signatory.role})` },
      },
      actor
    );
    return updated;
  }

  async refuseAcquisition(id: string, reason: string, actor?: AdminAuthContext) {
    await this.prisma.visionSourceVideoRecord.update({
      where: { id },
      data: { acquisitionStatus: "refused", notes: reason },
    });
    await this.audit.record(
      { action: "source.updated", targetKind: "vision_source_video_record", targetId: id, data: { refused: reason } },
      actor
    );
    return { ok: true };
  }

  // ── Partner upload grants ────────────────────────────────────────────────

  /**
   * Issue a scoped upload link for a partner with no DTP account.
   *
   * Without this there is no way for a club secretary to hand over a master file,
   * and creating an admin account for every one of them is neither realistic nor
   * safe. The plaintext token is returned exactly once; only its hash is stored.
   */
  async issueUploadGrant(
    sourceVideoRecordId: string,
    dto: { expiresInHours?: number; maxBytes?: number; allowedMimeTypes?: string[] },
    actor?: AdminAuthContext
  ) {
    const source = await this.prisma.visionSourceVideoRecord.findUnique({
      where: { id: sourceVideoRecordId },
      select: { id: true, partnerId: true, acquisitionStatus: true, acquisitionMethod: true },
    });
    if (!source) throw notFound("source record", sourceVideoRecordId);

    // A grant is permission to upload. Issuing one before acquisition is
    // authorised would hand out exactly the permission the workflow withholds.
    if (source.acquisitionStatus === "catalogued" || source.acquisitionStatus === "refused") {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: `Cannot issue an upload link for a ${source.acquisitionStatus} source.`,
        reason: "pending_acquisition",
        remediation: "Authorize acquisition first, naming the signatory who approved it.",
      });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + (dto.expiresInHours ?? 72) * 3600_000);

    const grant = await this.prisma.visionPartnerUploadGrant.create({
      data: {
        partnerId: source.partnerId,
        sourceVideoRecordId: source.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        maxBytes: BigInt(dto.maxBytes ?? 20 * 1024 * 1024 * 1024),
        allowedMimeTypes: dto.allowedMimeTypes ?? ["video/mp4", "video/quicktime", "video/x-matroska"],
        expiresAt,
        createdBy: actor?.userId ?? null,
      },
    });

    await this.audit.record(
      {
        action: "upload.grant.issued",
        targetKind: "vision_partner_upload_grant",
        targetId: grant.id,
        data: { sourceVideoRecordId, expiresAt: expiresAt.toISOString() },
      },
      actor
    );

    return {
      grantId: grant.id,
      /** Shown once. Only the hash is stored. */
      token,
      expiresAt: expiresAt.toISOString(),
      maxBytes: Number(grant.maxBytes),
      allowedMimeTypes: grant.allowedMimeTypes,
    };
  }

  async revokeUploadGrant(grantId: string, actor?: AdminAuthContext) {
    await this.prisma.visionPartnerUploadGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record(
      { action: "source.updated", targetKind: "vision_partner_upload_grant", targetId: grantId, data: { revoked: true } },
      actor
    );
    return { ok: true };
  }

  /**
   * "What breaks if I revoke this?" — answered before acting, not after.
   */
  async impact(sourceVideoRecordId: string) {
    const assets = await this.prisma.visionVideoAsset.findMany({
      where: { sourceVideoRecordId },
      select: {
        id: true,
        objectKey: true,
        duplicateClusterId: true,
        _count: { select: { variants: true, datasetMembers: true, jobs: true } },
      },
    });

    const assetIds = assets.map((a) => a.id);
    const [datasetMembers, scopes] = await Promise.all([
      this.prisma.visionDatasetMember.findMany({
        where: { videoAssetId: { in: assetIds } },
        select: { datasetVersionId: true, datasetVersion: { select: { label: true, frozenAt: true } } },
      }),
      this.prisma.visionRightsScope.count({ where: { sourceVideoRecordId, revokedAt: null } }),
    ]);

    return {
      assets: assets.length,
      variants: assets.reduce((sum, a) => sum + a._count.variants, 0),
      jobs: assets.reduce((sum, a) => sum + a._count.jobs, 0),
      duplicateClusters: [...new Set(assets.map((a) => a.duplicateClusterId).filter(Boolean))].length,
      datasetVersions: [
        ...new Map(
          datasetMembers.map((m) => [
            m.datasetVersionId,
            { id: m.datasetVersionId, label: m.datasetVersion.label, frozen: m.datasetVersion.frozenAt !== null },
          ])
        ).values(),
      ],
      liveScopes: scopes,
      /** Frozen dataset versions are immutable: revocation blocks new training
       *  rather than rewriting history. */
      note:
        "Revocation blocks future analysis, training and publication immediately. Frozen dataset versions are marked rather than edited, and model lineage is preserved.",
    };
  }

  private async requirePartner(partnerId: string) {
    const partner = await this.prisma.visionSourcePartner.findUnique({
      where: { id: partnerId },
      select: { id: true, isActive: true },
    });
    if (!partner) throw notFound("partner", partnerId);
    if (!partner.isActive) throw refusal(400, "PartnerInactive", "This partner is not active", "Reactivate the partner, or choose another.");
  }
}

function contentTypeFor(extension: string): string {
  const ext = extension.toLowerCase().replace(/^\./, "");
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "eml" || ext === "msg") return "message/rfc822";
  return "application/octet-stream";
}
