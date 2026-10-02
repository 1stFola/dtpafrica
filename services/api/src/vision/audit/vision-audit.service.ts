import { Inject, Injectable } from "@nestjs/common";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Vision audit trail.
 *
 * Actor fields are stored flat rather than as a relation, matching the
 * convention SbMatchStatistics already uses: an audit trail has to outlive the
 * admin user it refers to, and api-key auth has no user row at all.
 *
 * See docs/vision/03-RIGHTS-AND-GOVERNANCE.md.
 */

export const VISION_AUDIT_ACTIONS = [
  "source.registered",
  "source.updated",
  "rights.evidence.attached",
  "rights.scope.granted",
  "rights.scope.revoked",
  "acquisition.authorized",
  "upload.grant.issued",
  "upload.initiated",
  "upload.completed",
  "media.raw.read",
  "job.queued",
  "job.cancelled",
  "identity.assigned",
  "annotation.schema.published",
  "annotation.task.created",
  "annotation.task.abandoned",
  "annotation.submitted",
  "annotation.reviewed",
  "annotation.approved",
  "dataset.version.created",
  "dataset.member.added",
  "dataset.split.generated",
  "dataset.frozen",
  "dataset.exported",
  "model.registered",
  "model.version.registered",
  "model.benchmark.requested",
  "model.benchmarked",
  "model.promoted",
  "model.rolled_back",
  "evidence.published",
  "evidence.unpublished",
  "deletion.requested",
  "deletion.executed",
] as const;

export type VisionAuditAction = (typeof VISION_AUDIT_ACTIONS)[number];

/** Actions that must carry a stated reason, so an access can always be justified. */
export const REASON_REQUIRED_ACTIONS: readonly VisionAuditAction[] = [
  "media.raw.read",
  "rights.scope.revoked",
  "deletion.requested",
  "deletion.executed",
];

export type VisionAuditEntry = {
  action: VisionAuditAction;
  targetKind: string;
  targetId?: string | null;
  reason?: string | null;
  data?: Record<string, unknown>;
};

export class AuditReasonRequiredError extends Error {
  constructor(action: VisionAuditAction) {
    super(`A reason is required when recording "${action}".`);
    this.name = "AuditReasonRequiredError";
  }
}

@Injectable()
export class VisionAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(entry: VisionAuditEntry, actor?: AdminAuthContext | null): Promise<void> {
    if (REASON_REQUIRED_ACTIONS.includes(entry.action) && !entry.reason?.trim()) {
      throw new AuditReasonRequiredError(entry.action);
    }

    await this.prisma.visionAuditLog.create({
      data: {
        action: entry.action,
        targetKind: entry.targetKind,
        targetId: entry.targetId ?? null,
        actorId: actor?.userId ?? null,
        actorEmail: actor?.email ?? null,
        actorMethod: actor?.method ?? null,
        reason: entry.reason?.trim() || null,
        data: (entry.data ?? undefined) as never,
      },
    });
  }
}
