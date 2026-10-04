import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CompleteUploadDto, SignPartsDto } from "./dto/upload.dto";
import { PartnerUploadGuard, type PartnerUploadRequest } from "./partner-upload.guard";
import { PartnerBeginUploadDto } from "./dto/partner-upload.dto";
import { VisionUploadService } from "./upload.service";
import { refusal } from "../shared/refusals";

/**
 * Partner-facing upload, authenticated by a one-use link.
 *
 * Everything a club secretary needs and nothing else. There is no source record to
 * choose, no partner to name, no asset id to know: the grant already decides all
 * of that, so the only decision left is which file.
 *
 * Bytes go straight to object storage. This API only ever returns metadata and
 * signed URLs.
 */
@Controller("vision/partner-uploads")
@UseGuards(PartnerUploadGuard)
export class VisionPartnerUploadsController {
  constructor(@Inject(VisionUploadService) private readonly uploads: VisionUploadService) {}

  /** What this link is for, so a client can show it before uploading anything. */
  @Get("grant")
  grant(@Req() req: PartnerUploadRequest) {
    const ctx = this.ctx(req);
    return {
      sourceVideoRecordId: ctx.sourceVideoRecordId,
      maxBytes: ctx.maxBytes,
      allowedMimeTypes: ctx.allowedMimeTypes,
    };
  }

  @Post()
  begin(@Req() req: PartnerUploadRequest, @Body() dto: PartnerBeginUploadDto) {
    const ctx = this.ctx(req);

    // Constrained by the grant, not by the request: a partner cannot widen its own
    // permission by asking for a different type or a larger file.
    if (!ctx.allowedMimeTypes.includes(dto.mimeType)) {
      throw refusal(400, "FileTypeNotAccepted", `This link accepts ${ctx.allowedMimeTypes.join(", ")}. Got ${dto.mimeType}.`, "Upload the footage as one of the accepted types.");
    }
    if (dto.expectedBytes !== undefined && dto.expectedBytes > ctx.maxBytes) {
      throw refusal(400, "FileTooLarge", `This link accepts up to ${ctx.maxBytes} bytes. Contact DTP if the file is larger.`, "Contact DTP for a link that accepts a larger file.");
    }

    return this.uploads.begin(
      {
        // The source is fixed by the grant. A partner never names it.
        sourceVideoRecordId: ctx.sourceVideoRecordId,
        mimeType: dto.mimeType,
        expectedBytes: dto.expectedBytes,
        extension: dto.extension,
      },
      undefined,
      ctx.grantId
    );
  }

  /** The resume endpoint. Scoped to this grant's own session. */
  @Get(":id")
  view(@Req() req: PartnerUploadRequest, @Param("id") id: string) {
    return this.uploads.view(id, this.ctx(req).grantId);
  }

  @Post(":id/parts")
  async signParts(
    @Req() req: PartnerUploadRequest,
    @Param("id") id: string,
    @Body() dto: SignPartsDto
  ) {
    return { parts: await this.uploads.signParts(id, dto.partNumbers, this.ctx(req).grantId) };
  }

  @Post(":id/complete")
  complete(
    @Req() req: PartnerUploadRequest,
    @Param("id") id: string,
    @Body() dto: CompleteUploadDto
  ) {
    return this.uploads.complete(id, dto.parts, undefined, {
      grantId: this.ctx(req).grantId,
      // A partner does not decide whether DTP analyses the footage; the rights
      // engine does, and it is consulted when the jobs are queued.
      enqueueIngest: true,
    });
  }

  private ctx(req: PartnerUploadRequest) {
    if (!req.partnerUpload) throw refusal(403, "UploadLinkContextMissing", "Upload link context missing", "Open the upload link again. If it keeps happening, tell DTP.");
    return req.partnerUpload;
  }
}
