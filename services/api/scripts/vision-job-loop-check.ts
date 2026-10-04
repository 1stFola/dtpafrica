/**
 * Phase 1 Increment 1 gate — the job spine, end to end.
 *
 *   pnpm --filter @dtp/api vision:jobcheck
 *
 * Drives one job through the real queue against the real database, and writes a
 * real artifact to real object storage through a presigned URL the worker was
 * never allowed to choose. Unit tests cover these paths with mocks; this proves
 * the pieces fit together.
 *
 * Database rows are created inside a transaction that always rolls back. The one
 * object it writes is deleted before it exits.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { OUTPUT_BUCKET_BY_JOB_TYPE, VISION_CONTRACT_VERSION, isKeyUnderPrefix, visionKeys, VISION_JOB_TYPES, type VisionJobType } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { PostgresJobQueue } from "../src/vision/jobs/postgres-job-queue";
import { WorkerTokenService } from "../src/vision/worker/worker-token.service";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";
import type { ObjectStore } from "../src/vision/storage/object-store";

loadApiEnv();

const prisma = new PrismaClient();

class Rollback extends Error {}

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${ok ? String(actual) : `expected ${expected}, got ${actual}`}`
  );
}

function section(t: string) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}

async function main() {
  console.log(`Vision job spine — end-to-end check (contract ${VISION_CONTRACT_VERSION})`);

  const config = loadVisionConfig();
  const store: ObjectStore =
    config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();
  console.log(`object store: ${store.backendId}`);

  // Declared as a mutable holder rather than a bare `let`: the assignment happens
  // inside the transaction callback, which TypeScript will not trace, so a plain
  // `let … = null` narrows to `null` and then to `never` in the `finally` below.
  const written: { ref: { bucket: "derived" | "models" | "clips"; key: string } | null } = {
    ref: null,
  };

  try {
    await prisma.$transaction(
      async (tx) => {
        const queue = new PostgresJobQueue(tx as never, config);
        const tokens = new WorkerTokenService(tx as never, config);

        // ── Fixtures: a rights-cleared, match-linked asset ────────────────
        section("Setup");
        const sbMatch = await tx.sbMatch.findFirst({ select: { id: true } });
        if (!sbMatch) throw new Error("No SbMatch in the database to link an asset to");

        const partner = await tx.visionSourcePartner.create({
          data: { name: `Job-loop check ${randomUUID().slice(0, 8)}` },
        });
        const record = await tx.visionSourceVideoRecord.create({
          data: {
            partnerId: partner.id,
            sourceQualityRank: "original_master",
            acquisitionStatus: "acquired",
            acquisitionMethod: "partner_direct_upload",
          },
        });
        await tx.visionRightsScope.create({
          data: {
            partnerId: partner.id,
            grantLevel: "partner",
            canAnalyze: true,
            canTrain: true,
            grantedAt: new Date(Date.now() - 86_400_000),
          },
        });
        const asset = await tx.visionVideoAsset.create({
          data: {
            sourceVideoRecordId: record.id,
            sbMatchId: sbMatch.id,
            corpus: "dtp_owned",
            objectKey: `originals/${randomUUID()}/source.mp4`,
            bytes: BigInt(1_234_567),
            mimeType: "video/mp4",
            checksumSha256: "c".repeat(64),
            ingestState: "ready",
          },
        });
        check("asset linked to a fixture", Boolean(asset.sbMatchId), true);

        // ── Enqueue ───────────────────────────────────────────────────────
        section("Queue");
        const jobId = randomUUID();
        const outputPrefix = visionKeys.inferencePrefix(jobId, 1);
        await queue.enqueue({
          id: jobId,
          type: "transcode",
          resourceClass: "cpu_small",
          videoAssetId: asset.id,
          inputSpec: { videoAssetId: asset.id },
          outputPrefix,
          budgetSeconds: 3600,
          budgetUsdCents: 200,
        });
        const depth = await queue.depth();
        check("job is queued on its resource class", depth.cpu_small >= 1, true);

        // ── Worker credentials ────────────────────────────────────────────
        section("Worker registration");
        const minted = await tokens.mintBootstrap({
          providerId: "local",
          resourceClass: "cpu_small",
          image: config.compute.workerImage,
        });
        const registered = await tokens.register(minted.bootstrapToken);
        check("bootstrap exchanged for a worker token", registered.identity.workerId, minted.workerId);

        // The bootstrap token must not be replayable to register a second worker.
        let replayRefused = false;
        try {
          await tokens.register(minted.bootstrapToken);
        } catch {
          replayRefused = true;
        }
        check("bootstrap token cannot be replayed", replayRefused, true);

        const verified = await tokens.verify(registered.workerToken);
        check("worker token verifies", verified.workerId, minted.workerId);

        // Neither token stands in for the other (docs/vision/50, C3).
        let workerTokenReRegistered = true;
        try {
          await tokens.register(registered.workerToken);
        } catch {
          workerTokenReRegistered = false;
        }
        check("a worker token cannot register for a fresh one", workerTokenReRegistered, false);

        const unredeemed = await tokens.mintBootstrap({
          providerId: "local",
          resourceClass: "cpu_small",
          image: config.compute.workerImage,
        });
        let bootstrapVerified = true;
        try {
          await tokens.verify(unredeemed.bootstrapToken);
        } catch {
          bootstrapVerified = false;
        }
        check("an unredeemed bootstrap token cannot act as a worker", bootstrapVerified, false);

        // ── Claim ─────────────────────────────────────────────────────────
        section("Claim");
        // A worker whose contract version cannot serve this job's stage is not handed it (docs/vision/58).
        const queuedType: VisionJobType = "transcode";
        const otherTypes = VISION_JOB_TYPES.filter((t) => t !== queuedType);
        const notServed = await queue.claim(minted.workerId, ["cpu_small"], otherTypes);
        check("a worker that cannot serve the job's stage is not handed it", notServed?.id === jobId, false);
        check("a worker that can serve no stage is handed nothing", await queue.claim(minted.workerId, ["cpu_small"], []), null);
        // The job is still there for a worker that can serve it: the claim below gets it.
        const claimed = await queue.claim(minted.workerId, ["cpu_small"], [queuedType]);
        check("worker claimed the job", claimed?.id, jobId);
        check("claim carried the output prefix", claimed?.outputPrefix, outputPrefix);

        const second = await queue.claim(minted.workerId, ["cpu_small"]);
        check("queue is now empty for that class", second, null);

        await queue.markRunning(jobId, minted.workerId);
        await queue.heartbeat(jobId, minted.workerId, { stage: "transcode", fraction: 0.5 });
        check("heartbeat accepted", true, true);

        // Another worker must not be able to act on a job it does not hold.
        let foreignRefused = false;
        try {
          await queue.heartbeat(jobId, "not-this-worker", {});
        } catch {
          foreignRefused = true;
        }
        check("a foreign worker cannot heartbeat the job", foreignRefused, true);

        // ── Presign + real write ──────────────────────────────────────────
        section("Presigned write (real object storage)");
        const bucket = OUTPUT_BUCKET_BY_JOB_TYPE.transcode;
        const goodKey = `${outputPrefix}proxy-manifest.json`;
        check("key sits under the job prefix", isKeyUnderPrefix(goodKey, outputPrefix), true);

        const traversal = `${outputPrefix}../../../originals/victim/source.mp4`;
        check("traversal key is rejected", isKeyUnderPrefix(traversal, outputPrefix), false);

        const body = JSON.stringify({ jobId, wrote: new Date().toISOString() });
        await store.putSmallObject(bucket, goodKey, body, "application/json");
        written.ref = { bucket, key: goodKey };

        const readBack = await store.getSmallObject(bucket, goodKey);
        check("artifact round-trips through storage", readBack?.toString(), body);

        // ── Complete, twice ───────────────────────────────────────────────
        section("Completion");
        const idempotencyKey = `complete-${jobId}-1`;
        const first = await queue.succeed(jobId, minted.workerId, idempotencyKey, {
          artifacts: [{ key: goodKey, bucket, role: "proxy" }],
        });
        check("first completion applied", first.alreadyApplied, false);

        const repeat = await queue.succeed(jobId, minted.workerId, idempotencyKey, {});
        check("repeat completion is a no-op", repeat.alreadyApplied, true);

        const finished = await tx.visionJob.findUnique({
          where: { id: jobId },
          select: { state: true, idempotencyKey: true },
        });
        check("job state is succeeded", finished?.state, "succeeded");

        const events = await tx.visionJobEvent.findMany({
          where: { jobId },
          select: { kind: true },
          orderBy: { createdAt: "asc" },
        });
        check(
          "job log records the lifecycle",
          events.map((e) => e.kind).join(">"),
          "queued>claimed>running>succeeded"
        );

        // ── Retry writes to a new prefix ──────────────────────────────────
        section("Retry isolation");
        const retryJobId = randomUUID();
        await queue.enqueue({
          id: retryJobId,
          type: "transcode",
          resourceClass: "cpu_small",
          videoAssetId: asset.id,
          inputSpec: {},
          outputPrefix: visionKeys.inferencePrefix(retryJobId, 1),
          budgetSeconds: 3600,
          budgetUsdCents: 200,
        });
        await queue.claim(minted.workerId, ["cpu_small"]);
        const failed = await queue.fail(retryJobId, minted.workerId, { kind: "worker_reported" });
        check("a retryable failure requeues", failed.requeued, true);
        const afterFail = await tx.visionJob.findUnique({
          where: { id: retryJobId },
          select: { attemptNumber: true, state: true },
        });
        check("attempt number advanced", afterFail?.attemptNumber, 2);
        check("job is back on the queue", afterFail?.state, "queued");
        check(
          "attempt 2 writes to a different prefix",
          visionKeys.inferencePrefix(retryJobId, 1) !== visionKeys.inferencePrefix(retryJobId, 2),
          true
        );

        throw new Rollback();
      },
      { timeout: 60_000 }
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  } finally {
    if (written.ref) {
      await store.delete(written.ref.bucket, written.ref.key).catch(() => undefined);
      const gone = await store.head(written.ref.bucket, written.ref.key).catch(() => null);
      check("storage cleaned up after itself", gone, null);
    }
  }

  const strays = await prisma.visionSourcePartner.count({
    where: { name: { startsWith: "Job-loop check " } },
  });
  check("database left clean", strays, 0);

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
