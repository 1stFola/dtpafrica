import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadVisionConfig } from "../config/vision.config";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { VisionUploadService } from "./upload.service";

/**
 * Resumable upload.
 *
 * The gate for this increment is the interruption test: a client that dies
 * mid-upload must be able to finish without re-sending what already landed. A
 * 6 GB master over an unstable Nigerian link will be interrupted, and if an
 * interruption means starting again then partners stop uploading and the corpus
 * never gets built.
 */

const RECORD = "rec-1";
const PARTNER = "partner-1";

const mockPrisma = {
  visionSourceVideoRecord: { findUnique: vi.fn() },
  visionRightsEvidence: { count: vi.fn() },
  visionVideoAsset: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  visionUploadSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  visionPartnerUploadGrant: { update: vi.fn() },
  $transaction: vi.fn(),
};

const mockAudit = { record: vi.fn() };
const mockJobs = { enqueueForAsset: vi.fn() };

let store: InMemoryObjectStore;
let service: VisionUploadService;
let session: Record<string, unknown>;

function authorisedRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD,
    partnerId: PARTNER,
    acquisitionStatus: "authorized",
    acquisitionMethod: "partner_direct_upload",
    _count: { videoAssets: 0 },
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    videoAssetId: "asset-1",
    grantId: null,
    bucketId: "master",
    objectKey: "originals/asset-1/source.mp4",
    providerUploadId: "upload-1",
    partSizeBytes: 16 * 1024 * 1024,
    expectedBytes: null,
    bytesReceived: BigInt(0),
    receivedParts: [],
    state: "in_progress",
    expiresAt: new Date(Date.now() + 86_400_000),
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store = new InMemoryObjectStore();
  service = new VisionUploadService(
    mockPrisma as never,
    store,
    mockAudit as never,
    mockJobs as never,
    loadVisionConfig({})
  );

  session = makeSession();
  mockPrisma.visionSourceVideoRecord.findUnique.mockResolvedValue(authorisedRecord());
  mockPrisma.visionRightsEvidence.count.mockResolvedValue(1);
  mockPrisma.visionUploadSession.findUnique.mockImplementation(async () => session);
  mockPrisma.visionUploadSession.create.mockImplementation(async () => session);
  mockPrisma.visionUploadSession.update.mockImplementation(async ({ data }) => {
    Object.assign(session, data);
    return session;
  });
  mockPrisma.visionUploadSession.findMany.mockResolvedValue([]);
  mockPrisma.visionVideoAsset.create.mockResolvedValue({ id: "asset-1" });
  mockPrisma.visionVideoAsset.update.mockResolvedValue({});
  mockPrisma.visionVideoAsset.delete.mockResolvedValue({});
  mockJobs.enqueueForAsset.mockResolvedValue({ id: "job-1" });
  // Run transaction callbacks against the same mock client.
  mockPrisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(mockPrisma) : arg
  );
});

// Refusing at the door. Refusing after 6 GB has landed would be useless and
// expensive.
describe("rights are checked before a single byte is accepted", () => {
  it("refuses a catalogue-only source", async () => {
    mockPrisma.visionSourceVideoRecord.findUnique.mockResolvedValue(
      authorisedRecord({ acquisitionStatus: "catalogued" })
    );
    await expect(
      service.begin({ sourceVideoRecordId: RECORD, mimeType: "video/mp4" })
    ).rejects.toThrow(ForbiddenException);
  });

  it("refuses a source whose acquisition was declined", async () => {
    mockPrisma.visionSourceVideoRecord.findUnique.mockResolvedValue(
      authorisedRecord({ acquisitionStatus: "refused" })
    );
    await expect(
      service.begin({ sourceVideoRecordId: RECORD, mimeType: "video/mp4" })
    ).rejects.toThrow(ForbiddenException);
  });

  it("refuses when no acquisition method is recorded", async () => {
    mockPrisma.visionSourceVideoRecord.findUnique.mockResolvedValue(
      authorisedRecord({ acquisitionMethod: null })
    );
    await expect(
      service.begin({ sourceVideoRecordId: RECORD, mimeType: "video/mp4" })
    ).rejects.toThrow(ForbiddenException);
  });

  // The document is what the whole claim rests on.
  it("refuses when no rights evidence is attached for the partner", async () => {
    mockPrisma.visionRightsEvidence.count.mockResolvedValue(0);
    await expect(
      service.begin({ sourceVideoRecordId: RECORD, mimeType: "video/mp4" })
    ).rejects.toThrow(ForbiddenException);
  });

  it("names the remediation so an operator knows what to fix", async () => {
    mockPrisma.visionRightsEvidence.count.mockResolvedValue(0);
    await service.begin({ sourceVideoRecordId: RECORD, mimeType: "video/mp4" }).catch((error) => {
      expect(error.getResponse()).toMatchObject({
        error: "RightsDenied",
        reason: "no_scope",
        remediation: expect.stringContaining("signed agreement"),
      });
    });
  });

  it("404s an unknown source record", async () => {
    mockPrisma.visionSourceVideoRecord.findUnique.mockResolvedValue(null);
    await expect(
      service.begin({ sourceVideoRecordId: "nope", mimeType: "video/mp4" })
    ).rejects.toThrow(NotFoundException);
  });

  it("opens a session for an authorised source with evidence", async () => {
    const view = await service.begin({
      sourceVideoRecordId: RECORD,
      mimeType: "video/mp4",
      expectedBytes: 6_000_000_000,
    });
    expect(view.state).toBe("in_progress");
    expect(view.bucket).toBe("master");
    expect(view.partSizeBytes).toBe(16 * 1024 * 1024);
  });
});

describe("the interruption test", () => {
  beforeEach(async () => {
    const created = await store.createMultipartUpload("master", session.objectKey as string, "video/mp4");
    session.providerUploadId = created.uploadId;
  });

  /**
   * The gate. Parts 1 and 2 land, the connection dies, and the client comes back
   * to a server that can tell it exactly what is missing.
   */
  it("reports what already landed so a resuming client sends only the gap", async () => {
    store.putPart(session.providerUploadId as string, 1, "A".repeat(100));
    store.putPart(session.providerUploadId as string, 2, "B".repeat(100));

    const view = await service.view("session-1");

    expect(view.receivedParts.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(view.bytesReceived).toBe(200);
    expect(view.nextPartNumber).toBe(3);
  });

  it("asks the store rather than trusting what the client reported", async () => {
    // The client died before reporting part 2, so the recorded state is stale.
    session.receivedParts = [{ partNumber: 1, etag: "etag-1", bytes: 100 }];
    store.putPart(session.providerUploadId as string, 1, "A".repeat(100));
    store.putPart(session.providerUploadId as string, 2, "B".repeat(100));

    const view = await service.view("session-1");
    expect(view.receivedParts.map((p) => p.partNumber)).toEqual([1, 2]);
  });

  it("completes from the store's part list even when the client reports nothing", async () => {
    store.putPart(session.providerUploadId as string, 1, "A".repeat(50));
    store.putPart(session.providerUploadId as string, 2, "B".repeat(50));

    const result = await service.complete("session-1", undefined);

    expect(result.state).toBe("completed");
    expect((await store.getSmallObject("master", session.objectKey as string))?.toString()).toBe(
      "A".repeat(50) + "B".repeat(50)
    );
  });

  // A gap means a part was lost. Completing anyway produces a silently truncated
  // master, which is the worst outcome available here.
  it("refuses to complete with a gap rather than truncating the master", async () => {
    store.putPart(session.providerUploadId as string, 1, "A");
    store.putPart(session.providerUploadId as string, 3, "C");

    await expect(service.complete("session-1", undefined)).rejects.toThrow(/part\(s\) 2 are missing/);
    expect(await store.head("master", session.objectKey as string)).toBeNull();
  });

  it("survives a store that cannot answer, falling back to recorded parts", async () => {
    session.receivedParts = [{ partNumber: 1, etag: "etag-1", bytes: 42 }];
    vi.spyOn(store, "listParts").mockRejectedValueOnce(new Error("store unavailable"));

    const view = await service.view("session-1");
    expect(view.receivedParts.map((p) => p.partNumber)).toEqual([1]);
  });

  it("re-issues part URLs, because they expire mid-upload", async () => {
    const parts = await service.signParts("session-1", [3, 4]);
    expect(parts.map((p) => p.partNumber)).toEqual([3, 4]);
    expect(parts[0]!.expiresInSeconds).toBe(900);
  });

  it("refuses new part URLs once the session is finished", async () => {
    session.state = "completed";
    await expect(service.signParts("session-1", [1])).rejects.toThrow(BadRequestException);
  });
});

describe("completion", () => {
  beforeEach(async () => {
    const created = await store.createMultipartUpload("master", session.objectKey as string, "video/mp4");
    session.providerUploadId = created.uploadId;
    store.putPart(created.uploadId, 1, "payload");
  });

  it("records the real byte count from the store, not the client's estimate", async () => {
    session.expectedBytes = BigInt(999_999);
    const result = await service.complete("session-1", undefined);
    expect(result.bytesReceived).toBe("payload".length);
  });

  it("marks the asset uploaded so ingestion can proceed", async () => {
    await service.complete("session-1", undefined);
    const assetUpdate = mockPrisma.visionVideoAsset.update.mock.calls.at(-1)![0].data;
    expect(assetUpdate.ingestState).toBe("uploaded");
  });

  // Deterministic ingestion starts itself; both stages are cheap and need no
  // match linkage.
  it("queues probe and fingerprint", async () => {
    const result = await service.complete("session-1", undefined);
    const queued = mockJobs.enqueueForAsset.mock.calls.map((c) => c[0].type);
    expect(queued).toEqual(["probe", "fingerprint"]);
    expect(result.jobsQueued).toHaveLength(2);
  });

  it("can be told not to queue anything", async () => {
    await service.complete("session-1", undefined, undefined, { enqueueIngest: false });
    expect(mockJobs.enqueueForAsset).not.toHaveBeenCalled();
  });

  // The bytes are safely stored. A missing analysis grant is a reason to queue
  // later, not to make a finished upload look failed.
  it("still completes when auto-queueing is refused", async () => {
    mockJobs.enqueueForAsset.mockRejectedValue(new Error("RightsDenied"));
    const result = await service.complete("session-1", undefined);
    expect(result.state).toBe("completed");
    expect(result.jobsQueued).toEqual([]);
  });

  it("is idempotent: completing twice returns the same answer", async () => {
    await service.complete("session-1", undefined);
    const again = await service.complete("session-1", undefined);
    expect(again.state).toBe("completed");
    expect(again.jobsQueued).toEqual([]);
  });

  it("marks a partner grant used, so one grant means one upload", async () => {
    session.grantId = "grant-1";
    await service.complete("session-1", undefined, undefined, { grantId: "grant-1" });
    expect(mockPrisma.visionPartnerUploadGrant.update).toHaveBeenCalledWith({
      where: { id: "grant-1" },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("refuses a session with no parts at all", async () => {
    const empty = await store.createMultipartUpload("master", "originals/other/source.mp4", "video/mp4");
    session.providerUploadId = empty.uploadId;
    session.objectKey = "originals/other/source.mp4";
    await expect(service.complete("session-1", undefined)).rejects.toThrow(/No parts/);
  });
});

// A partner holds a grant, not an account.
describe("a partner grant is scoped to its own session", () => {
  it("hides another session behind a 404 rather than a 403", async () => {
    session.grantId = "grant-1";
    await expect(service.view("session-1", "someone-elses-grant")).rejects.toThrow(
      NotFoundException
    );
  });

  it("allows the holder through", async () => {
    session.grantId = "grant-1";
    const view = await service.view("session-1", "grant-1");
    expect(view.id).toBe("session-1");
  });
});

describe("abandonment", () => {
  it("aborts the store's partial upload and removes the placeholder asset", async () => {
    const created = await store.createMultipartUpload("master", session.objectKey as string, "video/mp4");
    session.providerUploadId = created.uploadId;
    store.putPart(created.uploadId, 1, "x");

    await service.abort("session-1");

    expect(session.state).toBe("aborted");
    // The asset never held bytes; leaving a permanent "uploading" row nothing will
    // finish is worse than removing it.
    expect(mockPrisma.visionVideoAsset.delete).toHaveBeenCalled();
    expect(await store.head("master", session.objectKey as string)).toBeNull();
  });

  it("refuses to abort a completed session", async () => {
    session.state = "completed";
    await expect(service.abort("session-1")).rejects.toThrow(BadRequestException);
  });

  /**
   * An abandoned multipart upload is billed by the object store indefinitely and
   * appears in no listing, so nothing surfaces it except this sweep.
   */
  it("expires sessions past their deadline and releases the storage", async () => {
    const created = await store.createMultipartUpload("master", "originals/stale/source.mp4", "video/mp4");
    mockPrisma.visionUploadSession.findMany.mockResolvedValue([
      {
        id: "stale-1",
        bucketId: "master",
        objectKey: "originals/stale/source.mp4",
        providerUploadId: created.uploadId,
        videoAssetId: "asset-stale",
      },
    ]);

    const result = await service.expireStale();

    expect(result.expired).toEqual(["stale-1"]);
    const assetUpdate = mockPrisma.visionVideoAsset.update.mock.calls.at(-1)![0].data;
    expect(assetUpdate).toMatchObject({ ingestState: "failed" });
    expect(assetUpdate.ingestError).toMatch(/expired/);
  });
});
