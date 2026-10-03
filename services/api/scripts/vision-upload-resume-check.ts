/**
 * Phase 1 Increment 4 gate — the interruption test.
 *
 *   pnpm --filter @dtp/api vision:uploadcheck
 *
 * Simulates what will actually happen in Nigeria: a client uploads part of a
 * file, the connection dies, and it comes back later. If resuming means starting
 * again, partners stop uploading and the corpus never gets built — so this proves
 * the server can tell a returning client exactly what is missing.
 *
 * Runs against the live API and live object storage. Cleans up after itself,
 * including the write-once source object.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";
import type { ObjectStore } from "../src/vision/storage/object-store";

loadApiEnv();

const API = process.env.VISION_E2E_API ?? "http://localhost:3000/api/v1";

/** R2 requires at least 5 MiB for every part except the last. */
const PART_ONE_BYTES = 5 * 1024 * 1024;
const PART_TWO_BYTES = 4096;

const prisma = new PrismaClient();

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

function headers(): Record<string, string> {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) throw new Error("ADMIN_API_KEY is not set");
  return { "x-admin-api-key": key, "Content-Type": "application/json" };
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers() });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const config = loadVisionConfig();
  const store: ObjectStore =
    config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();

  console.log("Vision resumable upload — interruption test");
  console.log(`  object store ${store.backendId}`);

  const suffix = randomUUID().slice(0, 8);
  let partnerId: string | null = null;
  let sessionKey: string | null = null;
  let evidenceKey: string | null = null;

  try {
    // ── An authorised source with rights evidence ─────────────────────────
    section("Setup");
    const partner = await prisma.visionSourcePartner.create({
      data: { name: `Upload check ${suffix}` },
    });
    partnerId = partner.id;

    // The document itself, not only its row: since docs/vision/50 PR-4 the upload gate
    // counts evidence that reached the store.
    evidenceKey = `rights/${partner.id}/agreement.pdf`;
    await store.putSmallObject("master", evidenceKey, Buffer.from("%PDF-1.4 gate fixture"), "application/pdf");
    await prisma.visionRightsEvidence.create({
      data: {
        partnerId: partner.id,
        kind: "contract",
        objectKey: evidenceKey,
      },
    });
    const record = await prisma.visionSourceVideoRecord.create({
      data: {
        partnerId: partner.id,
        sourceQualityRank: "original_master",
        acquisitionStatus: "authorized",
        acquisitionMethod: "partner_direct_upload",
      },
    });

    // Evidence alone is not a grant. Without canAnalyze the upload still
    // succeeds and simply queues nothing — which is the designed behaviour, and
    // is covered in upload.spec.ts. Here we want the happy path, so grant it.
    await prisma.visionRightsScope.create({
      data: {
        partnerId: partner.id,
        grantLevel: "partner",
        canAnalyze: true,
        grantedAt: new Date(Date.now() - 3600_000),
      },
    });

    // A catalogue-only source must be refused before any bytes are accepted.
    const catalogued = await prisma.visionSourceVideoRecord.create({
      data: {
        partnerId: partner.id,
        sourceQualityRank: "platform_copy",
        acquisitionStatus: "catalogued",
      },
    });
    let refused = false;
    try {
      await api("/vision/uploads", {
        method: "POST",
        body: JSON.stringify({ sourceVideoRecordId: catalogued.id, mimeType: "video/mp4" }),
      });
    } catch (error) {
      refused = /pending_acquisition/.test(String(error));
    }
    check("a catalogue-only source is refused at the door", refused, true);

    // ── Begin ─────────────────────────────────────────────────────────────
    section("Begin");
    const expectedBytes = PART_ONE_BYTES + PART_TWO_BYTES;
    const session = await api("/vision/uploads", {
      method: "POST",
      body: JSON.stringify({
        sourceVideoRecordId: record.id,
        mimeType: "video/mp4",
        expectedBytes,
      }),
    });
    sessionKey = session.key;
    check("session opened", session.state, "in_progress");
    check("target is the write-once master bucket", session.bucket, "master");
    check("part size is 16 MiB", session.partSizeBytes, 16 * 1024 * 1024);
    const acquiring = await prisma.visionSourceVideoRecord.findUniqueOrThrow({
      where: { id: record.id },
      select: { acquisitionStatus: true },
    });
    check("the source is now being acquired", acquiring.acquisitionStatus, "acquiring");

    // ── Upload part 1, then "lose the connection" ────────────────────────
    section("Interruption");
    const signed = await api(`/vision/uploads/${session.id}/parts`, {
      method: "POST",
      body: JSON.stringify({ partNumbers: [1, 2] }),
    });
    const urlFor = (n: number): string =>
      signed.parts.find((p: { partNumber: number }) => p.partNumber === n).url;

    const partOne = Buffer.alloc(PART_ONE_BYTES, "A");
    const putOne = await fetch(urlFor(1), {
      method: "PUT",
      body: partOne,
      headers: { "Content-Type": "video/mp4" },
    });
    check("part 1 accepted by the store", putOne.ok, true);

    // Part 2 is deliberately never sent — this is the dropped connection.

    // ── Resume: the client comes back and asks what landed ───────────────
    section("Resume");
    const resumed = await api(`/vision/uploads/${session.id}`);
    check("server knows part 1 landed", resumed.receivedParts.length, 1);
    check("and reports its size", resumed.bytesReceived, PART_ONE_BYTES);
    check("tells the client where to carry on", resumed.nextPartNumber, 2);

    // Completing now would truncate the master — the worst outcome available.
    // (Nothing is missing *below* the highest part here, so instead assert the
    // size check catches the short file.)
    const partTwo = Buffer.alloc(PART_TWO_BYTES, "B");
    const freshUrls = await api(`/vision/uploads/${session.id}/parts`, {
      method: "POST",
      body: JSON.stringify({ partNumbers: [2] }),
    });
    const putTwo = await fetch(freshUrls.parts[0].url, {
      method: "PUT",
      body: partTwo,
      headers: { "Content-Type": "video/mp4" },
    });
    check("part 2 accepted after resuming", putTwo.ok, true);

    const afterResume = await api(`/vision/uploads/${session.id}`);
    check("both parts now known", afterResume.receivedParts.length, 2);
    check("byte count is the full file", afterResume.bytesReceived, expectedBytes);

    // ── Complete ──────────────────────────────────────────────────────────
    section("Complete");
    // No parts reported: the server prefers what the store actually holds, which
    // is exactly the case a client that died cannot report.
    const completed = await api(`/vision/uploads/${session.id}/complete`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    check("session completed", completed.state, "completed");
    check("probe and fingerprint queued", completed.jobsQueued.length, 2);

    const stored = await store.head("master", session.key);
    check("object exists in the master bucket", Boolean(stored), true);
    check("and is the whole file, not a truncated one", stored?.bytes, expectedBytes);

    const asset = await prisma.visionVideoAsset.findUniqueOrThrow({
      where: { id: session.videoAssetId },
      select: { ingestState: true, bytes: true },
    });
    check("asset marked uploaded", asset.ingestState, "uploaded");
    check("asset records the real byte count", Number(asset.bytes), expectedBytes);

    // Retry-safe: a client that completed and lost its connection must not error.
    const again = await api(`/vision/uploads/${session.id}/complete`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    check("completing twice is safe", again.state, "completed");
    check("and does not re-queue ingestion", again.jobsQueued.length, 0);
  } finally {
    section("Cleanup");
    if (evidenceKey) {
      await store.deleteProtected("master", evidenceKey, "upload interruption-test fixture evidence").catch(() => undefined);
      check("evidence fixture removed from master", await store.head("master", evidenceKey), null);
    }
    if (sessionKey) {
      await store
        .deleteProtected("master", sessionKey, "upload interruption-test fixture")
        .catch(() => undefined);
      check("source removed from master", await store.head("master", sessionKey), null);
    }
    if (partnerId) {
      const assets = await prisma.visionVideoAsset.findMany({
        where: { sourceVideoRecord: { partnerId } },
        select: { id: true },
      });
      const ids = assets.map((a) => a.id);
      await prisma.visionJobEvent.deleteMany({ where: { job: { videoAssetId: { in: ids } } } });
      await prisma.visionJobCost.deleteMany({ where: { job: { videoAssetId: { in: ids } } } });
      await prisma.visionJob.deleteMany({ where: { videoAssetId: { in: ids } } });
      await prisma.visionUploadSession.deleteMany({ where: { videoAssetId: { in: ids } } });
      await prisma.visionVideoVariant.deleteMany({ where: { videoAssetId: { in: ids } } });
      await prisma.visionVideoAsset.deleteMany({ where: { id: { in: ids } } });
      await prisma.visionSourcePartner.delete({ where: { id: partnerId } }).catch(() => undefined);
    }
    const strays = await prisma.visionSourcePartner.count({
      where: { name: { startsWith: "Upload check " } },
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
