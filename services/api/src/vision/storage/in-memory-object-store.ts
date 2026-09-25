import { WRITE_ONCE_BUCKETS, type BucketId } from "@dtp/vision-contracts";
import {
  WriteOnceViolationError,
  type ObjectMeta,
  type ObjectPage,
  type ObjectStore,
  type PartRef,
  type PutConstraints,
} from "./object-store";

type StoredObject = {
  body: Buffer;
  contentType: string | null;
  lastModified: Date;
};

type StoredUpload = {
  bucket: BucketId;
  key: string;
  contentType: string;
  parts: Map<number, Buffer>;
};

/**
 * In-memory ObjectStore for tests and local development.
 *
 * Faithful about the behaviours the domain depends on: write-once enforcement on
 * the master bucket, multipart assembly in part order, and presigned URLs that
 * carry their expiry so a test can assert a TTL was requested.
 */
export class InMemoryObjectStore implements ObjectStore {
  readonly backendId = "in-memory";

  private readonly objects = new Map<string, StoredObject>();
  private readonly uploads = new Map<string, StoredUpload>();
  private uploadCounter = 0;

  /** Every presign issued, so tests can assert on TTLs and methods. */
  readonly issuedUrls: { method: string; bucket: BucketId; key: string; ttlSeconds: number }[] = [];

  private id(bucket: BucketId, key: string) {
    return `${bucket}/${key}`;
  }

  private sign(method: string, bucket: BucketId, key: string, ttlSeconds: number, extra = "") {
    this.issuedUrls.push({ method, bucket, key, ttlSeconds });
    const expires = Date.now() + ttlSeconds * 1000;
    return `memory://${bucket}/${key}?method=${method}&expires=${expires}${extra}`;
  }

  async presignGet(bucket: BucketId, key: string, ttlSeconds: number) {
    return this.sign("GET", bucket, key, ttlSeconds);
  }

  async presignPut(
    bucket: BucketId,
    key: string,
    ttlSeconds: number,
    opts?: PutConstraints
  ) {
    this.assertWritable(bucket, key);
    const extra = opts?.contentType ? `&contentType=${encodeURIComponent(opts.contentType)}` : "";
    return this.sign("PUT", bucket, key, ttlSeconds, extra);
  }

  async createMultipartUpload(bucket: BucketId, key: string, contentType: string) {
    this.assertWritable(bucket, key);
    const uploadId = `upload-${++this.uploadCounter}`;
    this.uploads.set(uploadId, { bucket, key, contentType, parts: new Map() });
    return { uploadId };
  }

  async presignUploadPart(
    bucket: BucketId,
    key: string,
    uploadId: string,
    partNumber: number,
    ttlSeconds: number
  ) {
    if (!this.uploads.has(uploadId)) {
      throw new Error(`Unknown upload ${uploadId}`);
    }
    return this.sign("PUT_PART", bucket, key, ttlSeconds, `&uploadId=${uploadId}&part=${partNumber}`);
  }

  /** Test helper: simulate a client PUT of one part. */
  putPart(uploadId: string, partNumber: number, body: Buffer | string) {
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new Error(`Unknown upload ${uploadId}`);
    upload.parts.set(partNumber, Buffer.from(body));
    return { partNumber, etag: `etag-${uploadId}-${partNumber}` };
  }

  async completeMultipartUpload(
    _bucket: BucketId,
    _key: string,
    uploadId: string,
    parts: PartRef[]
  ) {
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new Error(`Unknown upload ${uploadId}`);

    // Assemble in the order the caller declared, not insertion order: an upload
    // that resumed will have received parts out of sequence.
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const missing = ordered.filter((p) => !upload.parts.has(p.partNumber));
    if (missing.length) {
      throw new Error(`Missing parts: ${missing.map((p) => p.partNumber).join(", ")}`);
    }

    const body = Buffer.concat(ordered.map((p) => upload.parts.get(p.partNumber)!));
    this.objects.set(this.id(upload.bucket, upload.key), {
      body,
      contentType: upload.contentType,
      lastModified: new Date(),
    });
    this.uploads.delete(uploadId);
    return { etag: `etag-${uploadId}` };
  }

  async abortMultipartUpload(_bucket: BucketId, _key: string, uploadId: string) {
    this.uploads.delete(uploadId);
  }

  async head(bucket: BucketId, key: string): Promise<ObjectMeta | null> {
    const obj = this.objects.get(this.id(bucket, key));
    if (!obj) return null;
    return {
      bucket,
      key,
      bytes: obj.body.byteLength,
      contentType: obj.contentType,
      etag: `etag-${obj.body.byteLength}`,
      lastModified: obj.lastModified,
    };
  }

  async list(bucket: BucketId, prefix: string): Promise<ObjectPage> {
    const wanted = `${bucket}/${prefix}`;
    const keys = [...this.objects.keys()]
      .filter((id) => id.startsWith(wanted))
      .map((id) => id.slice(bucket.length + 1))
      .sort();
    return { keys, cursor: null };
  }

  async delete(bucket: BucketId, key: string) {
    this.objects.delete(this.id(bucket, key));
  }

  async copy(
    from: { bucket: BucketId; key: string },
    to: { bucket: BucketId; key: string }
  ) {
    const src = this.objects.get(this.id(from.bucket, from.key));
    if (!src) throw new Error(`Cannot copy missing object ${from.bucket}/${from.key}`);
    this.assertWritable(to.bucket, to.key);
    this.objects.set(this.id(to.bucket, to.key), { ...src, lastModified: new Date() });
  }

  async putSmallObject(
    bucket: BucketId,
    key: string,
    body: Buffer | string,
    contentType: string
  ) {
    this.assertWritable(bucket, key);
    this.objects.set(this.id(bucket, key), {
      body: Buffer.from(body),
      contentType,
      lastModified: new Date(),
    });
  }

  async getSmallObject(bucket: BucketId, key: string) {
    return this.objects.get(this.id(bucket, key))?.body ?? null;
  }

  private assertWritable(bucket: BucketId, key: string) {
    if (WRITE_ONCE_BUCKETS.includes(bucket) && this.objects.has(this.id(bucket, key))) {
      throw new WriteOnceViolationError(bucket, key);
    }
  }

  /** Test helper. */
  seed(bucket: BucketId, key: string, body: Buffer | string, contentType = "application/octet-stream") {
    this.objects.set(this.id(bucket, key), {
      body: Buffer.from(body),
      contentType,
      lastModified: new Date(),
    });
  }

  get objectCount() {
    return this.objects.size;
  }
}
