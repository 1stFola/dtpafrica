import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { refusal } from "../vision/shared/refusals";
import { canonical, CanonicalError, sha256Hex } from "./canonical";
import type { DeviceIdentity } from "./devices.service";
import { FairPlayAuditService, deviceActor } from "./fairplay-audit.service";

/**
 * `POST /api/v1/fairplay/sync/batch`: what the Edge's outbox delivers (outbox.py, and the
 * contract in docs/fairplay/integration-map.md §5).
 *
 * Delivery is at least once; application is exactly once. Each item carries a key
 * `{type}:{id}:{version}` and the SHA-256 of its payload, and gets one answer:
 *
 *   applied    stored now
 *   replayed   this key was applied before with the same hash: the stored answer again
 *   stale      an older version than the one held; recorded and ignored
 *   conflict   this key was seen with a different hash; nothing is overwritten. The Edge
 *              parks it for a person
 *   rejected   not this device's to send (another device's session, another match, an
 *              unknown session) or not well formed. Also parked
 *
 * An item that fails for an unexpected reason gets no answer, so the Edge retries it.
 * Every item is applied in its own transaction, so one bad item cannot undo the others.
 *
 * Ownership is the "wrong-match token" rule: a device may only send for sessions the cloud
 * assigned to it, and a session's match on the Edge must be the match the cloud provisioned.
 * The cloud never writes ScoreBoard events, sheets or scores from anything here (ADR-0001).
 *
 * A `withdrawal` (Phase 5.7, decisions.md D11) is a clip the Edge has withdrawn on request:
 * its file is gone from the Edge. It confirms a withdrawal made here, or records one made at
 * the venue, and the evidence sweep then removes any copy in the bucket.
 */

export const ENTITY_TYPES = ["session", "rights", "segment", "period", "calibration", "incident", "review", "job", "evidence", "audit", "withdrawal"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];
export type SyncStatus = "applied" | "replayed" | "stale" | "conflict" | "rejected";
export type SyncItem = { idempotencyKey: string; entityType: string; entityId: string; version: number; payloadHash: string; payload: unknown };
export type SyncResult = { idempotencyKey: string; status: SyncStatus; message?: string };

export const MAX_BATCH_ITEMS = 200;
const GENESIS = "0".repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;

class Reject extends Error {}

type Tx = Prisma.TransactionClient;
type Payload = Record<string, unknown>;

function str(p: Payload, key: string, required = true): string | null {
  const v = p[key];
  if (v === null || v === undefined) {
    if (required) throw new Reject(`payload.${key} is missing`);
    return null;
  }
  if (typeof v !== "string") throw new Reject(`payload.${key} must be a string`);
  return v;
}

function int(p: Payload, key: string, required = true): number | null {
  const v = p[key];
  if (v === null || v === undefined) {
    if (required) throw new Reject(`payload.${key} is missing`);
    return null;
  }
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new Reject(`payload.${key} must be an integer`);
  return v;
}

function time(p: Payload, key: string, required = true): Date | null {
  const v = str(p, key, required);
  if (v === null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || !/(Z|[+-]\d\d:\d\d)$/.test(v)) throw new Reject(`payload.${key} is not a UTC timestamp`);
  return d;
}

function json(p: Payload): Prisma.InputJsonValue {
  return p as Prisma.InputJsonValue;
}

@Injectable()
export class FairPlaySyncService {
  private readonly log = new Logger("FairPlaySync");

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FairPlayAuditService) private readonly audit: FairPlayAuditService
  ) {}

  async receive(device: DeviceIdentity, body: { deviceId?: unknown; items?: unknown }): Promise<{ results: SyncResult[] }> {
    if (body.deviceId !== device.edgeDeviceId) {
      throw refusal(403, "DeviceMismatch", "The batch names a different Edge from the token.", "Each Edge sends with its own token.");
    }
    if (!Array.isArray(body.items)) throw refusal(400, "ItemsRequired", "items must be a list", "Send the outbox batch.");
    if (body.items.length > MAX_BATCH_ITEMS) {
      throw refusal(400, "BatchTooLarge", `At most ${MAX_BATCH_ITEMS} items per batch`, "Send a smaller batch.");
    }
    const results: SyncResult[] = [];
    const touched = new Set<string>();
    for (const raw of body.items as unknown[]) {
      const result = await this.one(device, raw, touched).catch((error: unknown) => {
        // No answer: the Edge keeps the item and tries again later.
        this.log.error(`sync item failed: ${(error as Error).message}`);
        return null;
      });
      if (result) results.push(result);
    }
    if (touched.size) {
      await this.prisma.fairPlaySession.updateMany({ where: { id: { in: [...touched] } }, data: { lastSyncAt: new Date() } });
    }
    return { results };
  }

  private async one(device: DeviceIdentity, raw: unknown, touched: Set<string>): Promise<SyncResult> {
    const item = raw as Partial<SyncItem>;
    const key = typeof item?.idempotencyKey === "string" ? item.idempotencyKey : "";
    const shape = this.shape(item);
    if (shape) return { idempotencyKey: key, status: "rejected", message: shape };
    const it = item as SyncItem;

    const seen = await this.prisma.fairPlaySyncReceipt.findUnique({ where: { deviceId_idempotencyKey: { deviceId: device.deviceId, idempotencyKey: key } } });
    if (seen) {
      if (seen.payloadHash === it.payloadHash) return { idempotencyKey: key, status: "replayed" };
      await this.audit.record("sync.conflict", { kind: it.entityType, id: it.entityId }, deviceActor(device.deviceId),
        { key, held: seen.payloadHash, sent: it.payloadHash });
      return { idempotencyKey: key, status: "conflict", message: "this key was already received with different content" };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { status, sessionId } = await this.apply(tx, device, it);
        await tx.fairPlaySyncReceipt.create({ data: { deviceId: device.deviceId, idempotencyKey: key, entityType: it.entityType,
          entityId: it.entityId, version: it.version, payloadHash: it.payloadHash, status } });
        if (sessionId) touched.add(sessionId);
        return { idempotencyKey: key, status };
      });
    } catch (error) {
      if (error instanceof Reject) {
        await this.prisma.fairPlaySyncReceipt.create({ data: { deviceId: device.deviceId, idempotencyKey: key, entityType: it.entityType,
          entityId: it.entityId, version: it.version, payloadHash: it.payloadHash, status: "rejected", message: error.message.slice(0, 500) } });
        await this.audit.record("sync.rejected", { kind: it.entityType, id: it.entityId }, deviceActor(device.deviceId), { key, message: error.message });
        return { idempotencyKey: key, status: "rejected", message: error.message };
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // The same key arriving twice at once: the loser's answer comes from the winner's receipt.
        return this.one(device, raw, touched);
      }
      throw error;
    }
  }

  private shape(item: Partial<SyncItem>): string | null {
    if (!item || typeof item !== "object") return "an item must be an object";
    if (!ENTITY_TYPES.includes(item.entityType as EntityType)) return `unknown entity type ${String(item.entityType)}`;
    if (typeof item.entityId !== "string" || !item.entityId || item.entityId.length > 200) return "entityId must be a string";
    if (!Number.isSafeInteger(item.version) || (item.version as number) < 1) return "version must be a positive integer";
    if (item.idempotencyKey !== `${item.entityType}:${item.entityId}:${item.version}`) return "idempotencyKey must be type:id:version";
    if (typeof item.payloadHash !== "string" || !HEX64.test(item.payloadHash)) return "payloadHash must be a SHA-256";
    if (!item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) return "payload must be an object";
    return null;
  }

  private async apply(tx: Tx, device: DeviceIdentity, it: SyncItem): Promise<{ status: SyncStatus; sessionId: string | null }> {
    const p = it.payload as Payload;
    if (p.id !== undefined && it.entityType !== "audit" && p.id !== it.entityId) throw new Reject("payload.id is not the entity id");
    switch (it.entityType as EntityType) {
      case "session": return this.session(tx, device, it, p);
      case "rights":
      case "period":
      case "calibration": {
        const session = await this.ownSession(tx, device, str(p, "session_id")!);
        return this.record(tx, device, it, p, session);
      }
      case "segment": return this.record(tx, device, it, p, null);
      case "incident": return this.incident(tx, device, it, p);
      case "review": return this.review(tx, device, it, p);
      case "job": {
        const incident = await this.ownIncident(tx, device, str(p, "incident_id")!);
        return this.record(tx, device, it, p, incident.sessionId);
      }
      case "evidence": return this.evidence(tx, device, it, p);
      case "audit": return this.auditEntry(tx, device, it, p);
      case "withdrawal": return this.withdrawal(tx, device, it, p);
    }
  }

  // ── ownership ─────────────────────────────────────────────────────────

  private async ownSession(tx: Tx, device: DeviceIdentity, sessionId: string) {
    const session = await tx.fairPlaySession.findUnique({ where: { id: sessionId } });
    // One message for "unknown" and "another device's", so a token cannot probe ids.
    if (!session || session.deviceId !== device.deviceId) throw new Reject(`session ${sessionId} is not assigned to this device`);
    return session.id;
  }

  private async ownIncident(tx: Tx, device: DeviceIdentity, incidentId: string) {
    const incident = await tx.fairPlayIncident.findUnique({ where: { id: incidentId }, include: { session: { select: { deviceId: true } } } });
    if (!incident || incident.session.deviceId !== device.deviceId) throw new Reject(`incident ${incidentId} has not been received from this device`);
    return incident;
  }

  // ── entities ──────────────────────────────────────────────────────────

  private async session(tx: Tx, device: DeviceIdentity, it: SyncItem, p: Payload) {
    const session = await tx.fairPlaySession.findUnique({ where: { id: it.entityId } });
    if (!session || session.deviceId !== device.deviceId) throw new Reject(`session ${it.entityId} is not assigned to this device`);
    const matchRef = str(p, "match_ref", false);
    if (matchRef !== session.matchId) throw new Reject(`the session is for match ${session.matchId ?? "(deleted)"}, not ${matchRef ?? "none"}`);
    if (str(p, "mode") !== session.mode) throw new Reject(`the session's mode is ${session.mode}`);
    if (session.edgeVersion !== null && session.edgeVersion >= it.version) return { status: "stale" as const, sessionId: session.id };
    await tx.fairPlaySession.update({ where: { id: session.id },
      data: { edgeVersion: it.version, edgeCreatedAt: time(p, "created_utc"), endedAt: time(p, "ended_utc", false) } });
    return { status: "applied" as const, sessionId: session.id };
  }

  private async record(tx: Tx, device: DeviceIdentity, it: SyncItem, p: Payload, sessionId: string | null) {
    const held = await tx.fairPlayRecord.findUnique({ where: { entityType_entityId: { entityType: it.entityType, entityId: it.entityId } } });
    if (held && held.deviceId !== device.deviceId) throw new Reject(`${it.entityType} ${it.entityId} belongs to another device`);
    if (held && held.version >= it.version) return { status: "stale" as const, sessionId };
    const data = { deviceId: device.deviceId, sessionId, version: it.version, payload: json(p) };
    if (held) await tx.fairPlayRecord.update({ where: { entityType_entityId: { entityType: it.entityType, entityId: it.entityId } }, data });
    else await tx.fairPlayRecord.create({ data: { entityType: it.entityType, entityId: it.entityId, ...data } });
    return { status: "applied" as const, sessionId };
  }

  private async incident(tx: Tx, device: DeviceIdentity, it: SyncItem, p: Payload) {
    const sessionId = await this.ownSession(tx, device, str(p, "session_id")!);
    if (int(p, "version") !== it.version) throw new Reject("payload.version is not the item version");
    const held = await tx.fairPlayIncident.findUnique({ where: { id: it.entityId } });
    if (held && held.sessionId !== sessionId) throw new Reject("an incident cannot move to another session");
    if (held && held.version >= it.version) return { status: "stale" as const, sessionId };
    const data = { sessionId, version: it.version, state: str(p, "state")!, category: str(p, "category")!, eventUtc: time(p, "event_utc")!,
      period: str(p, "period", false), matchMinute: int(p, "match_minute", false), matchSecond: int(p, "match_second", false),
      sheetEventId: str(p, "sheet_event_id", false), payload: json(p) };
    if (!["flagged", "reviewing", "reviewed", "archived"].includes(data.state)) throw new Reject(`unknown incident state ${data.state}`);
    if (held) await tx.fairPlayIncident.update({ where: { id: it.entityId }, data });
    else await tx.fairPlayIncident.create({ data: { id: it.entityId, ...data } });
    return { status: "applied" as const, sessionId };
  }

  private async review(tx: Tx, device: DeviceIdentity, it: SyncItem, p: Payload) {
    const incident = await this.ownIncident(tx, device, str(p, "incident_id")!);
    // ADR-0001: a review that claims any authority other than shadow is refused outright.
    if (str(p, "authority_mode") !== "shadow") throw new Reject("only shadow reviews exist in V1");
    if (int(p, "version") !== it.version) throw new Reject("payload.version is not the item version");
    const held = await tx.fairPlayReview.findUnique({ where: { id: it.entityId } });
    if (held && held.incidentId !== incident.id) throw new Reject("a review cannot move to another incident");
    if (held && held.version >= it.version) return { status: "stale" as const, sessionId: incident.sessionId };
    const result = str(p, "result", false);
    if (result !== null && !["supports_original", "supports_alternative", "inconclusive", "footage_unavailable"].includes(result)) {
      throw new Reject(`unknown review result ${result}`);
    }
    const data = { incidentId: incident.id, version: it.version, state: str(p, "state")!, authorityMode: "shadow", result,
      reviewerId: str(p, "reviewer_id")!, reviewerName: str(p, "reviewer_name")!, completedAt: time(p, "completed_at", false), payload: json(p) };
    if (held) await tx.fairPlayReview.update({ where: { id: it.entityId }, data });
    else await tx.fairPlayReview.create({ data: { id: it.entityId, ...data } });
    return { status: "applied" as const, sessionId: incident.sessionId };
  }

  private async evidence(tx: Tx, device: DeviceIdentity, it: SyncItem, p: Payload) {
    const incident = await this.ownIncident(tx, device, str(p, "incident_id")!);
    if (str(p, "session_id") !== incident.sessionId) throw new Reject("the evidence names another session from its incident");
    const held = await tx.fairPlayEvidence.findUnique({ where: { id: it.entityId } });
    if (held && held.incidentId !== incident.id) throw new Reject("evidence cannot move to another incident");
    const sha256 = str(p, "sha256")!;
    // A clip's bytes never change: a later version may approve it, not replace it.
    if (held && held.sha256 !== sha256) throw new Reject("the evidence file's hash changed between versions");
    if (held && held.version >= it.version) return { status: "stale" as const, sessionId: incident.sessionId };
    if (!HEX64.test(sha256) || !HEX64.test(str(p, "manifest_sha256")!)) throw new Reject("sha256 and manifest_sha256 must be SHA-256");
    const data = { sessionId: incident.sessionId, incidentId: incident.id, version: it.version, state: str(p, "state")!, source: str(p, "source")!,
      footageKind: str(p, "footage_kind")!, sha256, bytes: BigInt(int(p, "bytes")!), manifestSha256: str(p, "manifest_sha256")!,
      windowStartUtc: time(p, "window_start_utc")!, windowDurationMs: int(p, "window_duration_ms")!, coverage: str(p, "coverage")!,
      approvedAt: time(p, "approved_utc", false), payload: json(p) };
    if (held) await tx.fairPlayEvidence.update({ where: { id: it.entityId }, data });
    else await tx.fairPlayEvidence.create({ data: { id: it.entityId, ...data } });
    return { status: "applied" as const, sessionId: incident.sessionId };
  }

  private async withdrawal(tx: Tx, device: DeviceIdentity, it: SyncItem, p: Payload) {
    const evidenceId = str(p, "evidence_id")!;
    const ev = await tx.fairPlayEvidence.findUnique({ where: { id: evidenceId }, include: { session: { select: { deviceId: true } }, withdrawal: true } });
    if (!ev || ev.session.deviceId !== device.deviceId) throw new Reject(`evidence ${evidenceId} has not been received from this device`);
    const sha256 = str(p, "clip_sha256")!;
    if (sha256 !== ev.sha256) throw new Reject("the withdrawn clip's hash is not the evidence's");
    const edgeDetail = { withdrawalId: it.entityId, removedFiles: Array.isArray(p.removed_files) ? p.removed_files : [],
      atUtc: str(p, "created_utc"), actorName: str(p, "actor_name"), requestRef: str(p, "request_ref", false) } as Prisma.InputJsonValue;
    if (ev.withdrawal) {
      if (ev.withdrawal.edgeAppliedAt) return { status: "stale" as const, sessionId: ev.sessionId };
      // Withdrawn here first: the Edge has now removed its file. (If both sides withdrew it at
      // once, the first withdrawal stands and the Edge's is noted with it.)
      await tx.fairPlayWithdrawal.update({ where: { id: ev.withdrawal.id }, data: { edgeAppliedAt: new Date(), edgeDetail } });
      await this.audit.record("withdrawal.confirmed_by_edge", { kind: "evidence", id: evidenceId }, deviceActor(device.deviceId),
        { withdrawalId: ev.withdrawal.id, edgeWithdrawalId: it.entityId }, null, tx);
      return { status: "applied" as const, sessionId: ev.sessionId };
    }
    const origin = str(p, "origin");
    if (origin !== "edge") throw new Reject("a withdrawal made in the cloud is confirmed by its own id");
    await tx.fairPlayWithdrawal.create({ data: { id: it.entityId, evidenceId, requestId: null, origin: "edge", reason: str(p, "reason")!,
      requester: str(p, "requester")!, clipSha256: sha256, clipBytes: BigInt(int(p, "clip_bytes")!), edgeAppliedAt: new Date(), edgeDetail } });
    await this.audit.record("evidence.withdrawn", { kind: "evidence", id: evidenceId }, deviceActor(device.deviceId),
      { withdrawalId: it.entityId, sha256, origin: "edge" }, null, tx);
    return { status: "applied" as const, sessionId: ev.sessionId };
  }

  /**
   * One audit entry. It is stored whatever the check says, and the check is recorded with
   * it: the contract is "accepted and flagged", never dropped. `ok` means the hash
   * recomputes from the Edge's own hashed text and the entry follows the previous one from
   * this device; `break` means either fails; `unverified` means the hash could not be
   * recomputed (sent without its text) or the previous entry has not arrived.
   */
  private async auditEntry(tx: Tx, device: DeviceIdentity, it: SyncItem, p: Payload) {
    const seq = int(p, "seq")!;
    if (it.entityId !== `${device.edgeDeviceId}:${seq}` || str(p, "device_id") !== device.edgeDeviceId) {
      throw new Reject("an audit entry must come from the device that wrote it");
    }
    const held = await tx.fairPlayEdgeAuditEntry.findUnique({ where: { edgeDeviceId_seq: { edgeDeviceId: device.edgeDeviceId, seq } } });
    if (held) return { status: "stale" as const, sessionId: null };
    const entryHash = str(p, "entry_hash")!;
    const prevHash = str(p, "prev_hash")!;
    if (!HEX64.test(entryHash) || !HEX64.test(prevHash)) throw new Reject("entry_hash and prev_hash must be SHA-256");
    const detailText = str(p, "detail_text", false);
    let hashOk: boolean | null = null;
    if (detailText !== null) {
      try {
        const body = { seq, at_utc: str(p, "at_utc"), device_id: device.edgeDeviceId, actor_id: str(p, "actor_id"), actor_name: str(p, "actor_name"),
          actor_kind: str(p, "actor_kind"), action: str(p, "action"), entity_type: str(p, "entity_type"), entity_id: str(p, "entity_id", false),
          entity_version: int(p, "entity_version", false), detail: detailText, prev_hash: prevHash };
        hashOk = sha256Hex(canonical(body)) === entryHash;
      } catch (error) {
        if (!(error instanceof CanonicalError)) throw error;
      }
    }
    const before = seq === 1 ? { entryHash: GENESIS } : await tx.fairPlayEdgeAuditEntry.findUnique({
      where: { edgeDeviceId_seq: { edgeDeviceId: device.edgeDeviceId, seq: seq - 1 } }, select: { entryHash: true } });
    const linkOk = before ? before.entryHash === prevHash : null;
    const chainStatus = hashOk === false || linkOk === false ? "break" : hashOk && linkOk ? "ok" : "unverified";
    await tx.fairPlayEdgeAuditEntry.create({
      data: { edgeDeviceId: device.edgeDeviceId, seq, atUtc: time(p, "at_utc")!, actorId: str(p, "actor_id")!, actorName: str(p, "actor_name")!,
        actorKind: str(p, "actor_kind")!, action: str(p, "action")!, entityType: str(p, "entity_type")!, entityId: str(p, "entity_id", false),
        entityVersion: int(p, "entity_version", false), detail: (p.detail ?? {}) as Prisma.InputJsonValue, prevHash, entryHash, chainStatus },
    });
    if (chainStatus === "break") {
      await this.audit.record("sync.chain_break", { kind: "audit", id: it.entityId }, deviceActor(device.deviceId),
        { seq, hashOk, linkOk }, null, tx);
    }
    return { status: "applied" as const, sessionId: null };
  }
}
