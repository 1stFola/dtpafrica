import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { WRITE_ONCE_BUCKETS, type BucketId } from "@dtp/vision-contracts";
import type { VisionStorageConfig } from "../config/vision.config";
import {
  WriteOnceViolationError,
  type ObjectMeta,
  type ObjectPage,
  type ObjectStore,
  type PartRef,
  type PutConstraints,
} from "./object-store";

/**
 * Cloudflare R2, via its S3-compatible API.
 *
 * This file and the compute adapters are the only places in the Vision module
 * permitted to name a provider. Everything else depends on `ObjectStore` and
 * logical `BucketId`s, so another S3-compatible backend is a new class here and
 * nothing else. See docs/vision/05-STORAGE.md.
 */
export class R2ObjectStore implements ObjectStore {
  readonly backendId = "r2";

  private readonly client: S3Client;

  constructor(private readonly config: VisionStorageConfig) {
    if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
      throw new Error("R2ObjectStore requires an endpoint and credentials");
    }
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // R2 requires path-style addressing.
      forcePathStyle: true,
    });
  }

  private bucketName(bucket: BucketId): string {
    const name = this.config.buckets[bucket];
    if (!name) throw new Error(`No bucket configured for "${bucket}"`);
    return name;
  }

  async presignGet(bucket: BucketId, key: string, ttlSeconds: number) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      { expiresIn: ttlSeconds }
    );
  }

  async presignPut(
    bucket: BucketId,
    key: string,
    ttlSeconds: number,
    opts?: PutConstraints
  ) {
    await this.assertWritable(bucket, key);
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        ContentType: opts?.contentType,
      }),
      { expiresIn: ttlSeconds }
    );
  }

  async createMultipartUpload(bucket: BucketId, key: string, contentType: string) {
    await this.assertWritable(bucket, key);
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        ContentType: contentType,
      })
    );
    if (!res.UploadId) throw new Error(`R2 did not return an upload id for ${bucket}/${key}`);
    return { uploadId: res.UploadId };
  }

  async presignUploadPart(
    bucket: BucketId,
    key: string,
    uploadId: string,
    partNumber: number,
    ttlSeconds: number
  ) {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: ttlSeconds }
    );
  }

  async completeMultipartUpload(
    bucket: BucketId,
    key: string,
    uploadId: string,
    parts: PartRef[]
  ) {
    // S3 requires ascending part numbers. An upload that resumed will have
    // collected its parts out of order.
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const res = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: ordered.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      })
    );
    return { etag: res.ETag ?? null };
  }

  async abortMultipartUpload(bucket: BucketId, key: string, uploadId: string) {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        UploadId: uploadId,
      })
    );
  }

  async head(bucket: BucketId, key: string): Promise<ObjectMeta | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName(bucket), Key: key })
      );
      return {
        bucket,
        key,
        bytes: res.ContentLength ?? 0,
        contentType: res.ContentType ?? null,
        etag: res.ETag ?? null,
        lastModified: res.LastModified ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async list(bucket: BucketId, prefix: string, cursor?: string): Promise<ObjectPage> {
    const res = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucketName(bucket),
        Prefix: prefix,
        ContinuationToken: cursor,
      })
    );
    return {
      keys: (res.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k)),
      cursor: res.NextContinuationToken ?? null,
    };
  }

  async delete(bucket: BucketId, key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: key })
    );
  }

  async copy(
    from: { bucket: BucketId; key: string },
    to: { bucket: BucketId; key: string }
  ) {
    await this.assertWritable(to.bucket, to.key);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucketName(to.bucket),
        Key: to.key,
        CopySource: `${this.bucketName(from.bucket)}/${encodeURIComponent(from.key)}`,
      })
    );
  }

  async putSmallObject(
    bucket: BucketId,
    key: string,
    body: Buffer | string,
    contentType: string
  ) {
    await this.assertWritable(bucket, key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }

  async getSmallObject(bucket: BucketId, key: string) {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key })
      );
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Refuses to overwrite an object in a write-once bucket.
   *
   * Belt and braces alongside R2 versioning: source media and rights evidence
   * are the two things that must never be silently replaced, and a stray PUT is
   * easier to catch here than to detect later from a version history.
   */
  private async assertWritable(bucket: BucketId, key: string) {
    if (!WRITE_ONCE_BUCKETS.includes(bucket)) return;
    const existing = await this.head(bucket, key);
    if (existing) throw new WriteOnceViolationError(bucket, key);
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}
