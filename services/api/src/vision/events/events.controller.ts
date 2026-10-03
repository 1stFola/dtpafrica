import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import { CorrectEventDto, DecideEventDto, PromoteEventDto, ProposeEventDto } from "./dto/events.dto";
import { VisionEventsService } from "./events.service";

/**
 * Event candidates: proposed and corrected by a person with `vision.review`,
 * accepted or rejected by a second, and promoted into the match record by one
 * with `vision.publish`. Every write makes a new row or a decision on one;
 * nothing is edited in place.
 */
@Controller("vision/review")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionEventsController {
  constructor(@Inject(VisionEventsService) private readonly events: VisionEventsService) {}

  @Get(":assetId/events")
  @RequirePermissions("vision.read")
  async forAsset(@Param("assetId") assetId: string, @Query("all") all?: string) {
    return jsonSafe(await this.events.forAsset(assetId, all === "1" || all === "true"));
  }

  @Get("events/:id")
  @RequirePermissions("vision.read")
  async get(@Param("id") id: string) {
    return jsonSafe(await this.events.get(id));
  }

  /** What this person should look at next, across the footage or on one asset; their own proposals are not in it. */
  @Get("queue")
  @RequirePermissions("vision.review")
  async queue(@AdminAuth() auth: AdminAuthContext, @Query("assetId") assetId?: string, @Query("limit") limit?: string) {
    const parsed = limit ? Number(limit) : undefined;
    return jsonSafe(await this.events.queue({ assetId: assetId || undefined, limit: Number.isFinite(parsed) ? parsed : undefined }, auth));
  }

  @Post("events")
  @RequirePermissions("vision.review")
  async propose(@Body() dto: ProposeEventDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.events.propose(dto, auth));
  }

  @Patch("events/:id")
  @RequirePermissions("vision.review")
  async correct(@Param("id") id: string, @Body() dto: CorrectEventDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.events.correct(id, dto, auth));
  }

  @Post("events/:id/decision")
  @RequirePermissions("vision.review")
  async decide(@Param("id") id: string, @Body() dto: DecideEventDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.events.decide(id, dto.decision, dto.reason, auth));
  }

  @Post("events/:id/promote")
  @RequirePermissions("vision.publish")
  async promote(@Param("id") id: string, @Body() dto: PromoteEventDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.events.promote(id, { create: dto.create ?? false }, auth));
  }
}
