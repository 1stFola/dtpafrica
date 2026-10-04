import { randomUUID } from "node:crypto";
import {
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { visionKeys, type BucketId } from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { VisionJobsService } from "../jobs/vision-jobs.service";
import { OBJECT_STORE, type ObjectStore, type PartRef } from "../storage/object-store";
import { partnerHasUploadedEvidence } from "../rights/rights-evidence";
import { notFound, refusal } from "../shared/refusals";

/**
 * Resumable upload of source footage.
 *
 * The binding constraint is not the object store, it is Nigerian connectivity. A
 * 6 GB master over an unstable link *will* be interrupted, and if an interruption
 * restarts from zero then partners stop uploading and the corpus never gets
 * built. So session state lives on the server, and resume is authoritative
 * against what the store actually holds rather than what a client remembered to
 * report.
 *
 * Bytes never pass through this API. It issues signed part URLs; the client PUTs
 * directly to the store. See docs/vision/05-STORAGE.md.
 */

const MASTER: BucketId = "master";

export type UploadSessionView = {
  id: string;
  state: string;
  videoAssetId: string;
  bucket: string;
  key: string;
  partSizeBytes: number;
  expectedBytes: number | null;
  bytesReceived: number;
  receivedParts: { partNumber: number; etag: string; bytes: number }[];
  nextPartNumber: number;
  expiresAt: string;
  completedAt: string | null;
};

@Injectable()
export class VisionUploadService {
  private readonly log = new Logger(VisionUploadService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(VisionJobsService) private readonly jobs: VisionJobsService,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig
  ) {}

  /**
   * Open a session for an authorised source.
   *
   * Rights are checked here, at the door — refusing after 6 GB has landed would
   * be both useless and expensive.
   */
  async begin(
    params: {
      sourceVideoRecordId: string;
      mimeType: string;
      expectedBytes?: number;
      extension?: string;
    },
    actor?: AdminAuthContext,
    grantId?: string
  ): Promise<UploadSessionView> {
    const record = await this.prisma.visionSourceVideoRecord.findUnique({
      where: { id: params.sourceVideoRecordId },
      select: {
        id: true,
        partnerId: true,
        acquisitionStatus: true,
        acquisitionMethod: true,
        sbMatchId: true,
        _count: { select: { videoAssets: true } },
      },
    });
    if (!record) throw notFound("source record", params.sourceVideoRecordId);

    // Cataloguing is not acquisition. A URL someone registered is not something
    // DTP has been authorised to hold a copy of.
    if (record.acquisitionStatus === "catalogued") {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: "This source is catalogued only.",
        reason: "pending_acquisition",
        remediation:
          "Authorize acquisition on the source record — an authorized signatory must approve it — then retry.",
      });
    }
    if (record.acquisitionStatus === "refused") {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: "Acquisition of this source was refused.",
        reason: "restriction_violated",
        remediation: "Nothing to do here; the decision is on the source record.",
      });
    }
    if (!record.acquisitionMethod) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: "No acquisition method is recorded for this source.",
        reason: "pending_acquisition",
        remediation:
          "Record how the copy was obtained: partner_direct_upload, partner_authorized_export or platform_copy_authorized.",
      });
    }

    // Rights evidence is what the whole claim rests on. No document, no upload -- and
    // a document is one that reached the store, not a row whose signed URL was never used.
    if (!(await partnerHasUploadedEvidence(this.prisma, this.store, record.partnerId))) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: "No rights evidence is attached for this partner.",
        reason: "no_scope",
        remediation: "Upload the signed agreement against the partner, then retry.",
      });
    }

    // One grant, one upload. `usedAt` is set only at complete, so a link used to open
    // any number of billed multipart uploads (docs/vision/50, PR-4). A second begin on
    // a grant resumes the session it already has, the way the resume endpoint does.
    if (grantId) {
      const open = await this.prisma.visionUploadSession.findFirst({
        where: { grantId, state: { in: ["in_progress", "completed"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, state: true },
      });
      if (open?.state === "completed") {
        throw new ForbiddenException({
          statusCode: 403,
          error: "GrantUsed",
          message: "This upload link has already been used.",
          remediation: "Ask DTP for a new link.",
        });
      }
      if (open) return this.view(open.id, grantId);
    }

    const videoAssetId = randomUUID();
    const ref = visionKeys.sourceOriginal(videoAssetId, params.extension ?? "mp4");

    const { uploadId } = await this.store.createMultipartUpload(
      ref.bucket,
      ref.key,
      params.mimeType
    );

    const expiresAt = new Date(
      Date.now() + this.config.upload.sessionTtlHours * 60 * 60 * 1000
    );

    const session = await this.prisma.$transaction(async (tx) => {
      // The source is now being acquired. Only from `authorized`: a source already
      // `acquired` by an earlier copy stays so (docs/vision/50, PR-4).
      await tx.visionSourceVideoRecord.updateMany({
        where: { id: record.id, acquisitionStatus: "authorized" },
        data: { acquisitionStatus: "acquiring" },
      });
      await tx.visionVideoAsset.create({
        data: {
          id: videoAssetId,
          sourceVideoRecordId: record.id,
          // Footage of a catalogued match is footage of that match: every stage
          // after probe and fingerprint refuses an asset with no match, and the
          // record already says which one.
          sbMatchId: record.sbMatchId ?? null,
          corpus: "dtp_owned",
          objectKey: ref.key,
          bytes: BigInt(params.expectedBytes ?? 0),
          mimeType: params.mimeType,
          // Filled in by the fingerprint stage. A placeholder rather than a
          // fabricated value, so nothing can mistake it for a real checksum.
          checksumSha256: "",
          ingestState: "uploading",
        },
      });

      return tx.visionUploadSession.create({
        data: {
          videoAssetId,
          grantId: grantId ?? null,
          bucketId: ref.bucket,
          objectKey: ref.key,
          providerUploadId: uploadId,
          partSizeBytes: this.config.upload.partBytes,
          expectedBytes: params.expectedBytes ? BigInt(params.expectedBytes) : null,
          state: "in_progress",
          expiresAt,
          createdBy: actor?.userId ?? null,
        },
      });
    });

    await this.audit.record(
      {
        action: "upload.initiated",
        targetKind: "vision_upload_session",
        targetId: session.id,
        data: { sourceVideoRecordId: record.id, videoAssetId, key: ref.key },
      },
      actor
    );

    return this.view(session.id);
  }

  /**
   * Current state, reconciled against the store.
   *
   * This is what makes resume work across a closed browser, a new device or a
   * reboot: the client asks what landed, then uploads only what is missing.
   */
  async view(sessionId: string, grantId?: string): Promise<UploadSessionView> {
    const session = await this.load(sessionId, grantId);

    let received: { partNumber: number; etag: string; bytes: number }[] = [];
    if (session.state === "in_progress") {
      try {
        received = await this.store.listParts(
          session.bucketId as BucketId,
          session.objectKey,
          session.providerUploadId
        );
      } catch (error) {
        // A store that cannot answer must not make the session unreadable; fall
        // back to what we were told, and say so in the log.
        this.log.warn(
          `listParts failed for session ${sessionId}; falling back to recorded parts: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        received = asParts(session.receivedParts);
      }

      const bytes = received.reduce((sum, p) => sum + p.bytes, 0);
      await this.prisma.visionUploadSession.update({
        where: { id: session.id },
        data: { receivedParts: received as never, bytesReceived: BigInt(bytes) },
      });
      session.receivedParts = received as never;
      session.bytesReceived = BigInt(bytes);
    } else {
      received = asParts(session.receivedParts);
    }

    const highest = received.reduce((max, p) => Math.max(max, p.partNumber), 0);

    return {
      id: session.id,
      state: session.state,
      videoAssetId: session.videoAssetId ?? "",
      bucket: session.bucketId,
      key: session.objectKey,
      partSizeBytes: session.partSizeBytes,
      expectedBytes: session.expectedBytes === null ? null : Number(session.expectedBytes),
      bytesReceived: Number(session.bytesReceived),
      receivedParts: received,
      // Advisory only — a client resuming a sparse upload should fill its gaps.
      nextPartNumber: highest + 1,
      expiresAt: session.expiresAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
    };
  }

  /** Signed URLs for a batch of parts. Re-requestable, because they expire. */
  async signParts(
    sessionId: string,
    partNumbers: number[],
    grantId?: string
  ): Promise<{ partNumber: number; url: string; expiresInSeconds: number }[]> {
    const session = await this.load(sessionId, grantId);
    if (session.state !== "in_progress") {
      throw refusal(400, "SessionNotInProgress", `Session is ${session.state}; no more parts may be uploaded`, "Start a new upload session for the file.");
    }

    const ttl = this.config.upload.partUrlTtlSeconds;
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.store.presignUploadPart(
          session.bucketId as BucketId,
          session.objectKey,
          session.providerUploadId,
          partNumber,
          ttl
        ),
        expiresInSeconds: ttl,
      }))
    );
  }

  /**
   * Finalise.
   *
   * Idempotent: a client that completed, lost its connection and retried gets the
   * same answer rather than an error about an upload that no longer exists.
   */
  async complete(
    sessionId: string,
    parts: PartRef[] | undefined,
    actor?: AdminAuthContext,
    opts: { grantId?: string; enqueueIngest?: boolean } = {}
  ): Promise<UploadSessionView & { jobsQueued: string[] }> {
    const session = await this.load(sessionId, opts.grantId);

    if (session.state === "completed") {
      return { ...(await this.view(sessionId, opts.grantId)), jobsQueued: [] };
    }
    if (session.state !== "in_progress") {
      throw new GoneException(`Session is ${session.state}`);
    }

    // Prefer what the store holds over what the client reported: the client may
    // have died before reporting its last part.
    const known = await this.store.listParts(
      session.bucketId as BucketId,
      session.objectKey,
      session.providerUploadId
    );
    const finalParts: PartRef[] = known.length
      ? known.map((p) => ({ partNumber: p.partNumber, etag: p.etag }))
      : (parts ?? []);

    if (!finalParts.length) {
      throw refusal(400, "NoPartsUploaded", "No parts have been uploaded for this session", "Upload the file's parts, then complete the session.");
    }

    // A gap means a part was lost. Completing anyway would produce a silently
    // truncated master, which is the worst possible outcome here.
    const numbers = finalParts.map((p) => p.partNumber).sort((a, b) => a - b);
    const missing: number[] = [];
    for (let expected = 1; expected <= numbers[numbers.length - 1]!; expected += 1) {
      if (!numbers.includes(expected)) missing.push(expected);
    }
    if (missing.length) {
      throw refusal(400, "PartsMissing", `Cannot complete: part(s) ${missing.join(", ")} are missing. Upload them and retry.`, "Upload the missing parts, then complete the session again.");
    }

    await this.store.completeMultipartUpload(
      session.bucketId as BucketId,
      session.objectKey,
      session.providerUploadId,
      finalParts
    );

    const head = await this.store.head(session.bucketId as BucketId, session.objectKey);
    const bytes = head?.bytes ?? Number(session.bytesReceived);

    // A partner link's size limit applies to the bytes stored, not to the figure the
    // client announced at begin, which is advisory and can be anything.
    if (session.grantId) {
      const grant = await this.prisma.visionPartnerUploadGrant.findUnique({
        where: { id: session.grantId },
        select: { maxBytes: true },
      });
      if (grant && BigInt(bytes) > grant.maxBytes) {
        await this.store
          .deleteProtected(session.bucketId as BucketId, session.objectKey, "partner upload over its link's size limit")
          .catch(() => undefined);
        await this.prisma.visionUploadSession.update({
          where: { id: session.id },
          data: { state: "failed" },
        });
        throw new ForbiddenException({
          statusCode: 403,
          error: "GrantSizeExceeded",
          message: `The file is ${bytes} bytes; this link accepts up to ${grant.maxBytes}.`,
          remediation: "Contact DTP for a link that fits the file.",
        });
      }
    }

    if (session.expectedBytes !== null && bytes !== Number(session.expectedBytes)) {
      // Not fatal — the client's figure can be wrong — but a size mismatch is
      // worth recording, since it is also what a truncated upload looks like.
      this.log.warn(
        `session ${sessionId} completed at ${bytes} bytes, client expected ${session.expectedBytes}`
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.visionUploadSession.update({
        where: { id: session.id },
        data: { state: "completed", completedAt: new Date(), bytesReceived: BigInt(bytes) },
      });
      if (session.videoAssetId) {
        await tx.visionVideoAsset.update({
          where: { id: session.videoAssetId },
          data: { bytes: BigInt(bytes), ingestState: "uploaded" },
        });
      }
      if (session.grantId) {
        // One grant, one upload.
        await tx.visionPartnerUploadGrant.update({
          where: { id: session.grantId },
          data: { usedAt: new Date() },
        });
      }
    });

    await this.audit.record(
      {
        action: "upload.completed",
        targetKind: "vision_upload_session",
        targetId: session.id,
        data: { bytes, parts: finalParts.length, key: session.objectKey },
      },
      actor
    );

    const jobsQueued: string[] = [];
    if (opts.enqueueIngest !== false && session.videoAssetId) {
      // probe and fingerprint need no match linkage and are cheap, so the
      // deterministic part of ingestion starts itself.
      for (const type of ["probe", "fingerprint"] as const) {
        try {
          const job = await this.jobs.enqueueForAsset(
            { type, videoAssetId: session.videoAssetId },
            actor
          );
          jobsQueued.push(job.id);
        } catch (error) {
          // A missing analysis grant should not make the upload look failed: the
          // bytes are safely stored and the job can be queued later.
          this.log.warn(
            `could not auto-queue ${type} for ${session.videoAssetId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }

    return { ...(await this.view(sessionId, opts.grantId)), jobsQueued };
  }

  /** Abandon a session and release the store's partial upload. */
  async abort(sessionId: string, actor?: AdminAuthContext, grantId?: string): Promise<void> {
    const session = await this.load(sessionId, grantId);
    if (session.state === "completed") {
      throw refusal(400, "SessionCompleted", "Session is already completed", "Nothing to do: the upload is finished.");
    }

    await this.store
      .abortMultipartUpload(
        session.bucketId as BucketId,
        session.objectKey,
        session.providerUploadId
      )
      .catch(() => undefined);

    await this.prisma.$transaction(async (tx) => {
      await tx.visionUploadSession.update({
        where: { id: session.id },
        data: { state: "aborted" },
      });
      if (session.videoAssetId) {
        // The asset never held bytes, so it is removed rather than left as a
        // permanent "uploading" row nothing will ever finish.
        await tx.visionVideoAsset
          .delete({ where: { id: session.videoAssetId } })
          .catch(() => undefined);
      }
    });
  }

  /**
   * Expire sessions past their deadline and release the store's partial uploads.
   *
   * Without this, an abandoned 6 GB multipart upload is billed indefinitely and
   * never shows up in any listing.
   */
  async expireStale(now = new Date()): Promise<{ expired: string[] }> {
    const stale = await this.prisma.visionUploadSession.findMany({
      where: { state: "in_progress", expiresAt: { lt: now } },
      select: {
        id: true,
        bucketId: true,
        objectKey: true,
        providerUploadId: true,
        videoAssetId: true,
      },
    });

    const expired: string[] = [];
    for (const session of stale) {
      await this.store
        .abortMultipartUpload(
          session.bucketId as BucketId,
          session.objectKey,
          session.providerUploadId
        )
        .catch(() => undefined);
      await this.prisma.visionUploadSession.update({
        where: { id: session.id },
        data: { state: "expired" },
      });
      if (session.videoAssetId) {
        await this.prisma.visionVideoAsset
          .update({
            where: { id: session.videoAssetId },
            data: { ingestState: "failed", ingestError: "upload session expired before completion" },
          })
          .catch(() => undefined);
      }
      expired.push(session.id);
    }
    return { expired };
  }

  private async load(sessionId: string, grantId?: string) {
    const session = await this.prisma.visionUploadSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw notFound("upload session", sessionId);

    // A partner holds a grant, not an account. It may only touch its own session,
    // and the check is here rather than in the controller so no route can forget it.
    if (grantId !== undefined && session.grantId !== grantId) {
      throw notFound("upload session", sessionId);
    }
    return session;
  }
}

function asParts(value: unknown): { partNumber: number; etag: string; bytes: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const partNumber = typeof row.partNumber === "number" ? row.partNumber : null;
    const etag = typeof row.etag === "string" ? row.etag : null;
    if (partNumber === null || etag === null) return [];
    return [{ partNumber, etag, bytes: typeof row.bytes === "number" ? row.bytes : 0 }];
  });
}
