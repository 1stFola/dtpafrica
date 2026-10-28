import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { refusal } from "../vision/shared/refusals";
import type { AdminAuthContext } from "../admin/auth/admin-auth.types";
import { actorFields } from "./access";
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

  async list() {
    const rows = await this.prisma.fairPlayEdgeDevice.findMany({ orderBy: { createdAt: "desc" },
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
    const taken = await this.prisma.fairPlayEdgeDevice.findUnique({ where: { edgeDeviceId } });
    if (taken && taken.id !== device.id) {
      await this.audit.record("device.refused", { kind: "device", id: device.id }, SYSTEM_ACTOR, { reason: "edge id already paired", other: taken.id });
      throw refusal(409, "EdgeAlreadyPaired", "This Edge is already paired as another device.", "Retire the other device first.");
    }
    const deviceToken = newToken();
    const expiresAt = new Date(Date.now() + this.config.deviceTokenTtlDays * 86_400_000);
    const swapped = await this.prisma.fairPlayEdgeDevice.updateMany({
      where: { id: device.id, tokenHash: device.tokenHash, tokenKind: "bootstrap", retiredAt: null },
      data: { tokenHash: tokenHash(deviceToken), tokenKind: "device", tokenExpiresAt: expiresAt, edgeDeviceId,
        registeredAt: new Date(), lastSeenAt: new Date() },
    });
    if (swapped.count !== 1) throw INVALID();
    await this.audit.record("device.registered", { kind: "device", id: device.id }, deviceActor(device.id), { edgeDeviceId });
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
    const device = await this.prisma.fairPlayEdgeDevice.findUnique({ where: { id } });
    if (!device) throw refusal(404, "NotFound", `Unknown device ${id}`, "Check the id.");
    if (device.retiredAt) return { id, retiredAt: device.retiredAt };
    const retiredAt = new Date();
    await this.prisma.fairPlayEdgeDevice.update({ where: { id },
      data: { retiredAt, retiredById: ctx.userId ?? null, tokenHash: tokenHash(newToken()) } });
    await this.audit.record("device.retired", { kind: "device", id }, actorFields(ctx));
    return { id, retiredAt };
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
