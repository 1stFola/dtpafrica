import type { BucketId } from "@dtp/vision-contracts";

/**
 * The object storage port.
 *
 * Domain code depends on this and never on a storage vendor. `BucketId` is a
 * logical name that configuration maps to a real bucket, so staging and
 * production differ only in config. See docs/vision/05-STORAGE.md.
 */

export type ObjectMeta = {
  bucket: BucketId;
  key: string;
  bytes: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
};

export type ObjectPage = {
  keys: string[];
  cursor: string | null;
};

export type PartRef = {
  partNumber: number;
  etag: string;
};

export type PutConstraints = {
  contentType?: string;
  /** Advisory: signed URL constraints vary by backend, so callers must still
   * validate the finalised object with `head`. */
  maxBytes?: number;
};

export interface ObjectStore {
  readonly backendId: string;

  presignGet(bucket: BucketId, key: string, ttlSeconds: number): Promise<string>;
  presignPut(
    bucket: BucketId,
    key: string,
    ttlSeconds: number,
    opts?: PutConstraints
  ): Promise<string>;

  createMultipartUpload(
    bucket: BucketId,
    key: string,
    contentType: string
  ): Promise<{ uploadId: string }>;
  presignUploadPart(
    bucket: BucketId,
    key: string,
    uploadId: string,
    partNumber: number,
    ttlSeconds: number
  ): Promise<string>;
  completeMultipartUpload(
    bucket: BucketId,
    key: string,
    uploadId: string,
    parts: PartRef[]
  ): Promise<{ etag: string | null }>;
  abortMultipartUpload(bucket: BucketId, key: string, uploadId: string): Promise<void>;

  head(bucket: BucketId, key: string): Promise<ObjectMeta | null>;
  list(bucket: BucketId, prefix: string, cursor?: string): Promise<ObjectPage>;
  /**
   * Low-level delete.
   *
   * Never call this directly from a controller or a domain service: deletions go
   * through a service that checks the deletion policy, writes an audit entry and
   * refuses on the master bucket without an approved deletion request.
   */
  delete(bucket: BucketId, key: string): Promise<void>;
  copy(
    from: { bucket: BucketId; key: string },
    to: { bucket: BucketId; key: string }
  ): Promise<void>;

  /** Small objects only — probe JSON, manifests. Never video. */
  putSmallObject(
    bucket: BucketId,
    key: string,
    body: Buffer | string,
    contentType: string
  ): Promise<void>;
  getSmallObject(bucket: BucketId, key: string): Promise<Buffer | null>;
}

/** Nest DI token. `ObjectStore` is an interface, so it cannot be one itself. */
export const OBJECT_STORE = Symbol("OBJECT_STORE");

export class ObjectNotFoundError extends Error {
  constructor(bucket: string, key: string) {
    super(`Object not found: ${bucket}/${key}`);
    this.name = "ObjectNotFoundError";
  }
}

export class WriteOnceViolationError extends Error {
  constructor(bucket: string, key: string) {
    super(
      `Refusing to overwrite ${bucket}/${key}: this bucket is write-once. ` +
        `Source media and rights evidence are immutable.`
    );
    this.name = "WriteOnceViolationError";
  }
}
