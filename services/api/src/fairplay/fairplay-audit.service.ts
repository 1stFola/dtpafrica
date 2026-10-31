import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The cloud's own FairPlay audit trail (`fairplay_audit_logs`). The Edge's entries, with
 * their hash chain, are kept apart in `fairplay_edge_audit_entries`. Both are insert-only
 * by trigger. Entries hold ids, hashes and staff names, never player names, PINs, tokens
 * or note text (decisions.md D13).
 */

export const FAIRPLAY_AUDIT_ACTIONS = [
  "device.created",
  "device.registered",
  "device.retired",
  "device.refused",
  "device.re_pair_started",
  "session.created",
  "session.members.changed",
  "member.pin.set",
  "bundle.issued",
  "sync.conflict",
  "sync.rejected",
  "sync.chain_break",
  "upload.presigned",
  "upload.stored",
  "upload.corrupt",
  "evidence.read",
  "evidence.deleted",
  "report.read",
  // Phase 5.7 (D11): a player's or a parent's request, by id; names stay on the request row.
  "request.created",
  "request.held_exported",
  "request.closed",
  "evidence.withdrawn",
  "withdrawal.confirmed_by_edge",
] as const;

export type FairPlayAuditAction = (typeof FAIRPLAY_AUDIT_ACTIONS)[number];

export type AuditActor = { actorKind: string; actorId: string | null; actorEmail: string | null };

export const SYSTEM_ACTOR: AuditActor = { actorKind: "system", actorId: null, actorEmail: null };

export function deviceActor(deviceId: string): AuditActor {
  return { actorKind: "device", actorId: deviceId, actorEmail: null };
}

type Writer = Pick<Prisma.TransactionClient, "fairPlayAuditLog">;

@Injectable()
export class FairPlayAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(action: FairPlayAuditAction, target: { kind: string; id: string | null }, actor: AuditActor,
    data?: Record<string, unknown>, reason?: string | null, tx?: Writer): Promise<void> {
    await (tx ?? this.prisma).fairPlayAuditLog.create({
      data: { action, targetKind: target.kind, targetId: target.id, ...actor, reason: reason ?? null,
        data: (data ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  }
}
