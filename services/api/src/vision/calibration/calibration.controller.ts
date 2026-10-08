import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { jsonSafe } from "../shared/json-safe";
import { VisionCalibrationService } from "./calibration.service";
import { CalibrateDto, DeclareSegmentDto, SetSegmentKindDto } from "./dto/calibration.dto";
import { DEFAULT_PITCH, pitchLandmarks, pitchProblem } from "./pitch-model";

/**
 * Calibration: the landmark catalogue, a segment's declaration and calibration by a
 * person, the editor's live preview, and a track's positions in metres under the
 * suppression rule.
 */
@Controller("vision")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionCalibrationController {
  constructor(@Inject(VisionCalibrationService) private readonly calibration: VisionCalibrationService) {}

  @Get("calibration/landmarks")
  @RequirePermissions("vision.read")
  landmarks(@Query("lengthM") lengthM?: string, @Query("widthM") widthM?: string) {
    const pitch = lengthM || widthM ? { lengthM: Number(lengthM), widthM: Number(widthM) } : DEFAULT_PITCH;
    const problem = pitchProblem(pitch);
    return { pitch, problem, landmarks: problem ? [] : pitchLandmarks(pitch) };
  }

  @Post("calibration/preview")
  @RequirePermissions("vision.read")
  preview(@Body() dto: CalibrateDto) {
    return this.calibration.preview(dto.points, dto.pitch ?? DEFAULT_PITCH);
  }

  @Get("review/:assetId/camera-segments")
  @RequirePermissions("vision.read")
  async segments(@Param("assetId") assetId: string) {
    return jsonSafe(await this.calibration.segments(assetId));
  }

  @Post("review/:assetId/camera-segments")
  @RequirePermissions("vision.review")
  async declare(@Param("assetId") assetId: string, @Body() dto: DeclareSegmentDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.calibration.declareSegment(assetId, dto, auth));
  }

  /** A person says what a segment is; a proposal they label becomes their declaration. */
  @Patch("review/camera-segments/:id")
  @RequirePermissions("vision.review")
  async setKind(@Param("id") id: string, @Body() dto: SetSegmentKindDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.calibration.setSegmentKind(id, dto.kind, auth));
  }

  @Delete("review/camera-segments/:id")
  @RequirePermissions("vision.review")
  async remove(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.calibration.deleteSegment(id, auth));
  }

  @Post("review/camera-segments/:id/calibration")
  @RequirePermissions("vision.review")
  async calibrate(@Param("id") id: string, @Body() dto: CalibrateDto, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.calibration.calibrate(id, { points: dto.points, pitch: dto.pitch, keyframe: dto.keyframe }, auth));
  }

  /** One frame's carried calibration and the pitch lines it draws, from the latest calibrate run. */
  @Get("review/:assetId/calibration/frames/:frame")
  @RequirePermissions("vision.read")
  async carried(@Param("assetId") assetId: string, @Param("frame") frame: string) {
    return jsonSafe(await this.calibration.carriedAt(assetId, Number(frame)));
  }

  /** A person takes a keyframe back; the frames it reached lose it. */
  @Post("review/calibrations/:id/withdraw")
  @RequirePermissions("vision.review")
  async withdraw(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    return jsonSafe(await this.calibration.withdrawKeyframe(id, auth));
  }

  @Get("review/:assetId/game-state")
  @RequirePermissions("vision.read")
  async gameState(@Param("assetId") assetId: string) {
    return jsonSafe(await this.calibration.gameState(assetId));
  }

  @Get("review/tracks/:trackId/pitch-positions")
  @RequirePermissions("vision.read")
  async pitchPositions(@Param("trackId") trackId: string) {
    return jsonSafe(await this.calibration.pitchPositions(trackId));
  }
}
