import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { refusal } from "../vision/shared/refusals";
import type { AdminAuthContext } from "../admin/auth/admin-auth.types";
import { actorFields, devicesWhere, readerOf } from "./access";
import { hashesMatch, loadSigningKey, newToken, tokenHash, BUNDLE_ISSUER } from "./credentials";
import { FAIRPLAY_CONFIG, type FairPlayConfig } from "./fairplay.config";
import { FairPlayAuditService, deviceActor, SYSTEM_ACTOR } from "./fairplay-audit.service";

/**
 * Edge devices and their tokens (ADR-0005), on Vision's worker pattern:
 *
 *   bootstrap  shown once when an admin adds a device, valid for one `register` call
 *   device     issued by `register`; syncs, fetches the bundle and asks for upload URLs,
 *              for the sessions assigned to this device and no others
 *
 * Only hashes are stored. Unknown, expired, retired and wrong-kind tokens get one answer.
 * Retiring rotates the hash, so a token in flight stops working at once.
 *
 * Re-pairing replaces a device's token with a fresh bootstrap token, for a token that is
 * expiring, may have leaked, or belongs to a retired device that is coming back. The old
 * token stops at once, and only the same Edge machine can take the device back.
 *
 * A device serving an open session of a competition the caller cannot read is not shown to
 * them and cannot be retired, re-paired or given a session by them (F4).
 */

export type DeviceIdentity = { deviceId: string; edgeDeviceId: string; label: string };

const INVALID = () => refusal(401, "DeviceTokenInvalid", "Invalid device token", "Pair the Edge again with a new bootstrap token.");

@Injectable()
export class FairPlayDevicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FAIRPLAY_CONFIG) private readonly config: FairPlayConfig,
    @Inject(FairPlayAuditService) private readonly audit: FairPlayAuditService
  ) {}

  async create(label: string, ctx: AdminAuthContext) {
    const clean = label.trim().slice(0, 80);
    if (!clean) throw refusal(400, "LabelRequired", "A device needs a label", "Name the machine, for example 'Edge laptop 1'.");
    const bootstrapToken = newToken();
    const expiresAt = new Date(Date.now() + this.config.bootstrapTokenTtlHours * 3600_000);
    const device = await this.prisma.fairPlayEdgeDevice.create({
      data: { label: clean, tokenHash: tokenHash(bootstrapToken), tokenKind: "bootstrap", tokenExpiresAt: expiresAt,
        createdById: ctx.userId ?? null, createdByEmail: ctx.email ?? null },
    });
    await this.audit.record("device.created", { kind: "device", id: device.id }, actorFields(ctx), { label: clean });
    return { id: device.id, label: clean, bootstrapToken, bootstrapExpiresAt: expiresAt.toISOString() };
  }

  async list(ctx: AdminAuthContext) {
    const rows = await this.prisma.fairPlayEdgeDevice.findMany({ where: devicesWhere(readerOf(ctx)), orderBy: { createdAt: "desc" },
      include: { _count: { select: { sessions: true } } } });
    return rows.map((d) => ({
      id: d.id, label: d.label, edgeDeviceId: d.edgeDeviceId, state: d.retiredAt ? "retired" : d.tokenKind === "device" ? "paired" : "awaiting_pairing",
      createdAt: d.createdAt, createdByEmail: d.createdByEmail, registeredAt: d.registeredAt, lastSeenAt: d.lastSeenAt,
      retiredAt: d.retiredAt, tokenExpiresAt: d.tokenExpiresAt, sessions: d._count.sessions,
    }));
  }

  /**
   * Exchanges a bootstrap token for a device token, learns the Edge's own id, and returns the
   * public key the Edge must trust for bundles. The swap is conditional on the row still
   * holding the bootstrap hash, so one token cannot pair two machines.
   */
  async register(bootstrapToken: string, edgeDeviceId: string) {
    if (!/^[0-9a-f-]{36}$/.test(edgeDeviceId)) {
      throw refusal(400, "EdgeDeviceIdInvalid", "edgeDeviceId must be the Edge's UUID", "Run `fairplay-edge pair` on the Edge itself.");
    }
    const device = await this.byToken(bootstrapToken, "bootstrap");
    if (device.edgeDeviceId && device.edgeDeviceId !== edgeDeviceId) {
      // A re-pair token takes the device back to the machine it was, never to another one.
      await this.audit.record("device.refused", { kind: "device", id: device.id }, SYSTEM_ACTOR, { reason: "re-pair from another edge", edgeDeviceId });
      throw refusal(409, "EdgeMismatch", "This device belongs to another Edge machine.", "Add a new device for this machine instead.");
    }
    const taken = await this.prisma.fairPlayEdgeDevice.findUnique({ where: { edgeDeviceId } });
    if (taken && taken.id !== device.id) {
      await this.audit.record("device.refused", { kind: "device", id: device.id }, SYSTEM_ACTOR, { reason: "edge id already paired", other: taken.id });
      // The Edge keeps its id for good, so its history stays on one device row: a machine
      // that was retired comes back by re-pairing that device, not as a new one.
      throw taken.retiredAt
        ? refusal(409, "EdgeAlreadyPaired", `This Edge was paired as "${taken.label}", now retired.`, "Re-pair that device on the FairPlay page instead.")
        : refusal(409, "EdgeAlreadyPaired", "This Edge is already paired as another device.", "Retire the other device first.");
    }
    const deviceToken = newToken();
    const expiresAt = new Date(Date.now() + this.config.deviceTokenTtlDays * 86_400_000);
    const swapped = await this.prisma.fairPlayEdgeDevice.updateMany({
      where: { id: device.id, tokenHash: device.tokenHash, tokenKind: "bootstrap", retiredAt: null },
      data: { tokenHash: tokenHash(deviceToken), tokenKind: "device", tokenExpiresAt: expiresAt, edgeDeviceId,
        registeredAt: new Date(), lastSeenAt: new Date() },
    });
    if (swapped.count !== 1) throw INVALID();
    await this.audit.record("device.registered", { kind: "device", id: device.id }, deviceActor(device.id),
      { edgeDeviceId, rePaired: Boolean(device.edgeDeviceId) });
    const signing = this.config.bundleSigningKeyPem ? loadSigningKey(this.config.bundleSigningKeyPem) : null;
    return {
      deviceId: device.id, label: device.label, deviceToken, deviceTokenExpiresAt: expiresAt.toISOString(),
      // What the Edge adds to FAIRPLAY_TRUSTED_KEYS_FILE. Null until the cloud has a signing key.
      trustedKey: signing ? { keyId: signing.keyId, issuer: BUNDLE_ISSUER, publicKey: signing.publicKey } : null,
    };
  }

  async verify(token: string): Promise<DeviceIdentity> {
    const device = await this.byToken(token, "device");
    if (!device.edgeDeviceId) throw INVALID();
    // At most one write a minute per device, not one per batch.
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000) {
      await this.prisma.fairPlayEdgeDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    }
    return { deviceId: device.id, edgeDeviceId: device.edgeDeviceId, label: device.label };
  }

  async retire(id: string, ctx: AdminAuthContext) {
    const device = await this.visible(id, ctx);
    if (device.retiredAt) return { id, retiredAt: device.retiredAt };
    const retiredAt = new Date();
    await this.prisma.fairPlayEdgeDevice.update({ where: { id },
      data: { retiredAt, retiredById: ctx.userId ?? null, tokenHash: tokenHash(newToken()) } });
    await this.audit.record("device.retired", { kind: "device", id }, actorFields(ctx));
    return { id, retiredAt };
  }

  /**
   * A new bootstrap token for a device that was paired before: its current token stops now,
   * a retired device is brought back, and the Edge runs `fairplay-edge pair` again. Only the
   * same Edge machine can complete it (register checks the id).
   */
  async rePair(id: string, reason: string, ctx: AdminAuthContext) {
    const clean = reason.trim().slice(0, 300);
    if (!clean) throw refusal(400, "ReasonRequired", "Re-pairing needs a reason", "Say why: token expiring, token may have leaked, machine back in use.");
    const device = await this.visible(id, ctx);
    if (!device.edgeDeviceId) {
      throw refusal(409, "NeverPaired", "This device was never paired.", "Pair it with the bootstrap token it was given, or add it again.");
    }
    const bootstrapToken = newToken();
    const expiresAt = new Date(Date.now() + this.config.bootstrapTokenTtlHours * 3600_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.fairPlayEdgeDevice.update({ where: { id },
        data: { tokenHash: tokenHash(bootstrapToken), tokenKind: "bootstrap", tokenExpiresAt: expiresAt, retiredAt: null, retiredById: null } });
      await this.audit.record("device.re_pair_started", { kind: "device", id }, actorFields(ctx),
        { wasRetired: Boolean(device.retiredAt), edgeDeviceId: device.edgeDeviceId }, clean, tx);
    });
    return { id, label: device.label, bootstrapToken, bootstrapExpiresAt: expiresAt.toISOString() };
  }

  /** The device, if this caller may act on it; another competition's device looks absent. */
  private async visible(id: string, ctx: AdminAuthContext) {
    const device = await this.prisma.fairPlayEdgeDevice.findFirst({ where: { id, ...devicesWhere(readerOf(ctx)) } });
    if (!device) throw refusal(404, "NotFound", `Unknown device ${id}`, "Check the id.");
    return device;
  }

  private async byToken(token: string, kind: "bootstrap" | "device") {
    const trimmed = token.trim();
    if (!trimmed) throw INVALID();
    const candidate = tokenHash(trimmed);
    const device = await this.prisma.fairPlayEdgeDevice.findUnique({ where: { tokenHash: candidate } });
    if (!device || !hashesMatch(device.tokenHash, candidate) || device.tokenKind !== kind || device.retiredAt
      || device.tokenExpiresAt <= new Date()) {
      throw INVALID();
    }
    return device;
  }
}
