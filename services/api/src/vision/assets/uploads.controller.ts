import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { BeginUploadDto, CompleteUploadDto, SignPartsDto } from "./dto/upload.dto";
import { VisionUploadService } from "./upload.service";

/**
 * Staff-facing resumable upload.
 *
 * Bytes never traverse this API. Every route here returns metadata or a signed
 * URL; the client PUTs directly to object storage. That is what keeps a 2 vCPU
 * control plane out of the path of a 6 GB file.
 */
@Controller("vision/uploads")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionUploadsController {
  constructor(@Inject(VisionUploadService) private readonly uploads: VisionUploadService) {}

  @Post()
  @RequirePermissions("vision.assets.upload")
  begin(@Body() dto: BeginUploadDto, @AdminAuth() auth: AdminAuthContext) {
    return this.uploads.begin(dto, auth);
  }

  /**
   * The resume endpoint.
   *
   * A client returning after an interruption asks here first and uploads only the
   * parts that are missing.
   */
  @Get(":id")
  @RequirePermissions("vision.assets.upload")
  view(@Param("id") id: string) {
    return this.uploads.view(id);
  }

  @Post(":id/parts")
  @RequirePermissions("vision.assets.upload")
  async signParts(@Param("id") id: string, @Body() dto: SignPartsDto) {
    return { parts: await this.uploads.signParts(id, dto.partNumbers) };
  }

  @Post(":id/complete")
  @RequirePermissions("vision.assets.upload")
  complete(
    @Param("id") id: string,
    @Body() dto: CompleteUploadDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    return this.uploads.complete(id, dto.parts, auth, { enqueueIngest: dto.enqueueIngest });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("vision.assets.upload")
  async abort(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    await this.uploads.abort(id, auth);
  }
}
