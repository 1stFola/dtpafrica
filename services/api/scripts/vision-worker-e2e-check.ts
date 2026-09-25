/**
 * Phase 1 Increment 2 gate — the worker container, end to end.
 *
 *   pnpm --filter @dtp/api vision:e2echeck -- <path-to-a-small-mp4>
 *
 * Runs the real worker image against the running control plane and real object
 * storage: upload a source, queue a job, provision a worker, let the container
 * claim and process it, then assert the artifacts landed where they should.
 *
 * Requires: the API running on :3000, Docker, and the worker image built as
 * `dtp-vision-engine:0.1.0-cpu`.
 *
 * Cleans up after itself — database rows and every object it wrote, including the
 * write-once source, which is the one legitimate use of deleteProtected here.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import type { ObjectStore } from "../src/vision/storage/object-store";

loadApiEnv();

const IMAGE = process.env.VISION_E2E_IMAGE ?? "dtp-vision-engine:0.1.0-cpu";
const API = process.env.VISION_E2E_API ?? "http://localhost:3000/api/v1";
/** The container reaches the host's API through Docker's host alias. */
const CALLBACK = process.env.VISION_E2E_CALLBACK ?? "http://host.docker.internal:3000/api/v1/vision/worker";

const prisma = new PrismaClient();

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(56)} ${ok ? String(actual) : `expected ${expected}, got ${actual}`}`
  );
}

function section(t: string) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}

function adminHeaders(): Record<string, string> {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) throw new Error("ADMIN_API_KEY is not set; cannot drive the admin API");
  return { "x-admin-api-key": key, "Content-Type": "application/json" };
}

async function api(path: string, init?: RequestInit, attempts = 4) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(`${API}${path}`, { ...init, headers: adminHeaders() });
      const text = await res.text();
      if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
      return text ? JSON.parse(text) : null;
    } catch (error) {
      lastError = error;
      // A dev server under `tsx watch` can restart mid-run. Retry a dropped
      // connection; do not retry a real HTTP error.
      const dropped = error instanceof TypeError;
      if (!dropped || attempt === attempts) throw error;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastError;
}

async function main() {
  const mediaPath = process.argv[2];
  if (!mediaPath) {
    console.error("Usage: vision:e2echeck -- <path-to-a-small-mp4>");
    process.exitCode = 1;
    return;
  }

  const config = loadVisionConfig();
  const store: ObjectStore =
    config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();

  console.log(`Vision worker end-to-end check`);
  console.log(`  image        ${IMAGE}`);
  console.log(`  object store ${store.backendId}`);
  console.log(`  source       ${mediaPath} (${statSync(mediaPath).size} bytes)`);

  const assetId = randomUUID();
  const source = visionKeys.sourceOriginal(assetId, "mp4");
  const created: { partnerId?: string; jobId?: string; workerId?: string } = {};
  const wroteKeys: { bucket: "derived"; key: string }[] = [];

  try {
    // ── Fixtures, committed so the running API can see them ────────────────
    section("Setup");
    const sbMatch = await prisma.sbMatch.findFirst({ select: { id: true } });
    if (!sbMatch) throw new Error("No SbMatch to link the asset to");

    const partner = await prisma.visionSourcePartner.create({
      data: { name: `E2E worker check ${assetId.slice(0, 8)}` },
    });
    created.partnerId = partner.id;

    const record = await prisma.visionSourceVideoRecord.create({
      data: {
        partnerId: partner.id,
        sourceQualityRank: "original_master",
        acquisitionStatus: "acquired",
        acquisitionMethod: "partner_direct_upload",
      },
    });
    await prisma.visionRightsScope.create({
      data: {
        partnerId: partner.id,
        grantLevel: "partner",
        canAnalyze: true,
        grantedAt: new Date(Date.now() - 3600_000),
      },
    });

    await store.putSmallObject(source.bucket, source.key, readFileSync(mediaPath), "video/mp4");
    const head = await store.head(source.bucket, source.key);
    check("source uploaded to the master bucket", Boolean(head), true);

    await prisma.visionVideoAsset.create({
      data: {
        id: assetId,
        sourceVideoRecordId: record.id,
        sbMatchId: sbMatch.id,
        corpus: "dtp_owned",
        objectKey: source.key,
        bytes: BigInt(statSync(mediaPath).size),
        mimeType: "video/mp4",
        checksumSha256: "e".repeat(64),
        ingestState: "uploaded",
      },
    });

    // ── Queue a job through the real API ──────────────────────────────────
    section("Queue");
    const queued = await api("/vision/jobs", {
      method: "POST",
      body: JSON.stringify({ type: "probe", videoAssetId: assetId }),
    });
    created.jobId = queued.id;
    check("probe job queued via the admin API", Boolean(queued.id), true);

    // ── Provision a worker ────────────────────────────────────────────────
    section("Provision");
    const provisioned = await api("/vision/workers/provision", {
      method: "POST",
      body: JSON.stringify({ resourceClass: "cpu_small", providerId: "local" }),
    });
    created.workerId = provisioned.workerId;
    check("bootstrap token issued once", typeof provisioned.bootstrapToken, "string");

    // ── Run the real container ────────────────────────────────────────────
    section("Worker container");
    const runWorker = (bootstrapToken: string): string => {
      const args = [
        "run", "--rm",
        "--add-host", "host.docker.internal:host-gateway",
        "-e", `VISION_WORKER_CALLBACK_URL=${CALLBACK}`,
        "-e", `VISION_BOOTSTRAP_TOKEN=${bootstrapToken}`,
        "-e", "VISION_RESOURCE_CLASS=cpu_small",
        "-e", "VISION_POLL_SECONDS=1",
        "-e", "VISION_IDLE_SHUTDOWN_SECONDS=3",
        "-e", "VISION_HEARTBEAT_SECONDS=5",
        "-e", `VISION_WORKER_IMAGE=${IMAGE}`,
        IMAGE,
      ];
      // spawnSync, not execFileSync: the worker logs to stderr, and execFileSync
      // returns stdout only — which made a working run look like a failed one.
      const run = spawnSync("docker", args, { encoding: "utf8", timeout: 900_000 });
      return `${run.stdout ?? ""}${run.stderr ?? ""}`;
    };

    const probeLog = runWorker(provisioned.bootstrapToken);
    console.log(probeLog.trim().split("\n").slice(-3).join("\n").replace(/^/gm, "    "));
    check("worker registered", /registered as worker/.test(probeLog), true);
    check("worker completed a job", /completed .* in /.test(probeLog), true);

    // ── Assert the outcome ────────────────────────────────────────────────
    section("Outcome");
    const job = await api(`/vision/jobs/${created.jobId}`);
    check("job state", job.job.state, "succeeded");
    check("ffprobe read the duration", typeof job.job.progress?.summary?.durationMs, "number");
    check("ffprobe read the codec", job.job.progress?.summary?.videoCodec, "h264");

    const artifacts = (job.job.progress?.artifacts ?? []) as { key: string; bucket: string }[];
    check("one artifact recorded", artifacts.length, 1);

    const artifact = artifacts[0];
    if (artifact) {
      check("artifact sits under the job prefix", artifact.key.startsWith(job.job.outputPrefix), true);
      check("artifact bucket is derived, never master", artifact.bucket, "derived");
      wroteKeys.push({ bucket: "derived", key: artifact.key });

      const stored = await store.head("derived", artifact.key);
      check("artifact really exists in object storage", Boolean(stored), true);
    }

    const events = await api(`/vision/jobs/${created.jobId}/events`);
    const kinds = (events.events as { kind: string }[]).map((e) => e.kind);
    check("lifecycle recorded", kinds.join(">"), "queued>claimed>running>succeeded");

    const cost = job.job.cost;
    check("cost recorded with no GPU seconds", cost?.gpuSeconds, 0);
    check("cost recorded cpu seconds", (cost?.cpuSeconds ?? 0) > 0, true);

    // ── Transcode, which depends on probe having succeeded ────────────────
    section("Transcode");

    // The prerequisite gate. Refusing at enqueue is the point: a detect job
    // queued before its inputs exist would claim, find nothing, and burn a GPU
    // minute before failing.
    let prerequisiteEnforced = false;
    try {
      await api("/vision/jobs", {
        method: "POST",
        body: JSON.stringify({ type: "detect", videoAssetId: assetId }),
      });
    } catch (error) {
      prerequisiteEnforced = /needs transcode/.test(String(error));
    }
    check("a stage with unmet prerequisites is refused", prerequisiteEnforced, true);

    const transcodeJob = await api("/vision/jobs", {
      method: "POST",
      body: JSON.stringify({ type: "transcode", videoAssetId: assetId }),
    });
    check("transcode queued once probe has succeeded", Boolean(transcodeJob.id), true);

    const secondWorker = await api("/vision/workers/provision", {
      method: "POST",
      body: JSON.stringify({ resourceClass: "cpu_small", providerId: "local" }),
    });
    const transcodeLog = runWorker(secondWorker.bootstrapToken);
    check("worker completed the transcode", /completed .* in /.test(transcodeLog), true);

    const done = await api(`/vision/jobs/${transcodeJob.id}`);
    check("transcode state", done.job.state, "succeeded");
    // Constant frame rate is what makes frame seeking deterministic, and
    // therefore what makes an annotation point at the same moment later.
    check("proxy is constant 25 fps", done.job.progress?.summary?.proxy?.fps, 25);
    check("proxy height normalised", done.job.progress?.summary?.proxy?.height, 720);
    check(
      "settings hash recorded so a re-run can be skipped",
      typeof done.job.progress?.summary?.proxy?.settingsHash,
      "string"
    );

    const transcodeArtifacts = (done.job.progress?.artifacts ?? []) as {
      key: string;
      role: string;
      bucket: string;
    }[];
    for (const artifact of transcodeArtifacts) {
      wroteKeys.push({ bucket: "derived", key: artifact.key });
    }
    check("proxy artifact produced", transcodeArtifacts.some((a) => a.role === "proxy"), true);
    check(
      "thumbnails produced",
      transcodeArtifacts.filter((a) => a.role === "thumbnail").length > 0,
      true
    );
    check(
      "every transcode artifact stayed under its own prefix",
      transcodeArtifacts.every((a) => a.key.startsWith(done.job.outputPrefix)),
      true
    );
    const proxy = transcodeArtifacts.find((a) => a.role === "proxy");
    if (proxy) {
      check(
        "proxy really exists in object storage",
        Boolean(await store.head("derived", proxy.key)),
        true
      );
    }
  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────
    section("Cleanup");
    for (const ref of wroteKeys) {
      await store.delete(ref.bucket, ref.key).catch(() => undefined);
    }
    // The source lives in a write-once bucket, so removing it needs the explicit
    // path and a justification — this is what that path is for.
    await store
      .deleteProtected(source.bucket, source.key, "end-to-end check fixture, uploaded by this script")
      .catch(() => undefined);
    check("source removed from master", await store.head(source.bucket, source.key), null);

    if (created.partnerId) {
      // Cascades through the source record, rights scope, asset, jobs and events.
      await prisma.visionJobEvent.deleteMany({ where: { job: { videoAssetId: assetId } } });
      await prisma.visionJobCost.deleteMany({ where: { job: { videoAssetId: assetId } } });
      await prisma.visionJob.deleteMany({ where: { videoAssetId: assetId } });
      await prisma.visionVideoAsset.deleteMany({ where: { id: assetId } });
      await prisma.visionSourcePartner.delete({ where: { id: created.partnerId } }).catch(() => undefined);
    }
    // Both provisioned workers, not just the first.
    await prisma.visionWorker.deleteMany({ where: { providerId: "local", retiredAt: null } });
    const strays = await prisma.visionSourcePartner.count({
      where: { name: { startsWith: "E2E worker check " } },
    });
    check("database left clean", strays, 0);
  }

  section("Result");
  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
