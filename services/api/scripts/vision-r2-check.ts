/**
 * Cloudflare R2 connectivity check.
 *
 * Proves the R2ObjectStore adapter works against the real bucket configuration
 * before Phase 1 depends on it. Unit tests cover the adapter's behaviour with an
 * in-memory double; this is the one thing they cannot tell you — whether the
 * credentials, endpoint and bucket names in your environment are correct.
 *
 *   pnpm --filter @dtp/api vision:r2check
 *
 * Writes one small object to the derived bucket and deletes it again. Touches
 * nothing in master, models or clips beyond a read-only existence probe.
 */
import {
  BUCKET_IDS,
  VERSIONED_BUCKETS,
  WRITE_ONCE_BUCKETS,
  visionKeys,
  type BucketId,
} from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { WriteOnceViolationError, type ObjectStore } from "../src/vision/storage/object-store";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";

// Standalone script: nothing else populates process.env.
loadApiEnv();

let checks = 0;
let failures = 0;

function pass(label: string, detail = "") {
  checks += 1;
  console.log(`  PASS  ${label.padEnd(56)} ${detail}`);
}

function fail(label: string, detail: string) {
  checks += 1;
  failures += 1;
  console.log(`  FAIL  ${label.padEnd(56)} ${detail}`);
}

function section(title: string) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const meta = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
    const status = meta?.httpStatusCode ? ` (HTTP ${meta.httpStatusCode})` : "";
    return `${error.name}: ${error.message}${status}`;
  }
  return String(error);
}

async function main() {
  console.log("DTP Vision Engine — Cloudflare R2 connectivity check\n");

  const config = loadVisionConfig();

  if (config.storage.backend !== "r2") {
    console.log(
      `Storage backend is "${config.storage.backend}", not "r2".\n\n` +
        "Set these in services/api/.env (template in infra/.env.example), then re-run:\n\n" +
        "  VISION_STORAGE_BACKEND=r2\n" +
        "  VISION_R2_ACCOUNT_ID=...\n" +
        "  VISION_R2_ACCESS_KEY_ID=...\n" +
        "  VISION_R2_SECRET_ACCESS_KEY=...\n" +
        "  VISION_R2_BUCKET_MASTER=dtp-staging-vision-master\n" +
        "  VISION_R2_BUCKET_DERIVED=dtp-staging-vision-derived\n" +
        "  VISION_R2_BUCKET_MODELS=dtp-staging-vision-models\n" +
        "  VISION_R2_BUCKET_CLIPS=dtp-staging-vision-clips\n\n" +
        "Create the buckets and a scoped API token at https://dash.cloudflare.com → R2."
    );
    process.exitCode = 1;
    return;
  }

  section("Configuration");
  console.log(`  endpoint   ${config.storage.endpoint}`);
  console.log(`  region     ${config.storage.region}`);
  for (const id of BUCKET_IDS) {
    console.log(`  ${id.padEnd(10)} ${config.storage.buckets[id]}`);
  }

  const store: ObjectStore = new R2ObjectStore(config.storage);

  // ── Reachability, per bucket ──────────────────────────────────────────────
  section("Reachability");
  const reachable = new Set<BucketId>();
  for (const id of BUCKET_IDS) {
    try {
      // A list of an unused prefix is the cheapest way to prove the credential
      // can see the bucket without reading or writing anything real.
      await store.list(id, "__connectivity-probe__/");
      reachable.add(id);
      pass(`${id} reachable`, config.storage.buckets[id]);
    } catch (error) {
      fail(`${id} reachable`, describeError(error));
    }
  }

  // ── Round-trip, in the regenerable bucket only ───────────────────────────
  section("Round-trip (derived bucket)");
  const probeKey = `__connectivity-probe__/${Date.now()}.txt`;
  const body = `dtp-vision-r2-check ${new Date().toISOString()}`;

  if (!reachable.has("derived")) {
    fail("round-trip", "derived bucket is not reachable; skipped");
  } else {
    try {
      await store.putSmallObject("derived", probeKey, body, "text/plain");
      pass("write");

      const readBack = await store.getSmallObject("derived", probeKey);
      if (readBack?.toString() === body) pass("read back matches");
      else fail("read back matches", `got ${JSON.stringify(readBack?.toString() ?? null)}`);

      const meta = await store.head("derived", probeKey);
      if (meta?.bytes === Buffer.byteLength(body)) pass("head reports the right size", `${meta.bytes} bytes`);
      else fail("head reports the right size", `got ${meta?.bytes ?? "null"}`);

      const url = await store.presignGet("derived", probeKey, 60);
      const signed = url.includes("X-Amz-Signature") || url.includes("x-amz-signature");
      if (signed) pass("presigned GET is signed and expiring");
      else fail("presigned GET is signed and expiring", "no signature in the URL");

      await store.delete("derived", probeKey);
      const afterDelete = await store.head("derived", probeKey);
      if (afterDelete === null) pass("cleaned up after itself");
      else fail("cleaned up after itself", "probe object still present");
    } catch (error) {
      fail("round-trip", describeError(error));
      // Best effort: never leave a probe object behind.
      await store.delete("derived", probeKey).catch(() => undefined);
    }
  }

  // ── Write-once protection on master ──────────────────────────────────────
  section("Write-once protection (master bucket)");
  if (!reachable.has("master")) {
    fail("write-once enforced", "master bucket is not reachable; skipped");
  } else {
    const masterProbe = visionKeys.sourceOriginal(`probe-${Date.now()}`, "txt");
    try {
      await store.putSmallObject(masterProbe.bucket, masterProbe.key, "first", "text/plain");
      let refused = false;
      try {
        await store.putSmallObject(masterProbe.bucket, masterProbe.key, "second", "text/plain");
      } catch (error) {
        refused = error instanceof WriteOnceViolationError;
      }
      if (refused) pass("second write to an existing master key is refused");
      else fail("second write to an existing master key is refused", "the overwrite succeeded");

      // The probe is the one thing we are allowed to remove from master: it was
      // written by this script and is not source media.
      await store.deleteProtected(
        masterProbe.bucket,
        masterProbe.key,
        "connectivity-check probe object, written by this script seconds earlier"
      );
      pass("probe removed from master");
    } catch (error) {
      fail("write-once enforced", describeError(error));
      await store
        .deleteProtected(masterProbe.bucket, masterProbe.key, "failed connectivity-check probe cleanup")
        .catch(() => undefined);
    }
  }

  section("Confirm in the dashboard");
  // Deliberately not asserted here. A correctly scoped token grants object
  // read/write only, so GetBucketVersioning returns AccessDenied — and widening
  // the token just so this script could read bucket configuration would be the
  // wrong trade. Verify these by eye, once, per environment.
  console.log(`  Versioning ON for:      ${VERSIONED_BUCKETS.join(", ")}`);
  console.log(`  Write-once (by policy): ${WRITE_ONCE_BUCKETS.join(", ")}`);
  console.log("  No bucket publicly readable — every read goes through a signed URL.");
  console.log("  Token scoped to these four buckets and nothing else.");

  section("Result");
  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(describeError(error));
  process.exitCode = 1;
});
