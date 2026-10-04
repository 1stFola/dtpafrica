import { createHash } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { refusal } from "../shared/refusals";

/**
 * Authenticates a partner holding an upload link.
 *
 * A grassroots club secretary has no DTP account, and creating one for every club
 * is neither realistic nor safe. So they get a token that does exactly one thing:
 * upload one file against one source record.
 *
 * A third auth stack, unrelated to admin sessions and worker tokens. Nothing here
 * can reach an admin endpoint, and an admin session cannot satisfy this — there is
 * a test for both directions.
 */

export type PartnerUploadContext = {
  grantId: string;
  partnerId: string;
  sourceVideoRecordId: string;
  maxBytes: number;
  allowedMimeTypes: string[];
};

export type PartnerUploadRequest = {
  headers: Record<string, string | string[] | undefined>;
  partnerUpload?: PartnerUploadContext;
};

@Injectable()
export class PartnerUploadGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PartnerUploadRequest>();
    const header = req.headers["x-vision-upload-token"];
    const token = typeof header === "string" ? header.trim() : null;

    if (!token) throw refusal(401, "UploadTokenRequired", "Upload token required", "Open the upload link DTP sent you; it carries the token.");

    const grant = await this.prisma.visionPartnerUploadGrant.findUnique({
      where: { tokenHash: createHash("sha256").update(token).digest("hex") },
      select: {
        id: true,
        partnerId: true,
        sourceVideoRecordId: true,
        maxBytes: true,
        allowedMimeTypes: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
      },
    });

    // Unknown, expired, revoked and already-used all read the same to the caller.
    // A partner has no business learning which of the four it was, and the
    // distinctions are in the audit log where they belong.
    if (!grant) throw refusal(401, "UploadLinkInvalid", "Invalid or expired upload link", "Ask DTP for a new upload link.");
    if (grant.revokedAt) throw refusal(401, "UploadLinkInvalid", "Invalid or expired upload link", "Ask DTP for a new upload link.");
    if (grant.expiresAt <= new Date()) throw refusal(401, "UploadLinkInvalid", "Invalid or expired upload link", "Ask DTP for a new upload link.");

    // One grant, one upload. Re-use would let a single link become an open door.
    if (grant.usedAt) {
      throw refusal(403, "UploadLinkUsed", "This upload link has already been used. Ask DTP for a new one.", "Ask DTP for a new upload link.");
    }

    req.partnerUpload = {
      grantId: grant.id,
      partnerId: grant.partnerId,
      sourceVideoRecordId: grant.sourceVideoRecordId,
      maxBytes: Number(grant.maxBytes),
      allowedMimeTypes: grant.allowedMimeTypes,
    };
    return true;
  }
}
