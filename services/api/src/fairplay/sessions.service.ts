import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AdminAuthContext } from "../admin/auth/admin-auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { refusal } from "../vision/shared/refusals";
import { ACCOUNT_COMPETITIONS, ACCOUNT_SCOPE, accountReads, actorFields, assertCompetition, devicesWhere, readerOf } from "./access";
import { canonical, sha256Hex } from "./canonical";
import {
  BUNDLE_ISSUER,
  BUNDLE_SCHEMA,
  hashPinAsync,
  isoSeconds,
  loadSigningKey,
  signBundle,
  validPin,
  type Bundle,
  type BundleMember,
  type SignedBundle,
} from "./credentials";
import type { DeviceIdentity } from "./devices.service";
import { FAIRPLAY_CONFIG, type FairPlayConfig } from "./fairplay.config";
import { FairPlayAuditService, deviceActor } from "./fairplay-audit.service";

/** What a member may be given at the venue: the Edge's own list (auth.py PERMISSIONS). */
export const VENUE_PERMISSIONS = [
  "fairplay.incident.operate",
  "fairplay.incident.review",
  "fairplay.session.manage",
  "fairplay.edge.admin",
  "fairplay.evidence.view_original",
  "fairplay.evidence.export",
  "fairplay.report.view",
] as const;

export type MemberInput = { adminUserId: string; permissions: string[] };

export type CreateSessionInput = {
  matchId: string;
  deviceId: string;
  label?: string;
  mode?: string;
  angleMode?: string;
  members?: MemberInput[];
};

@Injectable()
export class FairPlaySessionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FAIRPLAY_CONFIG) private readonly config: FairPlayConfig,
    @Inject(FairPlayAuditService) private readonly audit: FairPlayAuditService
  ) {}

  async create(input: CreateSessionInput, ctx: AdminAuthContext) {
    const reader = readerOf(ctx);
    const mode = input.mode ?? "shadow";
    // ADR-0001. The database refuses anything else too.
    if (mode !== "shadow" && mode !== "post_match") {
      throw refusal(400, "ModeNotAllowed", "A session is shadow or post_match.", "V1 has no other mode; official intervention is disabled.");
    }
    const angleMode = input.angleMode ?? "single";
    if (angleMode !== "single" && angleMode !== "multi") throw refusal(400, "AngleModeInvalid", "angleMode is single or multi.", "Pick one.");
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: input.matchId },
      include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } }, competition: { select: { id: true, name: true } } },
    });
    if (!match) throw refusal(404, "NotFound", `Unknown match ${input.matchId}`, "Pick the match from ScoreBoard.");
    assertCompetition(reader, match.competitionId, "match", input.matchId);
    // A device serving another competition's open session is not this caller's to take over:
    // the bundle goes to the nearest kickoff, so a second session could seize the venue (F4).
    const device = await this.prisma.fairPlayEdgeDevice.findFirst({ where: { id: input.deviceId, ...devicesWhere(reader) } });
    if (!device || device.retiredAt) {
      throw refusal(400, "DeviceUnavailable", "That device does not exist, is retired, or is serving another competition.", "Pick a paired device.");
    }
    const members = await this.checkMembers(input.members ?? [], match.competitionId);
    const snapshot = {
      matchId: match.id, competitionId: match.competition.id, competition: match.competition.name,
      home: match.homeTeam.name, away: match.awayTeam.name, kickoffAt: match.kickoffAt?.toISOString() ?? null,
      venue: match.venue, roundLabel: match.roundLabel,
    };
    const label = (input.label?.trim() || `${match.homeTeam.name} v ${match.awayTeam.name}`).slice(0, 120);
    const session = await this.prisma.$transaction(async (tx) => {
      const row = await tx.fairPlaySession.create({
        data: { id: randomUUID(), matchId: match.id, competitionId: match.competitionId, matchSnapshot: snapshot, deviceId: device.id,
          label, mode, angleMode, createdById: ctx.userId ?? null, createdByEmail: ctx.email ?? null },
      });
      if (members.length) {
        await tx.fairPlaySessionMember.createMany({ data: members.map((m) => ({ sessionId: row.id, adminUserId: m.adminUserId,
          permissions: m.permissions, addedById: ctx.userId ?? null })) });
      }
      await this.audit.record("session.created", { kind: "session", id: row.id }, actorFields(ctx),
        { matchId: match.id, deviceId: device.id, mode, members: members.map((m) => ({ userId: m.adminUserId, permissions: m.permissions })) }, null, tx);
      return row;
    });
    return this.get(session.id, ctx);
  }

  async list(ctx: AdminAuthContext, filter: { matchId?: string }) {
    const reader = readerOf(ctx);
    const where: Prisma.FairPlaySessionWhereInput = {
      ...(filter.matchId ? { matchId: filter.matchId } : {}),
      ...(reader.competitions ? { competitionId: { in: reader.competitions } } : {}),
    };
    const rows = await this.prisma.fairPlaySession.findMany({
      where, orderBy: { createdAt: "desc" }, take: 200,
      include: { device: { select: { label: true } }, _count: { select: { incidents: true, evidence: true } } },
    });
    return rows.map((s) => ({
      id: s.id, matchId: s.matchId, competitionId: s.competitionId, label: s.label, mode: s.mode, match: s.matchSnapshot,
      // An organiser is not told which machine works a match, here or in the session itself.
      device: reader.kind === "organiser" ? null : s.device.label, createdAt: s.createdAt, lastSyncAt: s.lastSyncAt, endedAt: s.endedAt,
      incidents: s._count.incidents, evidence: s._count.evidence,
    }));
  }

  async get(id: string, ctx: AdminAuthContext) {
    const reader = readerOf(ctx);
    const s = await this.prisma.fairPlaySession.findUnique({
      where: { id },
      include: {
        device: { select: { id: true, label: true, lastSeenAt: true, retiredAt: true } },
        members: { include: { adminUser: { select: { email: true, name: true, isActive: true } } }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!s) throw refusal(404, "NotFound", `Unknown session ${id}`, "Check the id.");
    assertCompetition(reader, s.competitionId, "session", id);
    const base = { id: s.id, matchId: s.matchId, competitionId: s.competitionId, label: s.label, mode: s.mode, angleMode: s.angleMode,
      match: s.matchSnapshot, createdAt: s.createdAt, edgeCreatedAt: s.edgeCreatedAt, endedAt: s.endedAt, lastSyncAt: s.lastSyncAt };
    // An organiser sees the session, not who works it or on what machine.
    if (reader.kind === "organiser") return base;
    return {
      ...base,
      device: s.device,
      members: s.members.map((m) => ({ adminUserId: m.adminUserId, email: m.adminUser.email, name: m.adminUser.name,
        active: m.adminUser.isActive, permissions: m.permissions, pinSet: Boolean(m.pinHash), pinSetAt: m.pinSetAt,
        isMe: m.adminUserId === ctx.userId })),
    };
  }

  async setMembers(id: string, members: MemberInput[], ctx: AdminAuthContext) {
    const session = await this.prisma.fairPlaySession.findUnique({ where: { id } });
    if (!session) throw refusal(404, "NotFound", `Unknown session ${id}`, "Check the id.");
    assertCompetition(readerOf(ctx), session.competitionId, "session", id);
    const checked = await this.checkMembers(members, session.competitionId);
    await this.prisma.$transaction(async (tx) => {
      const keep = checked.map((m) => m.adminUserId);
      await tx.fairPlaySessionMember.deleteMany({ where: { sessionId: id, adminUserId: { notIn: keep } } });
      for (const m of checked) {
        // A changed permission set keeps the member's PIN; a removed member loses it.
        await tx.fairPlaySessionMember.upsert({
          where: { sessionId_adminUserId: { sessionId: id, adminUserId: m.adminUserId } },
          create: { sessionId: id, adminUserId: m.adminUserId, permissions: m.permissions, addedById: ctx.userId ?? null },
          update: { permissions: m.permissions },
        });
      }
      await this.audit.record("session.members.changed", { kind: "session", id }, actorFields(ctx),
        { members: checked.map((m) => ({ userId: m.adminUserId, permissions: m.permissions })) }, null, tx);
    });
    return this.get(id, ctx);
  }

  /** A member sets their own matchday PIN. Nobody can set anyone else's. */
  async setMyPin(id: string, pin: string, ctx: AdminAuthContext) {
    if (!ctx.userId) throw refusal(403, "PersonRequired", "Only a signed-in person may set a matchday PIN.", "Sign in as yourself.");
    if (!validPin(pin)) throw refusal(400, "PinInvalid", "A matchday PIN is 6 to 12 digits.", "Choose a longer PIN, digits only.");
    const member = await this.prisma.fairPlaySessionMember.findUnique({ where: { sessionId_adminUserId: { sessionId: id, adminUserId: ctx.userId } } });
    if (!member) throw refusal(404, "NotFound", `You are not a member of session ${id}`, "Ask the session manager to add you.");
    const pinSetAt = new Date();
    await this.prisma.fairPlaySessionMember.update({ where: { id: member.id }, data: { pinHash: await hashPinAsync(pin), pinSetAt } });
    await this.audit.record("member.pin.set", { kind: "session", id }, actorFields(ctx));
    return { sessionId: id, pinSetAt };
  }

  /**
   * The signed bundle for the session this device should run now: the one assigned to it,
   * not ended, whose kickoff is nearest. Members without a PIN, or whose account is
   * disabled, are left out. `have` is the content hash of the bundle the Edge holds: when it
   * still matches and that bundle has more than half its life left, nothing is re-signed.
   */
  async bundleFor(device: DeviceIdentity, have?: { contentHash?: string; expiresAt?: string }) {
    if (!this.config.bundleSigningKeyPem) {
      throw refusal(409, "SigningKeyMissing", "The cloud has no bundle signing key.", "Set FAIRPLAY_BUNDLE_SIGNING_KEY on the API.");
    }
    const sessions = await this.prisma.fairPlaySession.findMany({
      where: { deviceId: device.deviceId, endedAt: null },
      include: { members: { include: { adminUser: { select: { email: true, name: true, isActive: true, ...ACCOUNT_SCOPE,
        role: { include: { permissions: { include: { permission: { select: { slug: true } } } } } } } } } } },
    });
    if (!sessions.length) return { bundle: null, reason: "no open session is assigned to this device" };
    const now = Date.now();
    const kickoff = (s: (typeof sessions)[number]) => {
      const at = (s.matchSnapshot as { kickoffAt?: string | null }).kickoffAt;
      return at ? Math.abs(new Date(at).getTime() - now) : Number.MAX_SAFE_INTEGER;
    };
    const session = [...sessions].sort((a, b) => kickoff(a) - kickoff(b) || b.createdAt.getTime() - a.createdAt.getTime())[0];
    // The venue never gets more than the account holds now, not just when the member was added:
    // a permission taken off the role since is left out of the next bundle, and so is an
    // account no longer given the match's competition.
    const members: BundleMember[] = session.members
      .filter((m) => m.pinHash && m.adminUser.isActive && accountReads(m.adminUser, session.competitionId))
      .map((m) => {
        const held = roleSlugs(m.adminUser.role);
        return { userId: m.adminUserId, email: m.adminUser.email.trim().toLowerCase(), name: m.adminUser.name ?? m.adminUser.email,
          permissions: m.permissions.filter((p) => held.has(p)).sort(), pinHash: m.pinHash! };
      })
      .filter((m) => m.permissions.length)
      .sort((a, b) => (a.userId < b.userId ? -1 : 1));
    const sessionPart = { id: session.id, label: session.label, matchId: session.matchId, mode: session.mode };
    const contentHash = sha256Hex(canonical({ session: sessionPart, members }));
    const ttlMs = this.config.bundleTtlHours * 3600_000;
    if (have?.contentHash === contentHash && have.expiresAt && new Date(have.expiresAt).getTime() - now > ttlMs / 2) {
      return { unchanged: true, contentHash, sessionId: session.id };
    }
    const issued = new Date(now);
    const bundle: Bundle = {
      schema: BUNDLE_SCHEMA, issuer: BUNDLE_ISSUER, bundleId: randomUUID(), issuedAt: isoSeconds(issued),
      expiresAt: isoSeconds(new Date(now + ttlMs)), session: sessionPart, members,
    };
    const signed: SignedBundle = signBundle(bundle, loadSigningKey(this.config.bundleSigningKeyPem));
    await this.audit.record("bundle.issued", { kind: "session", id: session.id }, deviceActor(device.deviceId),
      { bundleId: bundle.bundleId, members: members.map((m) => m.userId), expiresAt: bundle.expiresAt });
    return { bundle: signed, contentHash, sessionId: session.id };
  }

  /**
   * Who could be a member of a session for this match: active accounts whose role holds a
   * venue permission and which may read the match's competition, and which permissions.
   * An organiser (report.view alone) is not venue staff and is not offered. A caller who
   * cannot read the match gets the same 404 as for a match that does not exist (F4).
   */
  async candidates(matchId: string, ctx: AdminAuthContext) {
    const match = await this.prisma.sbMatch.findUnique({ where: { id: matchId }, select: { competitionId: true } });
    if (!match) throw refusal(404, "NotFound", `Unknown match ${matchId}`, "Pick the match from ScoreBoard.");
    assertCompetition(readerOf(ctx), match.competitionId, "match", matchId);
    const staff = VENUE_PERMISSIONS.filter((p) => p !== "fairplay.report.view");
    const users = await this.prisma.adminUser.findMany({
      where: { isActive: true, role: { permissions: { some: { permission: { slug: { in: staff } } } } } },
      include: { ...ACCOUNT_COMPETITIONS, role: { include: { permissions: { include: { permission: { select: { slug: true } } } } } } },
      orderBy: { email: "asc" },
      take: 500,
    });
    return users.filter((u) => accountReads(u, match.competitionId)).map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role?.slug ?? null,
      permissions: [...roleSlugs(u.role)].filter((p) => (VENUE_PERMISSIONS as readonly string[]).includes(p)).sort() }));
  }

  /**
   * Members must be active accounts that themselves hold what they are given at the venue,
   * and may read the match's competition: the venue never grants more than the account does.
   */
  private async checkMembers(members: MemberInput[], competitionId: string): Promise<MemberInput[]> {
    if (members.length > 50) throw refusal(400, "TooManyMembers", "At most 50 members per session.", "Remove some.");
    const ids = [...new Set(members.map((m) => m.adminUserId))];
    if (ids.length !== members.length) throw refusal(400, "DuplicateMember", "A person is listed twice.", "List each member once.");
    const users = await this.prisma.adminUser.findMany({
      where: { id: { in: ids } },
      include: { ...ACCOUNT_COMPETITIONS, role: { include: { permissions: { include: { permission: { select: { slug: true } } } } } } },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return members.map((m) => {
      const user = byId.get(m.adminUserId);
      if (!user || !user.isActive) throw refusal(400, "MemberUnavailable", `Unknown or disabled account ${m.adminUserId}`, "Pick active admin accounts.");
      if (!accountReads(user, competitionId)) {
        throw refusal(400, "MemberOutOfScope", `${user.email} is not given this match's competition on their account.`,
          "Add the competition to their account in Settings, Users, or pick someone else.");
      }
      const perms = [...new Set(m.permissions)];
      const unknown = perms.filter((p) => !(VENUE_PERMISSIONS as readonly string[]).includes(p));
      if (unknown.length || !perms.length) {
        throw refusal(400, "PermissionInvalid", `Venue permissions must be FairPlay permissions (${unknown.join(", ") || "none given"})`, "Choose from the list.");
      }
      const held = roleSlugs(user.role);
      const missing = perms.filter((p) => !held.has(p));
      if (missing.length) {
        throw refusal(400, "PermissionNotHeld", `${user.email} does not hold ${missing.join(", ")} on their account.`,
          "Give the account a FairPlay role first; the venue never grants more than the account holds.");
      }
      return { adminUserId: user.id, permissions: perms.sort() };
    });
  }
}

type RoleWithPermissions = { slug: string; permissions: { permission: { slug: string } }[] } | null;

function roleSlugs(role: RoleWithPermissions): Set<string> {
  if (!role) return new Set();
  return new Set(role.permissions.map((p) => p.permission.slug));
}

