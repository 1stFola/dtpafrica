import type { PrismaService } from "../../prisma/prisma.service";
import type { ObjectStore } from "../storage/object-store";

/**
 * Whether a partner has rights evidence whose document actually reached the store.
 *
 * An evidence row is created before its bytes land: `beginEvidenceUpload` writes the
 * row and hands out a signed URL, and nothing records whether the PUT ever happened.
 * Counting rows let an unused presign satisfy the upload gate and the acquisition
 * gate (docs/vision/50, PR-4). The document is in the master bucket, so its presence
 * is checked there, newest first, and the first one found is enough.
 */
export async function partnerHasUploadedEvidence(
  prisma: Pick<PrismaService, "visionRightsEvidence">,
  store: Pick<ObjectStore, "head">,
  partnerId: string
): Promise<boolean> {
  const rows = await prisma.visionRightsEvidence.findMany({
    where: { partnerId, NOT: { objectKey: "" } },
    orderBy: { createdAt: "desc" },
    select: { objectKey: true },
    take: 20,
  });
  for (const row of rows) {
    if (await store.head("master", row.objectKey)) return true;
  }
  return false;
}
