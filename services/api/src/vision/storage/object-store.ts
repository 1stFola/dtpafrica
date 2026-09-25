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

export type UploadedPart = PartRef & {
  bytes: number;
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

  /**
   * What the store actually holds for an in-flight upload.
   *
   * The authoritative answer for resume. A client that died mid-upload never
   * reported its last parts, and over an unreliable connection that is the normal
   * case rather than the exception — so the server asks the store rather than
   * trusting its own record of what it was told.
   */
  listParts(bucket: BucketId, key: string, uploadId: string): Promise<UploadedPart[]>;
  abortMultipartUpload(bucket: BucketId, key: string, uploadId: string): Promise<void>;

  head(bucket: BucketId, key: string): Promise<ObjectMeta | null>;
  list(bucket: BucketId, prefix: string, cursor?: string): Promise<ObjectPage>;
  /**
   * Delete an object from a regenerable bucket.
   *
   * Refuses outright on a write-once bucket — see `deleteProtected`. Write-once
   * enforcement stops an *overwrite*; without this, it did nothing about a
   * delete, which is the one loss that cannot be undone while bucket versioning
   * is off.
   */
  delete(bucket: BucketId, key: string): Promise<void>;

  /**
   * Delete from a write-once bucket. The only way to remove source media or
   * rights evidence.
   *
   * Deliberately awkward: a separate method name that is trivial to grep for in
   * review, and a `justification` that cannot be omitted. Callers are expected
   * to have an approved deletion request, and to write an audit entry.
   */
  deleteProtected(bucket: BucketId, key: string, justification: string): Promise<void>;
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

export class WriteOnceDeleteError extends Error {
  constructor(bucket: string, key: string) {
    super(
      `Refusing to delete ${bucket}/${key}: this bucket is write-once. ` +
        `Removing source media or rights evidence requires deleteProtected() ` +
        `with a justification, and an approved deletion request.`
    );
    this.name = "WriteOnceDeleteError";
  }
}

export class MissingJustificationError extends Error {
  constructor(bucket: string, key: string) {
    super(`deleteProtected(${bucket}/${key}) requires a non-empty justification.`);
    this.name = "MissingJustificationError";
  }
}
