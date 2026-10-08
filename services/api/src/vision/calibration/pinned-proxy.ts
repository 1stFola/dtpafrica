import type { PrismaClient } from "@prisma/client";
import { refusal } from "../shared/refusals";

/**
 * The asset's current proxy and the checksum a completed transcode recorded for it.
 *
 * A stage that measures the proxy's pixels (camera motion) is pinned to these bytes,
 * so what it measured is what a person calibrates on. Refused when the newest proxy
 * has no matching completed transcode: then nobody can say which bytes it is.
 */
export async function pinnedProxy(db: Pick<PrismaClient, "visionVideoVariant" | "visionJob">, videoAssetId: string): Promise<{ variantId: string; key: string; checksum: string }> {
  const proxy = await db.visionVideoVariant.findFirst({ where: { videoAssetId, kind: "proxy" }, orderBy: { createdAt: "desc" }, select: { id: true, objectKey: true } });
  if (!proxy) throw refusal(409, "ProxyMissing", "This footage has no review proxy yet.", "Run transcode for the asset first.");
  const transcode = await db.visionJob.findFirst({ where: { videoAssetId, type: "transcode", state: "succeeded" }, orderBy: { finishedAt: "desc" } });
  const progress = transcode?.progress as { summary?: { proxy?: { key?: string; checksumSha256?: string } }; artifacts?: { key: string; role: string }[] } | null;
  const declared = progress?.summary?.proxy;
  if (declared?.key !== proxy.objectKey || !/^[a-f0-9]{64}$/i.test(declared?.checksumSha256 ?? "") || !progress?.artifacts?.some((a) => a.role === "proxy" && a.key === proxy.objectKey))
    throw refusal(409, "ProxyUnpinned", "The current proxy has no matching completed checksum evidence.", "Run transcode again with the current worker, so the proxy's checksum is recorded.");
  return { variantId: proxy.id, key: proxy.objectKey, checksum: declared!.checksumSha256!.toLowerCase() };
}
