import { beforeEach, describe, expect, it, vi } from "vitest";
import { VisionEventImportsService } from "./event-imports.service";
import { eventImportFixture } from "./event-import-fixture";

async function fixture() {
  const f = eventImportFixture(); await f.write();
  let run: any = null; const rows: any[] = [];
  const db: any = { visionVideoAsset: { findUnique: vi.fn(async () => f.asset) }, visionVideoVariant: { findFirst: vi.fn(async () => f.proxy) },
    visionJob: { findFirst: vi.fn(async ({ where }: any) => where.type === "transcode" ? f.transcode : f.job), findMany: vi.fn(async () => [f.job]) },
    visionModelVersion: { findUnique: vi.fn(async () => f.model) }, visionJobEvent: { findFirst: vi.fn(async () => f.log) },
    visionCameraSegment: { findMany: vi.fn(async () => [f.camera]) }, visionTrack: { findMany: vi.fn(async () => [f.track]) },
    visionEventImportRun: { findUnique: vi.fn(async () => run), findMany: vi.fn(async () => run ? [run] : []), create: vi.fn(async ({ data }: any) => { run = { id: "import", ...structuredClone(data) }; return run; }) },
    visionEventCandidate: { create: vi.fn(async ({ data }: any) => { const row = { id: "candidate", ...data }; rows.push(row); return row; }), findMany: vi.fn(async () => rows.filter((r) => r.importPredictionId !== null)) },
    visionEvidenceLink: { createMany: vi.fn() }, visionAuditLog: { create: vi.fn() }, $transaction: vi.fn(async (fn) => fn(db)) };
  const rights = { canAnalyze: vi.fn().mockResolvedValue({ allowed: true }) };
  const service = new VisionEventImportsService(db, f.store, rights as never);
  const actor = { userId: "alice", method: "session" } as never;
  return { f, db, rows, rights, service, actor, get run() { return run; } };
}

describe("immutable carry import", () => {
  it("creates model originals with pinned evidence, no guessed identities and one original mapping", async () => {
    const q = await fixture(); const result = await q.service.importRun("asset", "job", q.actor);
    expect(result).toEqual({ id: "import", imported: true, eventCount: 1, candidateIds: ["candidate"] });
    expect(q.rows[0]).toMatchObject({ method: "model", modelVersionId: "model", actorTrackId: "track-row", actorPlayerId: null, actorMatchSquadPlayerId: null, sbTeamId: null, importRunId: "import", importPredictionId: "carry-1", reviewState: "unreviewed", decidedBy: "alice", proposedBy: "alice" });
    expect(q.db.visionEvidenceLink.createMany.mock.calls[0][0].data.map((e: any) => e.kind)).toEqual(["track", "camera_segment", "calibration"]);
    expect(q.run.snapshot.artifact).toEqual(q.f.artifact);
    expect(q.db.visionAuditLog.create).toHaveBeenCalledTimes(1);
    q.rows[0].supersededBy = "manual-correction";
    q.rows.push({ id: "manual-correction", importRunId: "import", importPredictionId: null, method: "manual", startMs: 400 });
    expect(await q.service.importRun("asset", "job", q.actor)).toMatchObject({ imported: false, candidateIds: ["candidate"] });
    expect(q.db.visionEventCandidate.create).toHaveBeenCalledTimes(1);
    expect(q.db.visionAuditLog.create).toHaveBeenCalledTimes(1);
  });
  it("persists explicit zero output without inventing candidates", async () => {
    const q = await fixture(); q.f.artifact.events = []; await q.f.write();
    expect(await q.service.importRun("asset", "job", q.actor)).toMatchObject({ imported: true, eventCount: 0, candidateIds: [] });
    expect(q.db.visionEventCandidate.create).not.toHaveBeenCalled();
    expect(q.run.snapshot.artifact.events).toEqual([]);
  });
  it.each(["rights", "person", "job id", "checksum", "camera", "calibration", "proxy", "clock", "track", "match"])("refuses bad or stale inputs before creating evidence: %s", async (change) => {
    const q = await fixture(); let actor = q.actor, jobId: any = "job";
    if (change === "rights") q.rights.canAnalyze.mockResolvedValue({ allowed: false });
    if (change === "person") actor = { method: "api-key", userId: null } as never;
    if (change === "job id") jobId = true;
    if (change === "checksum") q.f.asset.checksumSha256 = "f".repeat(64);
    if (change === "camera") q.f.camera.kind = "replay";
    if (change === "calibration") q.f.calibration.id = "new";
    if (change === "proxy") q.f.proxy.width = 900;
    if (change === "clock") q.f.proxy.fps = 30;
    if (change === "track") q.f.track.confirmed = false;
    if (change === "match") q.f.asset.sbMatchId = null;
    await expect(q.service.importRun("asset", jobId, actor)).rejects.toBeDefined();
    expect(q.db.visionEventImportRun.create).not.toHaveBeenCalled();
    expect(q.db.visionEventCandidate.create).not.toHaveBeenCalled();
  });
  it.each(["source", "duration", "match", "camera", "calibration", "clock", "track", "rights"])("marks every stored descendant stale when %s changes", async (change) => {
    const q = await fixture(); await q.service.importRun("asset", "job", q.actor);
    if (change === "source") q.f.asset.checksumSha256 = "f".repeat(64);
    if (change === "duration") q.f.asset.durationMs += 40;
    if (change === "match") q.f.asset.sbMatchId = "other";
    if (change === "camera") q.f.camera.endMs = 1990;
    if (change === "calibration") q.f.calibration.thresholdsVersion = "new";
    if (change === "clock") q.f.proxy.sourceOffsetMs = 40;
    if (change === "track") q.f.track.confirmed = false;
    if (change === "rights") q.rights.canAnalyze.mockResolvedValue({ allowed: false });
    expect(await q.service.current(q.run)).toBe(false);
    await expect(q.service.assertCurrent(q.run)).rejects.toBeDefined();
  });
});
