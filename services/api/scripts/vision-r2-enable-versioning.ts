/**
 * Enable R2 object versioning on the write-once buckets.
 *
 *   pnpm --filter @dtp/api vision:r2-versioning
 *
 * Runs once per environment, with a DIFFERENT credential from the application's.
 *
 * The app token is scoped to object read/write, so PutBucketVersioning returns
 * AccessDenied — which is correct: a credential the API holds in production must
 * not be able to reconfigure a bucket. This script therefore reads its own
 * admin-scoped keys and will refuse to fall back to the app token.
 *
 * Create a TEMPORARY R2 API token with "Admin Read & Write", put it in
 * services/api/.env as:
 *
 *   VISION_R2_ADMIN_ACCESS_KEY_ID=...
 *   VISION_R2_ADMIN_SECRET_ACCESS_KEY=...
 *
 * run this, confirm the output, then DELETE both the token in Cloudflare and
 * those two lines. Nothing in the application reads them.
 */
import {
  GetBucketVersioningCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { VERSIONED_BUCKETS } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";

async function main() {
  loadApiEnv();
  const storage = loadVisionConfig().storage;

  if (storage.backend !== "r2") {
    console.error(`Storage backend is "${storage.backend}", not "r2". Nothing to do.`);
    process.exitCode = 1;
    return;
  }

  const adminKeyId = process.env.VISION_R2_ADMIN_ACCESS_KEY_ID?.trim();
  const adminSecret = process.env.VISION_R2_ADMIN_SECRET_ACCESS_KEY?.trim();

  if (!adminKeyId || !adminSecret) {
    console.error(
      "Admin credentials are required and are deliberately separate from the app token.\n\n" +
        "In the Cloudflare dashboard: R2 -> Manage R2 API Tokens -> Create, with\n" +
        '"Admin Read & Write". Then add to services/api/.env:\n\n' +
        "  VISION_R2_ADMIN_ACCESS_KEY_ID=...\n" +
        "  VISION_R2_ADMIN_SECRET_ACCESS_KEY=...\n\n" +
        "Re-run this, then delete the token AND those two lines. The application\n" +
        "never reads them, and it must not be able to reconfigure a bucket."
    );
    process.exitCode = 1;
    return;
  }

  // Refuse to proceed if someone pasted the app token in as the admin one: it
  // would fail with AccessDenied anyway, but the error is clearer here.
  if (adminKeyId === storage.accessKeyId) {
    console.error(
      "The admin key id is identical to the application key id.\n" +
        "This needs a separate token with Admin Read & Write — the app token cannot\n" +
        "change bucket configuration, by design."
    );
    process.exitCode = 1;
    return;
  }

  const s3 = new S3Client({
    region: storage.region,
    endpoint: storage.endpoint as string,
    credentials: { accessKeyId: adminKeyId, secretAccessKey: adminSecret },
    forcePathStyle: true,
  });

  let failures = 0;

  console.log("Enabling object versioning on the write-once buckets\n");

  for (const id of VERSIONED_BUCKETS) {
    const bucket = storage.buckets[id];
    if (!bucket) {
      console.log(`  SKIP  ${id.padEnd(8)} no bucket configured`);
      failures += 1;
      continue;
    }

    try {
      await s3.send(
        new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: "Enabled" },
        })
      );
      // Read it back rather than trusting the write: a 200 on PUT is not proof
      // the setting took effect.
      const after = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }));
      const status = after.Status ?? "Disabled";
      if (status === "Enabled") {
        console.log(`  PASS  ${id.padEnd(8)} ${bucket} -> Enabled`);
      } else {
        console.log(`  FAIL  ${id.padEnd(8)} ${bucket} -> reported ${status} after enabling`);
        failures += 1;
      }
    } catch (error) {
      const err = error as Error & { $metadata?: { httpStatusCode?: number } };
      const status = err.$metadata?.httpStatusCode;
      console.log(
        `  FAIL  ${id.padEnd(8)} ${bucket} -> ${err.name}${status ? ` (HTTP ${status})` : ""}: ${err.message}`
      );
      if (err.name === "AccessDenied") {
        console.log("        The token lacks Admin Read & Write on this bucket.");
      }
      failures += 1;
    }
  }

  console.log(
    failures === 0
      ? "\nDone. Now delete the temporary token in Cloudflare and remove the two\n" +
          "VISION_R2_ADMIN_* lines from services/api/.env."
      : `\n${failures} bucket(s) not enabled. Nothing else was changed.`
  );

  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
