import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FairPlayStorageConfig } from "../fairplay.config";

/**
 * The evidence bucket: one private R2 bucket, written by the Edge through presigned PUTs and
 * read by people through presigned GETs, so no video passes through the API (ADR-0006).
 *
 * Its own small port rather than Vision's `ObjectStore`: that one is keyed by Vision's
 * closed `BucketId` list and built from Vision's config and key, and FairPlay must reach
 * neither. What this needs is four operations:
 *
 *   presignPut  a URL that only accepts these exact bytes. The length and the SHA-256 are
 *               signed headers, so R2 itself refuses a body of another size or hash;
 *   head        what the bucket holds, asking for the SHA-256 checksum it stored. That is
 *               the check of record, never the ETag (a multipart ETag is not a hash of
 *               anything, and a single-part one is MD5);
 *   presignGet  a read of at most five minutes, as an attachment;
 *   remove      for the retention rule and for refusing a corrupt upload, always with a
 *               reason that the caller audits.
 *
 * Nothing here sets an ACL: R2 has no public objects, the bucket has no public access or
 * custom domain, and a PUT carrying `x-amz-acl` would be refused by the signature.
 */

export type EvidenceObjectHead = { bytes: number; sha256: string | null; etag: string | null };

export type SignedPut = { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };

export interface EvidenceStore {
  readonly backendId: string;
  readonly configured: boolean;
  presignPut(key: string, bytes: number, sha256Hex: string, contentType: string, ttlSeconds: number): Promise<SignedPut>;
  head(key: string): Promise<EvidenceObjectHead | null>;
  presignGet(key: string, ttlSeconds: number, filename: string): Promise<string>;
  remove(key: string, reason: string): Promise<void>;
}

export const EVIDENCE_STORE = Symbol("FAIRPLAY_EVIDENCE_STORE");

export function hexToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

export function base64ToHex(b64: string): string {
  return Buffer.from(b64, "base64").toString("hex");
}

export class R2EvidenceStore implements EvidenceStore {
  readonly backendId = "r2";
  readonly configured = true;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: FairPlayStorageConfig) {
    if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
      throw new Error("R2EvidenceStore requires an endpoint, a bucket and credentials");
    }
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true,
      // The SDK otherwise adds a CRC32 of its own to every request, which a presigned PUT
      // cannot carry for a body it has not seen. The SHA-256 below is the checksum here.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async presignPut(key: string, bytes: number, sha256Hex: string, contentType: string, ttlSeconds: number): Promise<SignedPut> {
    const checksum = hexToBase64(sha256Hex);
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentLength: bytes, ContentType: contentType, ChecksumSHA256: checksum }),
      // Kept as headers, so they are signed and the uploader must send exactly these.
      { expiresIn: ttlSeconds, signableHeaders: new Set(["content-length", "content-type", "x-amz-checksum-sha256"]),
        unhoistableHeaders: new Set(["x-amz-checksum-sha256"]) }
    );
    return {
      url,
      method: "PUT",
      headers: { "content-length": String(bytes), "content-type": contentType, "x-amz-checksum-sha256": checksum },
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  async head(key: string): Promise<EvidenceObjectHead | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: "ENABLED" }));
      return {
        bytes: res.ContentLength ?? 0,
        sha256: res.ChecksumSHA256 ? base64ToHex(res.ChecksumSHA256) : null,
        etag: res.ETag ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async presignGet(key: string, ttlSeconds: number, filename: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"` }),
      { expiresIn: Math.min(ttlSeconds, 300) }
    );
  }

  async remove(key: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error(`removing ${key} needs a reason`);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** No bucket yet: every evidence route refuses, with the reason, and nothing else is affected. */
export class NoEvidenceStore implements EvidenceStore {
  readonly backendId = "off";
  readonly configured = false;
  private fail(): never {
    throw new Error("FairPlay evidence storage is off (FAIRPLAY_STORAGE_BACKEND)");
  }
  presignPut(): Promise<SignedPut> { return this.fail(); }
  head(): Promise<EvidenceObjectHead | null> { return this.fail(); }
  presignGet(): Promise<string> { return this.fail(); }
  remove(): Promise<void> { return this.fail(); }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}
