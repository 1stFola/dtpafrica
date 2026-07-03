import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../admin/guards/permissions.guard";
import { RequirePermissions } from "../admin/decorators/require-permissions.decorator";
import { PlayerStatsImageUpload } from "./extract-with-openai";
import { extractPlayerStatsFromUploads } from "./extract-player-stats";
import { normalizePlayerStats, toCsv } from "./normalize";

const MAX_IMAGES = 10;
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;

type UploadedPlayerStatsFiles = {
  images?: PlayerStatsImageUpload[];
};

@Controller("admin/player-stats")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class PlayerStatsController {
  @Post("extract")
  @RequirePermissions("calibration.run")
  @UseInterceptors(
    FileFieldsInterceptor([{ name: "images", maxCount: MAX_IMAGES }], {
      limits: { fileSize: MAX_IMAGE_SIZE, files: MAX_IMAGES },
    })
  )
  async extract(
    @UploadedFiles() files: UploadedPlayerStatsFiles,
    @Body("duration") durationRaw?: string
  ) {
    const duration = Number(durationRaw);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 130) {
      throw new BadRequestException(
        "Duration must be a valid number between 1 and 130 minutes."
      );
    }

    const images = files?.images ?? [];
    if (!images.length) {
      throw new BadRequestException("Upload at least one image.");
    }
    if (images.length > MAX_IMAGES) {
      throw new BadRequestException(`Upload a maximum of ${MAX_IMAGES} images.`);
    }

    for (const file of images) {
      if (!file.mimetype?.startsWith("image/")) {
        throw new BadRequestException(`${file.originalname} is not an image.`);
      }
      if (file.buffer.length > MAX_IMAGE_SIZE) {
        throw new BadRequestException(`${file.originalname} is larger than 15MB.`);
      }
    }

    const extracted = await extractPlayerStatsFromUploads(images);
    const normalized = normalizePlayerStats(extracted, duration);
    const csv = toCsv(normalized.row);

    return {
      extracted,
      row: normalized.row,
      csv,
      warnings: normalized.warnings,
    };
  }
}
