import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import { AssignIdentityDto, RejectIdentityDto, SetSidesDto } from "./dto/identity.dto";
import { VisionIdentityService } from "./identity.service";

/**
 * The review surface for identity: which team a side is, who a track could be,
 * who a person says it is, and a second person's acceptance. Split, merge,
 * reassign and mark-unknown are all one verb here -- an assignment with a window
 * -- and `GET /vision/assets/:id/identity?public=1` is the only read anything
 * public may make.
 */
@Controller("vision")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionIdentityController {
  constructor(@Inject(VisionIdentityService) private readonly identity: VisionIdentityService) {}

  @Get("review/:assetId/tracks")
  @RequirePermissions("vision.read")
  async reviewTracks(@Param("assetId") assetId: string, @Query("job") job?: string, @Query("limit") limit?: string, @Query("offset") offset?: string) {
    return jsonSafe(await this.identity.forAsset(assetId, { job: job || undefined, limit: wholeNumber(limit), offset: wholeNumber(offset) }));
  }

  @Get("assets/:id/identity")
  @RequirePermissions("vision.read")
  async identityFor(@Param("id") assetId: string, @Query("public") pub?: string, @Query("job") job?: string, @Query("limit") limit?: string, @Query("offset") offset?: string) {
    return jsonSafe(await this.identity.forAsset(assetId, { publicOnly: pub === "1" || pub === "true", job: job || undefined, limit: wholeNumber(limit), offset: wholeNumber(offset) }));
  }

  @Get("review/:assetId/media")
  @RequirePermissions("vision.read")
  async media(@Param("assetId") assetId: string) {
    return jsonSafe(await this.identity.media(assetId));
  }

  /** Every track's positions for the asset's latest track run, in one answer. */
  @Get("review/:assetId/positions")
  @RequirePermissions("vision.read")
  async positionsForAsset(@Param("assetId") assetId: string) {
    return jsonSafe(await this.identity.positionsForAsset(assetId));
  }

  @Get("review/tracks/:trackId/positions")
  @RequirePermissions("vision.read")
  async positions(@Param("trackId") trackId: string) {
    return jsonSafe(await this.identity.positions(trackId));
  }

  @Post("review/jobs/:jobId/sides")
  @RequirePermissions("vision.review")
  async setSides(@Param("jobId") jobId: string, @Body() dto: SetSidesDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.identity.setSides(jobId, { A: dto.A, B: dto.B, override: dto.override }, auth));
  }

  @Get("review/tracks/:trackId/candidates")
  @RequirePermissions("vision.read")
  async candidates(@Param("trackId") trackId: string, @Query("all") all?: string) {
    return jsonSafe(await this.identity.candidates(trackId, all === "1" || all === "true"));
  }

  @Post("review/tracks/:trackId/identity")
  @RequirePermissions("vision.review")
  async assign(@Param("trackId") trackId: string, @Body() dto: AssignIdentityDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(
      await this.identity.assign(
        trackId,
        {
          matchSquadPlayerId: dto.matchSquadPlayerId ?? null,
          validFromMs: dto.validFromMs,
          validToMs: dto.validToMs,
          note: dto.note,
          propagateTo: dto.propagateTo,
          acceptSideMismatch: dto.acceptSideMismatch,
        },
        auth
      )
    );
  }

  @Post("review/identity/:id/accept")
  @RequirePermissions("vision.review")
  async accept(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.identity.accept(id, auth));
  }

  @Post("review/identity/:id/reject")
  @RequirePermissions("vision.review")
  async reject(@Param("id") id: string, @Body() dto: RejectIdentityDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.identity.reject(id, dto.reason, auth));
  }
}

/** A query number, or nothing when it is absent or not a number; the service clamps it. */
function wholeNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
