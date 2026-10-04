/**
 * Phase 5 Increment 5 gate — game state: every track's foot point in metres,
 * frame by frame, under the suppression rule, as Parquet in the bucket.
 *
 *   pnpm --filter @dtp/api vision:gamestatecheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production), the seeded `vision_reviewer` role, the worker's Python
 * (`VISION_WORKER_PYTHON`, or the worker's `.venv`) with pyarrow, and the
 * object store the API is configured for: the chunks are written to it and the
 * review route hands out presigned URLs to them.
 *
 * Three claims are on trial:
 *
 *   1. A gamestate job is refused until a segment is calibrated; queued, it is
 *      handed the track artifact, every camera segment with the calibration a
 *      person filed on it (failed ones too, and none where none was -- the stage
 *      says why a row is suppressed), the clock anchors and the chunk size, and
 *      nothing the caller tried to forge.
 *   2. The stage places a position only through a passing calibration covering
 *      its moment: under the good segment the walk is at ten metres and on the
 *      halfway line, under the uncalibrated one and the failed one every row is
 *      suppressed with its reason, the clock reads on each row, the valid-frame
 *      coverage is exactly the share of frames the good segment covered, and
 *      the chunks are Parquet that read back by column.
 *   3. The control plane keeps nothing but the index and the coverage, the
 *      review route hands out the index and a URL per chunk, a retry adds
 *      nothing, and the API's own per-track placement agrees with the stage's.
 */
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { VISION_CONTRACT_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { project, type Homography } from "../src/vision/calibration/homography";
import { landmarkById } from "../src/vision/calibration/pitch-model";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";
import type { ObjectStore } from "../src/vision/storage/object-store";
import { assertDevDatabase, createGateMatch, onInterrupt, removeGateMatch, type GateMatch } from "./gate-harness";

loadApiEnv();

const API = process.env.VISION_E2E_API ?? "http://localhost:3000/api/v1";
const WORKER_DIR = resolve(__dirname, "../../vision-worker");
const PYTHON =
  process.env.VISION_WORKER_PYTHON ??
  (process.platform === "win32" ? join(WORKER_DIR, ".venv/Scripts/python.exe") : join(WORKER_DIR, ".venv/bin/python"));
const prisma = new PrismaClient();
const RUN = randomUUID().slice(0, 8);

/* The gate's own match, for its footage to belong to. It took whichever match came first,
   so it could not run on an empty database (docs/vision/65). */
let gateMatch: GateMatch | null = null;

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(70)} ${ok ? String(actual) : `expected ${expected}, got ${actual}`}`);
}
function near(label: string, actual: unknown, expected: number, tol: number) {
  checks += 1;
  const ok = typeof actual === "number" && Math.abs(actual - expected) <= tol;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(70)} ${ok ? String(actual) : `expected ${expected}±${tol}, got ${actual}`}`);
}
function section(t: string) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}
function adminHeaders(): Record<string, string> {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) throw new Error("ADMIN_API_KEY is not set");
  return { "x-admin-api-key": key, "Content-Type": "application/json" };
}
type Reply = { status: number; body: Record<string, any> };
async function call(path: string, headers: Record<string, string>, init?: RequestInit): Promise<Reply> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...headers } });
  const text = await res.text();
  let body: Record<string, any> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}
const api = (path: string, init?: RequestInit) => call(path, adminHeaders(), init);
const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });

/* The synthetic camera from the calibration gate: pitch metres -> proxy pixels. */
const CAMERA: Homography = [9.2, -3.1, 160, 0.4, 2.6, 80, 0.0004, 0.011, 1];
const PITCH = { lengthM: 105, widthM: 68 };
const SIX = ["corner_left_near", "corner_left_far", "halfway_near", "halfway_far", "left_penalty_spot", "centre_spot"];
function see(xM: number, yM: number) {
  const p = project(CAMERA, { x: xM, y: yM });
  if (!p) throw new Error(`(${xM}, ${yM}) is beyond the synthetic horizon`);
  return p;
}
function clicks(ids: string[] = SIX) {
  const by = landmarkById(PITCH);
  return ids.map((id) => {
    const l = by.get(id)!;
    const p = see(l.xM, l.yM);
    return { landmark: id, px: p.x, py: p.y };
  });
}

/* Five seconds of footage at 25fps from source 9000: 125 frames. Segment A (good) covers
 *  frames 0..49, B (declared, never calibrated) 50..87, C (failed) 88..124. */
const OFFSET = 9000;
const FRAMES = 125;
/* Adjacent and half-open, as cuts make them: a segment covers start <= t < end, and the
   millisecond one ends on is the first of the next (docs/vision/56). */
const SEG_A = { startMs: 9000, endMs: 11_000 };
const SEG_B = { startMs: 11_000, endMs: 12_500 };
const SEG_C = { startMs: 12_500, endMs: 14_000 };
/** The tracker was given a second more footage than anyone is tracked on: 25 frames with no track. */
const TRACKED = FRAMES + 25;
const CHUNK_MS = 2000;
const KICKOFF = 9000;
function frameMs(i: number) {
  return OFFSET + Math.round((i / 25) * 1000);
}
const framesIn = (seg: { startMs: number; endMs: number }) => Array.from({ length: FRAMES }, (_, i) => frameMs(i)).filter((ms) => ms >= seg.startMs && ms < seg.endMs).length;

type Fixture = { partnerId: string; assetId: string; modelIds: string[]; jobIds: string[]; workerIds: string[]; userIds: string[]; wrote: { bucket: "derived"; key: string }[]; tmp: string | null };

async function person(fx: Fixture, roleSlug: string, label: string): Promise<{ id: string; token: string }> {
  const role = await prisma.adminRole.findUnique({ where: { slug: roleSlug }, select: { id: true } });
  if (!role) throw new Error(`Role ${roleSlug} is not seeded; run the RBAC seed first`);
  const email = `gate-${label}-${RUN}@example.test`;
  const oneTimeCredential = randomBytes(24).toString("hex");
  const user = await prisma.adminUser.create({
    data: { email, name: `Gate ${label} ${RUN}`, passwordHash: await bcrypt.hash(oneTimeCredential, 4), roleId: role.id, isActive: true, allCompetitions: true },
  });
  fx.userIds.push(user.id);
  const login = await call("/admin/auth/login", {}, { method: "POST", body: JSON.stringify({ email, password: oneTimeCredential }) });
  if (!login.body.token) throw new Error(`login failed for ${label}: ${JSON.stringify(login.body).slice(0, 200)}`);
  return { id: user.id, token: String(login.body.token) };
}

async function seed(): Promise<Fixture> {
  gateMatch = await createGateMatch(prisma, RUN);
  const sbMatch = gateMatch;
  const partner = await prisma.visionSourcePartner.create({ data: { name: `Game state gate ${RUN}`, contactEmail: "gate@example.test" } });
  const record = await prisma.visionSourceVideoRecord.create({
    data: { partnerId: partner.id, title: `Game state gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
  });
  await prisma.visionRightsScope.create({
    data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
  });
  const asset = await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: record.id, sbMatchId: sbMatch.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-gamestate/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
      checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), width: 1280, height: 720, durationMs: 130_000, ingestState: "ready",
      variants: { create: { kind: "proxy", objectKey: `proxies/gate-${RUN}-gamestate/proxy.mp4`, width: 1280, height: 720, fps: 25, durationMs: 120_000, sourceOffsetMs: OFFSET } },
    },
  });
  const jobIds: string[] = [];
  for (const type of ["probe", "transcode", "detect"] as const) {
    const id = randomUUID();
    jobIds.push(id);
    await prisma.visionJob.create({
      data: { id, type, resourceClass: type === "detect" ? "gpu_24gb" : "cpu_small", state: "succeeded", videoAssetId: asset.id, inputSpec: {}, outputPrefix: visionKeys.inferencePrefix(id, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date() },
    });
  }
  return { partnerId: partner.id, assetId: asset.id, modelIds: [], jobIds, workerIds: [], userIds: [], wrote: [], tmp: null };
}

/** A succeeded track job: one player walking (10,34)->(30,34) over the first 41 frames then standing, one standing on the centre spot throughout. */
async function trackJob(fx: Fixture, store: ObjectStore, trackerVersionId: string) {
  const id = randomUUID();
  const key = `${visionKeys.inferencePrefix(id, 1)}tracks.json`;
  const walker = [];
  const stander = [];
  for (let i = 0; i < FRAMES; i += 1) {
    const ms = frameMs(i);
    const foot = see(10 + Math.min(i, 40) * 0.5, 34);
    walker.push({ frameIndex: i, proxyTimeMs: ms - OFFSET, sourceTimeMs: ms, box: { x: foot.x - 20, y: foot.y - 80, width: 40, height: 80 }, confidence: 0.9 });
    const centre = see(52.5, 34);
    stander.push({ frameIndex: i, proxyTimeMs: ms - OFFSET, sourceTimeMs: ms, box: { x: centre.x - 20, y: centre.y - 80, width: 40, height: 80 }, confidence: 0.9 });
  }
  const last = frameMs(FRAMES - 1);
  const tracks = [
    { localTrackId: 1, class: "player", startFrame: 0, endFrame: FRAMES - 1, startMs: OFFSET, endMs: last, detectionCount: FRAMES, confirmed: true, positions: walker },
    { localTrackId: 2, class: "player", startFrame: 0, endFrame: FRAMES - 1, startMs: OFFSET, endMs: last, detectionCount: FRAMES, confirmed: true, positions: stander },
  ];
  const trackedFrames = Array.from({ length: TRACKED }, (_, i) => [i, frameMs(i)]);
  const artifact = { contractVersion: VISION_CONTRACT_VERSION, role: "tracks", trackerVersionId, proxy: { fps: 25, sourceOffsetMs: OFFSET }, tracks, trackCount: tracks.length, framesTracked: TRACKED, trackedFrames };
  await store.putSmallObject("derived", key, JSON.stringify(artifact), "application/json");
  fx.wrote.push({ bucket: "derived", key });
  await prisma.visionJob.create({
    data: {
      id, type: "track", resourceClass: "cpu_small", state: "succeeded", videoAssetId: fx.assetId, modelVersionId: trackerVersionId,
      inputSpec: { videoAssetId: fx.assetId }, outputPrefix: visionKeys.inferencePrefix(id, 1), budgetSeconds: 600, budgetUsdCents: 100,
      contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date(),
      progress: { artifacts: [{ key, bucket: "derived", role: "tracks" }], summary: { trackerVersionId, tracks: tracks.length } },
    },
  });
  fx.jobIds.push(id);
  const rows = await Promise.all(
    tracks.map((t) =>
      prisma.visionTrack.create({
        data: {
          videoAssetId: fx.assetId, inferenceJobId: id, localTrackId: t.localTrackId, class: t.class, startMs: t.startMs, endMs: t.endMs, startFrame: t.startFrame, endFrame: t.endFrame,
          detectionCount: t.detectionCount, confirmed: true, trackerVersionId, detectorVersionId: null, artifactKey: key,
        },
      })
    )
  );
  return { jobId: id, key, walkerTrackId: rows[0]!.id };
}

async function cleanup(fx: Fixture | null, store: ObjectStore) {
  if (!fx) {
    await removeGateMatch(prisma, gateMatch);
    return;
  }
  for (const w of fx.wrote) await store.delete(w.bucket, w.key).catch(() => undefined);
  for (const jobId of fx.jobIds) {
    const page = await store.list("derived", `inference/${jobId}/`).catch(() => null);
    for (const key of page?.keys ?? []) await store.delete("derived", key).catch(() => undefined);
  }
  if (fx.tmp) rmSync(fx.tmp, { recursive: true, force: true });
  // Segments, calibrations, anchors, tracks and jobs cascade with the asset.
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionModel.deleteMany({ where: { id: { in: fx.modelIds } } });
  await prisma.visionWorker.deleteMany({ where: { id: { in: fx.workerIds } } });
  await prisma.visionAuditLog.deleteMany({ where: { OR: [{ actorId: { in: fx.userIds } }, { targetId: { in: [...fx.modelIds, ...fx.jobIds, fx.assetId] } }] } });
  await prisma.adminUser.deleteMany({ where: { id: { in: fx.userIds } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
  await removeGateMatch(prisma, gateMatch);
}

function python(args: string[]) {
  const run = spawnSync(PYTHON, args, { cwd: WORKER_DIR, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`worker python failed: ${run.stderr}`);
  return run.stdout;
}

async function main() {
  assertDevDatabase({ api: API });
  const config = loadVisionConfig();
  const store: ObjectStore = config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();
  console.log("Vision game state — metres per frame, placed only through a calibration that passed");
  console.log(`  api ${API}`);
  console.log(`  object store ${store.backendId}`);
  console.log(`  run ${RUN}`);
  if (!existsSync(PYTHON)) throw new Error(`No worker Python at ${PYTHON}; set VISION_WORKER_PYTHON`);

  let fx: Fixture | null = null;
  onInterrupt(async () => {
    await cleanup(fx, store);
    await prisma.$disconnect();
  });
  try {
    fx = await seed();
    const reviewer = await person(fx, "vision_reviewer", "reviewer");
    const R = {
      get: (path: string) => call(path, { Authorization: `Bearer ${reviewer.token}` }),
      post: (path: string, body: unknown) => call(path, { Authorization: `Bearer ${reviewer.token}` }, { method: "POST", body: JSON.stringify(body) }),
    };

    // ── 1. Queueing ──────────────────────────────────────────────────────
    section("1. A gamestate job waits on tracks and a calibration, and is handed exactly what a person filed");

    const noTrack = await post("/vision/jobs", { type: "gamestate", videoAssetId: fx.assetId });
    check("before track has succeeded: refused", noTrack.status, 400);

    const trackerModel = await post("/vision/models", { key: `tracker/gate-${RUN}`, task: "track" });
    fx.modelIds.push(String(trackerModel.body.id));
    const tracker = await post(`/vision/models/${trackerModel.body.id}/versions`, {
      version: "0.1", gitCommit: "3eeec6e0", configKey: "tracking.Params()", workerImage: "dtp-vision-worker:0.1",
      licenceNote: "In-house ByteTrack-style association (dtp_vision_worker/tracking.py); no third-party tracking code linked.",
    });
    const trackerId = String(tracker.body.id);
    const tracked = await trackJob(fx, store, trackerId);

    const noSegment = await post("/vision/jobs", { type: "gamestate", videoAssetId: fx.assetId });
    check("tracks but no camera segment: refused", `${noSegment.status}/${noSegment.body.error}`, "409/NoCalibration");

    const segA = await R.post(`/vision/review/${fx.assetId}/camera-segments`, { ...SEG_A, kind: "live_play" });
    const segB = await R.post(`/vision/review/${fx.assetId}/camera-segments`, { ...SEG_B, kind: "live_play" });
    const segC = await R.post(`/vision/review/${fx.assetId}/camera-segments`, { ...SEG_C, kind: "live_play" });
    check("three segments declared", `${segA.status}/${segB.status}/${segC.status}`, "201/201/201");
    const noCalibration = await post("/vision/jobs", { type: "gamestate", videoAssetId: fx.assetId });
    check("segments but none calibrated: refused", noCalibration.body.error, "NoCalibration");
    check("…saying how many segments there are", String(noCalibration.body.message).includes("3 camera segment"), true);

    const good = await R.post(`/vision/review/camera-segments/${segA.body.id}/calibration`, { points: clicks(), pitch: PITCH });
    check("segment A calibrated good", `${good.status}/${good.body.quality}`, "201/good");
    const swapped = clicks().map((p, i, all) => ({ ...p, px: all[(i + 2) % all.length]!.px, py: all[(i + 2) % all.length]!.py }));
    const failed = await R.post(`/vision/review/camera-segments/${segC.body.id}/calibration`, { points: swapped, pitch: PITCH });
    check("segment C calibrated, and failed the bar", `${failed.status}/${failed.body.quality}`, "201/failed");
    const anchored = await R.post(`/vision/review/${fx.assetId}/clock`, { half: 1, sourceMs: KICKOFF });
    check("kick-off anchored at the first frame", anchored.status, 201);

    const nothingYet = await R.get(`/vision/review/${fx.assetId}/game-state`);
    check("before any run, the review route has no game state", `${nothingYet.status}/${nothingYet.body.job}/${nothingYet.body.chunks?.length}`, "200/null/0");

    const forged = { chunkMs: CHUNK_MS, segments: [{ cameraSegmentId: "forged", quality: "good" }], anchors: [{ half: 2, sourceMs: 1 }], tracks: { key: "originals/victim/source.mp4" } };
    const queued = await post("/vision/jobs", { type: "gamestate", videoAssetId: fx.assetId, params: forged });
    check("gamestate queued", queued.status, 201);
    const jobId = String(queued.body.id);
    fx.jobIds.push(jobId);
    const row = await prisma.visionJob.findUnique({ where: { id: jobId } });
    const spec = (row?.inputSpec ?? {}) as any;
    check("…on the CPU class", row?.resourceClass, "cpu_small");
    check("…with no model of its own", row?.modelVersionId, null);
    check("…the track artifact and the tracker that made it, not the forged key", `${spec.tracks?.key === tracked.key}/${spec.tracks?.trackerVersionId === trackerId}`, "true/true");
    const segIds = [segA.body.id, segB.body.id, segC.body.id];
    check("…every segment a person declared, in order, not the forged one", spec.segments?.map((s: any, i: number) => s.cameraSegmentId === segIds[i]).join(","), "true,true,true");
    check("…with the calibration filed on each: good, none, failed", spec.segments?.map((s: any) => s.quality).join(","), "good,,failed");
    check("…a homography and pitch where there is one, and null where not", `${spec.segments?.[0]?.homography?.length}/${spec.segments?.[0]?.pitch?.lengthM}/${spec.segments?.[1]?.homography}/${spec.segments?.[1]?.pitch}`, "9/105/null/null");
    check("…the real anchor, not the forged one", `${spec.anchors?.length}/${spec.anchors?.[0]?.half}/${spec.anchors?.[0]?.sourceMs}`, `1/1/${KICKOFF}`);
    check("…the chunk size it asked for", spec.chunkMs, CHUNK_MS);
    check("…and only the track artifact as a readable key", `${spec.readKeys?.length}/${spec.readKeys?.[0]?.key === tracked.key}`, "1/true");

    const provisioned = await post("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "mock" });
    fx.workerIds.push(String(provisioned.body.workerId));
    const registered = await call("/vision/worker/register", { "x-vision-bootstrap-token": String(provisioned.body.bootstrapToken) }, { method: "POST" });
    const wh = { "x-vision-worker-token": String(registered.body.workerToken) };
    const claimed = await call("/vision/worker/jobs/claim", wh, { method: "POST", body: JSON.stringify({ resourceClasses: ["cpu_small"], contractVersion: VISION_CONTRACT_VERSION }) });
    const claimedId = claimed.body.job?.jobId;
    if (claimedId && claimedId !== jobId) await call(`/vision/worker/jobs/${claimedId}/fail`, wh, { method: "POST", body: JSON.stringify({ reason: "not mine", retryable: true }) });
    check("the worker claimed the gamestate job", claimedId, jobId);
    const params = claimed.body.job?.inputs?.params ?? {};
    const declared = await call(`/vision/worker/jobs/${jobId}/input-url`, wh, { method: "POST", body: JSON.stringify({ role: "declared", key: params.tracks?.key }) });
    check("the declared track artifact is readable", declared.status, 201);
    const notDeclared = await call(`/vision/worker/jobs/${jobId}/input-url`, wh, { method: "POST", body: JSON.stringify({ role: "declared", key: "originals/victim/source.mp4" }) });
    check("…and nothing else is", notDeclared.status >= 400, true);

    // ── 2. The stage ─────────────────────────────────────────────────────
    section("2. Placed through the good calibration; suppressed, and saying why, everywhere else");

    fx.tmp = mkdtempSync(join(tmpdir(), `dtp-gamestate-${RUN}-`));
    const artifact = await store.getSmallObject("derived", params.tracks.key);
    if (!artifact) throw new Error("the track artifact is not in the store");
    writeFileSync(join(fx.tmp, "tracks.json"), artifact);
    writeFileSync(join(fx.tmp, "segments.json"), JSON.stringify(params.segments));
    writeFileSync(join(fx.tmp, "anchors.json"), JSON.stringify(params.anchors));
    const outDir = join(fx.tmp, "out");
    const index = JSON.parse(
      python(["-m", "dtp_vision_worker.gamestate", "--tracks", join(fx.tmp, "tracks.json"), "--segments", join(fx.tmp, "segments.json"), "--anchors", join(fx.tmp, "anchors.json"), "--out-dir", outDir, "--chunk-ms", String(params.chunkMs)])
    );
    const inA = framesIn(SEG_A);
    const inB = framesIn(SEG_B);
    const inC = framesIn(SEG_C);
    check("a row per track per frame", index.rows, 2 * FRAMES);
    check("…over every frame that has a track", index.frames, FRAMES);
    check("…of the frames the tracker was given, which are more", `${index.framesTracked}/${index.coverageBasis}`, `${TRACKED}/frames_tracked`);
    check("placed: only the frames under the good segment, both tracks", index.placed, 2 * inA);
    check("suppressed: the rest", index.suppressed, 2 * (inB + inC));
    check("…the uncalibrated segment's rows say so", index.reasons?.segment_not_calibrated, 2 * inB);
    check("…the failed segment's rows say so", index.reasons?.calibration_failed, 2 * inC);
    check("…and no row is placed without a segment or beyond the horizon", `${index.reasons?.no_camera_segment ?? 0}/${index.reasons?.beyond_horizon ?? 0}`, "0/0");
    near("valid-frame coverage is the share of the tracked frames a position was placed on", index.validFrameCoverage, inA / TRACKED, 1e-4);
    check("…lower than the share of frames that have a track, which is what it used to report", index.validFrameCoverage < inA / FRAMES, true);
    const onCut = JSON.parse(
      python([
        "-c",
        [
          "import json, sys",
          "from pathlib import Path",
          "from dtp_vision_worker.gamestate import read_chunk",
          "rows = read_chunk(Path(sys.argv[1]) / 'chunk-00005.parquet')",
          "cut = [r for r in rows if r['source_ms'] == int(sys.argv[2]) and r['local_track_id'] == 1][0]",
          "before = [r for r in rows if r['source_ms'] < int(sys.argv[2]) and r['local_track_id'] == 1][-1]",
          "print(json.dumps({'cut': [cut['camera_segment_id'], cut['reason']], 'before': [before['camera_segment_id'], before['reason']]}))",
        ].join("\n"),
        outDir,
        String(SEG_B.startMs),
      ])
    );
    check("the frame on the cut is the second segment's, and the one before it the first's", `${onCut.before[0] === segA.body.id}/${onCut.before[1]}/${onCut.cut[0] === segB.body.id}/${onCut.cut[1]}`, "true/null/true/segment_not_calibrated");
    check("chunks: one per two seconds of source time", index.chunks?.map((c: any) => c.index).join(","), "4,5,6");
    check("…each named and sized", index.chunks?.every((c: any) => /^chunk-\d{5}\.parquet$/.test(c.file) && c.bytes > 0), true);
    check("…the first chunk fully placed, the last fully suppressed", `${index.chunks?.[0]?.validFrameCoverage}/${index.chunks?.[2]?.validFrameCoverage}`, "1/0");

    const peek = JSON.parse(
      python([
        "-c",
        [
          "import json, sys",
          "from pathlib import Path",
          "from dtp_vision_worker.gamestate import read_chunk",
          `rows = read_chunk(Path(sys.argv[1]) / 'chunk-00004.parquet')`,
          `rows5 = read_chunk(Path(sys.argv[1]) / 'chunk-00005.parquet')`,
          "walker = [r for r in rows if r['local_track_id'] == 1]",
          "stander = [r for r in rows if r['local_track_id'] == 2]",
          "sup = [r for r in rows5 if r['x_m'] is None]",
          "print(json.dumps({'columns': sorted(rows[0]), 'first': walker[0], 'twentieth': walker[20], 'centre': stander[0], 'suppressed': sup[0], 'ordered': all(rows[i]['source_ms'] <= rows[i+1]['source_ms'] for i in range(len(rows)-1))}))",
        ].join("\n"),
        outDir,
      ])
    );
    check("a chunk reads back by column", peek.columns.join(","), "camera_segment_id,class,frame_index,half,local_track_id,match_minute,quality,reason,source_ms,x_m,y_m");
    near("the walker's first step is at ten metres", peek.first.x_m, 10, 0.05);
    near("…on the halfway line across", peek.first.y_m, 34, 0.05);
    near("…twenty frames on, at twenty metres", peek.twentieth.x_m, 20, 0.05);
    near("the stander is on the centre spot", peek.centre.x_m, 52.5, 0.05);
    check("…through segment A, quality good, no reason", `${peek.first.camera_segment_id === segA.body.id}/${peek.first.quality}/${peek.first.reason}`, "true/good/null");
    check("…in the first half at minute zero", `${peek.first.half}/${peek.first.match_minute}`, "1/0");
    near("…and the twentieth frame reads 0.8 seconds on the clock", peek.twentieth.match_minute, 0.8 / 60, 1e-3);
    check("a suppressed row carries no metres and the reason", `${peek.suppressed.x_m}/${peek.suppressed.y_m}/${peek.suppressed.reason}`, "null/null/segment_not_calibrated");
    check("…but still names its segment and the clock", `${peek.suppressed.camera_segment_id === segB.body.id}/${peek.suppressed.half}`, "true/1");
    check("rows are in time order within a chunk", peek.ordered, true);

    // ── 3. Completion and the review route ───────────────────────────────
    section("3. The control plane keeps the index, hands out the chunks, and agrees with itself");

    const prefix = String(claimed.body.job?.outputPrefix);
    const artifacts: any[] = [];
    for (const chunk of index.chunks) {
      const key = `${prefix}gamestate/${chunk.file}`;
      const body = readFileSync(join(outDir, chunk.file));
      await store.putSmallObject("derived", key, body, "application/vnd.apache.parquet");
      fx.wrote.push({ bucket: "derived", key });
      chunk.key = key;
      artifacts.push({ key, bucket: "derived", bytes: body.length, contentType: "application/vnd.apache.parquet", role: "gamestate_chunk" });
    }
    const indexKey = `${prefix}gamestate.json`;
    await store.putSmallObject("derived", indexKey, JSON.stringify({ contractVersion: VISION_CONTRACT_VERSION, role: "gamestate", videoAssetId: fx.assetId, trackJobId: tracked.jobId, trackerVersionId: trackerId, ...index }), "application/json");
    fx.wrote.push({ bucket: "derived", key: indexKey });
    artifacts.push({ key: indexKey, bucket: "derived", bytes: 1, contentType: "application/json", role: "gamestate" });
    const summary = { trackJobId: tracked.jobId, trackerVersionId: trackerId, chunkMs: index.chunkMs, chunks: index.chunks.length, tracks: index.tracks, rows: index.rows, frames: index.frames, placed: index.placed, suppressed: index.suppressed, reasons: index.reasons, validFrameCoverage: index.validFrameCoverage, framesTracked: index.framesTracked, coverageBasis: index.coverageBasis };
    const completion = { idempotencyKey: `gate-${RUN}-gamestate`, artifacts, summary };

    // A completion short of the chunks it promised is not applied (stage-results.spec covers it);
    // the job still succeeds, as every stage's does, so it is not tried here on the one job.
    const completed = await call(`/vision/worker/jobs/${jobId}/complete`, wh, { method: "POST", body: JSON.stringify(completion) });
    check("the full completion is accepted and applied", `${completed.status}/${completed.body.applied?.applied}`, "201/true");
    check("…and says what the coverage was", String(completed.body.applied?.detail).includes(`3 chunk(s), ${2 * inA} placed and ${2 * (inB + inC)} suppressed row(s) over ${FRAMES} frame(s); valid-frame coverage ${(inA / TRACKED).toFixed(3)}`), true);
    check("nothing but the job row changed in Postgres: no new tracks, segments or assignments", `${await prisma.visionTrack.count({ where: { videoAssetId: fx.assetId } })}/${await prisma.visionCameraSegment.count({ where: { videoAssetId: fx.assetId } })}`, "2/3");
    const retried = await call(`/vision/worker/jobs/${jobId}/complete`, wh, { method: "POST", body: JSON.stringify(completion) });
    check("a retried completion is recognised", retried.body.alreadyApplied, true);

    const state = await R.get(`/vision/review/${fx.assetId}/game-state`);
    check("the review route names the job", state.body.job?.id, jobId);
    check("…its coverage", `${state.body.coverage?.placed}/${state.body.coverage?.suppressed}/${state.body.coverage?.validFrameCoverage}`, `${2 * inA}/${2 * (inB + inC)}/${index.validFrameCoverage}`);
    check("…and what that coverage is a share of", `${state.body.coverage?.framesTracked}/${state.body.coverage?.coverageBasis}`, `${TRACKED}/frames_tracked`);
    check("…what it was placed with: three segments, two calibrations, one anchor", `${state.body.placedWith?.segments}/${state.body.placedWith?.calibrations}/${state.body.placedWith?.anchors}`, "3/2/1");
    check("…a URL per chunk, in order", state.body.chunks?.map((c: any) => c.key === `${prefix}gamestate/${c.key.split("/").pop()}` && typeof c.url === "string" && c.url.length > 0).join(","), "true,true,true");
    check("…and the index", `${state.body.index?.key === indexKey}/${typeof state.body.index?.url}`, "true/string");
    const fetched = await fetch(String(state.body.index?.url));
    const fetchedIndex = fetched.ok ? await fetched.json() : null;
    check("the index URL serves the index the stage wrote", `${fetched.status}/${fetchedIndex?.placed}`, `200/${2 * inA}`);
    const chunkFetched = await fetch(String(state.body.chunks?.[0]?.url));
    const chunkBytes = chunkFetched.ok ? Buffer.from(await chunkFetched.arrayBuffer()) : Buffer.alloc(0);
    check("a chunk URL serves Parquet", `${chunkFetched.status}/${chunkBytes.subarray(0, 4).toString("latin1")}/${chunkBytes.subarray(-4).toString("latin1")}`, "200/PAR1/PAR1");
    const keyed = await api(`/vision/review/${fx.assetId}/game-state`);
    check("the operator key can read it too: it is a read", keyed.status, 200);

    const positions = await R.get(`/vision/review/tracks/${tracked.walkerTrackId}/pitch-positions`);
    check("the API's own placement of the walker agrees on how many frames are placed", `${positions.body.summary?.placed}/${positions.body.summary?.positions}`, `${inA}/${FRAMES}`);
    near("…and on where the first step is", positions.body.positions?.[0]?.xM, peek.first.x_m, 0.002);
    check("…and the distance is suppressed, as it must be with frames unplaced", positions.body.distance?.suppressed, true);

    await post(`/vision/workers/${provisioned.body.workerId}/retire`, {});
  } catch (error) {
    failures += 1;
    console.error("\nGate aborted:", error);
  } finally {
    await cleanup(fx, store).catch((e) => console.error("cleanup failed:", e));
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
  process.exitCode = failures ? 1 : 0;
}

void main();
