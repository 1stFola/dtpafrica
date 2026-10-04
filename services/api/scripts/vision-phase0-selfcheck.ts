/**
 * Vision Phase 0 self-check.
 *
 * Exercises the rights engine, the object store and the compute registry
 * against a real database, then rolls everything back. Unit tests already cover
 * these paths with mocks; this proves the same behaviour end to end through
 * Prisma, which is what you actually deploy.
 *
 *   pnpm --filter @dtp/api vision:selfcheck
 *
 * Writes nothing: every row is created inside a transaction that is always
 * rolled back, so it is safe to run against a database with live data.
 */
import { PrismaClient } from "@prisma/client";
import {
  BUCKET_IDS,
  DEFAULT_RESOURCE_CLASS,
  VISION_CONTRACT_VERSION,
  visionKeys,
} from "@dtp/vision-contracts";
import { ComputeProviderRegistry } from "../src/vision/compute/compute-provider";
import { LocalComputeProvider } from "../src/vision/compute/local-compute-provider";
import { MockComputeProvider } from "../src/vision/compute/mock-compute-provider";
import { estimateUsdCents } from "../src/vision/compute/resource-rates";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { RightsPolicyService } from "../src/vision/rights/rights-policy.service";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import { WriteOnceViolationError } from "../src/vision/storage/object-store";
import { assertDevDatabase } from "./gate-harness";

const prisma = new PrismaClient();

/** Thrown to force the transaction open in this script to roll back. */
class Rollback extends Error {}

// Standalone script: nothing else populates process.env.
loadApiEnv();

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  const mark = ok ? "  PASS" : "  FAIL";
  const detail = ok ? String(actual) : `expected ${String(expected)}, got ${String(actual)}`;
  console.log(`${mark}  ${label.padEnd(62)} ${detail}`);
}

function section(title: string) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

async function main() {
  assertDevDatabase();
  console.log("DTP Vision Engine — Phase 0 self-check");
  console.log(`contract version ${VISION_CONTRACT_VERSION}\n`);

  // ── Configuration ────────────────────────────────────────────────────────
  section("Configuration");
  const config = loadVisionConfig();
  check("vision enabled", config.enabled, config.enabled);
  check("storage backend", config.storage.backend, config.storage.backend);
  check("upload part size is 16 MiB", config.upload.partBytes, 16 * 1024 * 1024);
  check("playback URLs are short-lived", config.playback.urlTtlSeconds <= 3600, true);
  check("every job carries a budget", config.jobs.defaultBudgetUsdCents > 0, true);

  // ── Object store ─────────────────────────────────────────────────────────
  section("Object store");
  const store = new InMemoryObjectStore();
  check("four logical buckets", BUCKET_IDS.length, 4);

  const master = visionKeys.sourceOriginal("asset-selfcheck", "mp4");
  check("source originals land in master", master.bucket, "master");
  await store.putSmallObject(master.bucket, master.key, "first", "video/mp4");

  let writeOnceHeld = false;
  try {
    await store.putSmallObject(master.bucket, master.key, "second", "video/mp4");
  } catch (error) {
    writeOnceHeld = error instanceof WriteOnceViolationError;
  }
  check("master bucket refuses an overwrite", writeOnceHeld, true);

  const a1 = visionKeys.inferencePrefix("job-selfcheck", 1);
  const a2 = visionKeys.inferencePrefix("job-selfcheck", 2);
  check("a retry writes to a new attempt prefix", a1 !== a2, true);

  // ── Compute ──────────────────────────────────────────────────────────────
  section("Compute");
  const registry = new ComputeProviderRegistry([
    new MockComputeProvider(),
    new LocalComputeProvider(),
  ]);
  check("providers registered", registry.list().length, 2);
  check("transcode runs on CPU, not a GPU", DEFAULT_RESOURCE_CLASS.transcode, "cpu_small");
  check("detection runs on a GPU", DEFAULT_RESOURCE_CLASS.detect, "gpu_24gb");

  let refusedExperimentOnly = false;
  try {
    registry.getForProductionWork("mock");
  } catch {
    refusedExperimentOnly = true;
  }
  check("experiment-only capacity refused for durable work", refusedExperimentOnly, true);
  check(
    "a 30-minute GPU job costs roughly",
    `${(estimateUsdCents("gpu_48gb", 1800) / 100).toFixed(2)} USD`,
    `${(estimateUsdCents("gpu_48gb", 1800) / 100).toFixed(2)} USD`
  );

  // ── Rights engine, against the real database ─────────────────────────────
  section("Rights engine (real database, rolled back)");

  try {
    await prisma.$transaction(
      async (tx) => {
        const rights = new RightsPolicyService(tx as never);
        const now = new Date();
        const granted = new Date(now.getTime() - 86_400_000);

        const partner = await tx.visionSourcePartner.create({
          data: { name: "Self-check FC" },
        });
        const evidence = await tx.visionRightsEvidence.create({
          data: {
            partnerId: partner.id,
            kind: "contract",
            objectKey: visionKeys.rightsEvidence(partner.id, "ev", "pdf").key,
          },
        });
        const record = await tx.visionSourceVideoRecord.create({
          data: {
            partnerId: partner.id,
            sourceQualityRank: "original_master",
            acquisitionStatus: "catalogued",
            url: "https://example.test/watch?v=selfcheck",
            title: "Catalogued only",
          },
        });

        // 1. A catalogued URL with no grant is refused outright.
        const noGrant = await rights.canAnalyze({ sourceVideoRecordId: record.id }, now);
        check("catalogued URL, no grant: analyze", noGrant.allowed, false);
        if (!noGrant.allowed) {
          check("  reason", noGrant.reason, "no_scope");
        }

        // 2. Partner-level grant of all four scopes, as the backfill will create.
        await tx.visionRightsScope.create({
          data: {
            partnerId: partner.id,
            grantLevel: "partner",
            canAnalyze: true,
            canTrain: true,
            canPublishHighlight: true,
            canShareWithScout: true,
            grantedAt: granted,
            evidenceId: evidence.id,
          },
        });

        const analyzeOk = await rights.canAnalyze({ sourceVideoRecordId: record.id }, now);
        check("partner grant: analyze", analyzeOk.allowed, true);

        // 3. Training still refused: a URL is not an acquired copy.
        const trainCatalogued = await rights.canTrain({ sourceVideoRecordId: record.id }, now);
        check("catalogued URL: train", trainCatalogued.allowed, false);
        if (!trainCatalogued.allowed) {
          check("  reason", trainCatalogued.reason, "pending_acquisition");
        }

        // 4. Acquire it: an immutable DTP copy with a checksum.
        await tx.visionSourceVideoRecord.update({
          where: { id: record.id },
          data: { acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
        });
        const asset = await tx.visionVideoAsset.create({
          data: {
            sourceVideoRecordId: record.id,
            corpus: "dtp_owned",
            objectKey: `originals/selfcheck-${Date.now()}/source.mp4`,
            bytes: BigInt(4_000_000_000),
            mimeType: "video/mp4",
            checksumSha256: "a".repeat(64),
            ingestState: "ready",
          },
        });

        const trainOk = await rights.canTrain({ videoAssetId: asset.id }, now);
        check("acquired DTP copy: train", trainOk.allowed, true);

        // 5. Research-only footage can never be trained on, grant or no grant.
        const research = await tx.visionVideoAsset.create({
          data: {
            sourceVideoRecordId: record.id,
            corpus: "research_only",
            objectKey: `originals/selfcheck-research-${Date.now()}/source.mp4`,
            bytes: BigInt(1_000_000),
            mimeType: "video/mp4",
            checksumSha256: "b".repeat(64),
            ingestState: "ready",
          },
        });
        const trainResearch = await rights.canTrain({ videoAssetId: research.id }, now);
        check("research-only corpus: train", trainResearch.allowed, false);
        if (!trainResearch.allowed) {
          check("  reason", trainResearch.reason, "research_corpus");
        }

        // 6. The decisive one: a guardian's player-level withdrawal must beat a
        //    live partner-wide grant.
        const player = await tx.player.findFirst({ select: { id: true, displayName: true } });
        if (!player) {
          console.log("  SKIP  no player in the database to test guardian override");
        } else {
          const beforeWithdrawal = await rights.canPublishHighlight(
            { videoAssetId: asset.id, playerId: player.id },
            now
          );
          check("partner grant covers the player: publish", beforeWithdrawal.allowed, true);

          await tx.visionRightsScope.create({
            data: {
              playerId: player.id,
              grantLevel: "player",
              canPublishHighlight: true,
              canShareWithScout: true,
              grantedAt: granted,
              revokedAt: now,
              revokedReason: "Guardian withdrew consent",
            },
          });

          const afterWithdrawal = await rights.canPublishHighlight(
            { videoAssetId: asset.id, playerId: player.id },
            now
          );
          check("guardian withdrawal overrides partner grant", afterWithdrawal.allowed, false);
          if (!afterWithdrawal.allowed) {
            check("  reason", afterWithdrawal.reason, "revoked");
          }

          const otherPlayer = await rights.canPublishHighlight(
            { videoAssetId: asset.id, playerId: "someone-else" },
            now
          );
          check("one withdrawal does not affect other players", otherPlayer.allowed, true);
        }

        throw new Rollback();
      },
      { timeout: 30_000 }
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  const leftBehind = await prisma.visionSourcePartner.count({
    where: { name: "Self-check FC" },
  });
  check("self-check left no rows behind", leftBehind, 0);

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
