import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import type { AdminAuthContext } from "../admin/auth/admin-auth.types";
import { AdminAuth } from "../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../admin/guards/permissions.guard";
import { PrismaService } from "../prisma/prisma.service";
import { jsonSafe } from "../vision/shared/json-safe";
import { refusal } from "../vision/shared/refusals";
import { ANY_FAIRPLAY, assertCompetition, readerOf, STAFF_PERMISSIONS } from "./access";
import { FairPlayDevicesService } from "./devices.service";
import { FairPlayEvidenceService } from "./evidence.service";
import { FairPlayReportService } from "./report.service";
import { FairPlaySessionsService, type MemberInput } from "./sessions.service";

/**
 * FairPlay for people: `/api/v1/fairplay/...`, behind the admin guards. Every route names
 * its permission, and every read is then scoped to the competitions the account may see
 * (access.ts). Devices use fairplay-device.controller.ts, with their own guard.
 *
 * Nothing here writes a ScoreBoard event, a sheet or a score (ADR-0001).
 */
@Controller("fairplay")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class FairPlayAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FairPlayDevicesService) private readonly devices: FairPlayDevicesService,
    @Inject(FairPlaySessionsService) private readonly sessions: FairPlaySessionsService,
    @Inject(FairPlayEvidenceService) private readonly evidence: FairPlayEvidenceService,
    @Inject(FairPlayReportService) private readonly reports: FairPlayReportService
  ) {}

  /** What this account may do here, for the web admin to decide what to show (it decides nothing). */
  @Get("me")
  @RequirePermissions(...ANY_FAIRPLAY)
  me(@AdminAuth() ctx: AdminAuthContext) {
    const reader = readerOf(ctx);
    return { kind: reader.kind, competitions: reader.competitions, permissions: ctx.permissions.filter((p) => p.startsWith("fairplay.")) };
  }

  // ── devices ─────────────────────────────────────────────────────────────

  @Get("devices")
  @RequirePermissions("fairplay.edge.admin", "fairplay.session.manage")
  listDevices() {
    return this.devices.list();
  }

  @Post("devices")
  @RequirePermissions("fairplay.edge.admin")
  createDevice(@Body() body: { label?: string }, @AdminAuth() ctx: AdminAuthContext) {
    return this.devices.create(String(body?.label ?? ""), ctx);
  }

  @Post("devices/:id/retire")
  @RequirePermissions("fairplay.edge.admin")
  retireDevice(@Param("id", ParseUUIDPipe) id: string, @AdminAuth() ctx: AdminAuthContext) {
    return this.devices.retire(id, ctx);
  }

  // ── sessions ────────────────────────────────────────────────────────────

  @Get("sessions")
  @RequirePermissions(...ANY_FAIRPLAY)
  async listSessions(@Query("matchId") matchId: string | undefined, @AdminAuth() ctx: AdminAuthContext) {
    if (matchId !== undefined && !/^[0-9a-f-]{36}$/.test(matchId)) throw refusal(400, "MatchIdInvalid", "matchId must be a UUID", "Pass one match id.");
    return jsonSafe(await this.sessions.list(ctx, { matchId }));
  }

  @Post("sessions")
  @RequirePermissions("fairplay.session.manage")
  createSession(@Body() body: { matchId?: string; deviceId?: string; label?: string; mode?: string; angleMode?: string; members?: MemberInput[] },
    @AdminAuth() ctx: AdminAuthContext) {
    if (typeof body?.matchId !== "string" || typeof body?.deviceId !== "string") {
      throw refusal(400, "FieldsRequired", "matchId and deviceId are required", "Pick a match and a paired device.");
    }
    return this.sessions.create({ matchId: body.matchId, deviceId: body.deviceId, label: body.label, mode: body.mode,
      angleMode: body.angleMode, members: members(body.members) }, ctx);
  }

  /** Accounts that could be made members: active, with a FairPlay venue permission on their role. */
  @Get("member-candidates")
  @RequirePermissions("fairplay.session.manage")
  candidates() {
    return this.sessions.candidates();
  }

  @Get("sessions/:id")
  @RequirePermissions(...ANY_FAIRPLAY)
  getSession(@Param("id", ParseUUIDPipe) id: string, @AdminAuth() ctx: AdminAuthContext) {
    return this.sessions.get(id, ctx);
  }

  @Put("sessions/:id/members")
  @RequirePermissions("fairplay.session.manage")
  setMembers(@Param("id", ParseUUIDPipe) id: string, @Body() body: { members?: MemberInput[] }, @AdminAuth() ctx: AdminAuthContext) {
    return this.sessions.setMembers(id, members(body?.members), ctx);
  }

  /** The signed-in member's own matchday PIN. Any venue permission will do; membership is checked. */
  @Put("sessions/:id/members/me/pin")
  @RequirePermissions(...STAFF_PERMISSIONS)
  setMyPin(@Param("id", ParseUUIDPipe) id: string, @Body() body: { pin?: string }, @AdminAuth() ctx: AdminAuthContext) {
    return this.sessions.setMyPin(id, String(body?.pin ?? ""), ctx);
  }

  @Get("sessions/:id/report")
  @RequirePermissions(...ANY_FAIRPLAY)
  async report(@Param("id", ParseUUIDPipe) id: string, @AdminAuth() ctx: AdminAuthContext) {
    return jsonSafe(await this.reports.report(id, ctx));
  }

  /** Staff only: what the Edge has synced for the session, including audit chain status. */
  @Get("sessions/:id/sync")
  @RequirePermissions(...STAFF_PERMISSIONS)
  async syncState(@Param("id", ParseUUIDPipe) id: string, @AdminAuth() ctx: AdminAuthContext) {
    const reader = readerOf(ctx);
    const session = await this.prisma.fairPlaySession.findUnique({ where: { id }, include: { device: { select: { edgeDeviceId: true } } } });
    if (!session) throw refusal(404, "NotFound", `Unknown session ${id}`, "Check the id.");
    assertCompetition(reader, session.competitionId, "session", id);
    const edge = session.device.edgeDeviceId;
    const [records, segments, incidents, reviews, evidence, chain, refused] = await Promise.all([
      this.prisma.fairPlayRecord.groupBy({ by: ["entityType"], where: { sessionId: id }, _count: true }),
      // Segments belong to the device, not the session: recording runs whether a session is open or not.
      this.prisma.fairPlayRecord.count({ where: { deviceId: session.deviceId, entityType: "segment" } }),
      this.prisma.fairPlayIncident.count({ where: { sessionId: id } }),
      this.prisma.fairPlayReview.count({ where: { incident: { sessionId: id } } }),
      this.prisma.fairPlayEvidence.count({ where: { sessionId: id } }),
      edge ? this.prisma.fairPlayEdgeAuditEntry.groupBy({ by: ["chainStatus"], where: { edgeDeviceId: edge }, _count: true, _max: { seq: true } }) : [],
      this.prisma.fairPlaySyncReceipt.findMany({ where: { status: { in: ["rejected", "conflict"] }, deviceId: session.deviceId },
        orderBy: { receivedAt: "desc" }, take: 50, select: { idempotencyKey: true, status: true, message: true, receivedAt: true } }),
    ]);
    const counted = { incident: incidents, review: reviews, evidence, ...Object.fromEntries(records.map((r) => [r.entityType, r._count])), "device segment": segments };
    return { lastSyncAt: session.lastSyncAt, records: Object.fromEntries(Object.entries(counted).filter(([, n]) => n > 0)),
      auditChain: chain.map((c) => ({ status: c.chainStatus, entries: c._count, lastSeq: c._max.seq })), refused };
  }

  // ── evidence ────────────────────────────────────────────────────────────

  @Post("evidence/:id/read-url")
  @RequirePermissions("fairplay.incident.review", "fairplay.evidence.export", "fairplay.session.manage", "fairplay.report.view")
  readUrl(@Param("id", ParseUUIDPipe) id: string, @Body() body: { kind?: string; reason?: string }, @AdminAuth() ctx: AdminAuthContext) {
    return this.evidence.readUrl(id, body?.kind, body?.reason, ctx);
  }

  @Get("usage")
  @RequirePermissions("fairplay.edge.admin", "fairplay.session.manage")
  usage() {
    return this.reports.usage();
  }
}

function members(raw: unknown): MemberInput[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw refusal(400, "MembersInvalid", "members must be a list", "Send [{ adminUserId, permissions }].");
  return raw.map((m) => {
    const item = m as { adminUserId?: unknown; permissions?: unknown };
    if (typeof item?.adminUserId !== "string" || !Array.isArray(item.permissions) || !item.permissions.every((p) => typeof p === "string")) {
      throw refusal(400, "MembersInvalid", "each member is { adminUserId, permissions: string[] }", "Fix the member list.");
    }
    return { adminUserId: item.adminUserId, permissions: item.permissions as string[] };
  });
}
