/**
 * Phase 1 Increment 5 gate — the operator workflow, and a partner upload.
 *
 *   pnpm --filter @dtp/api vision:catalogcheck
 *
 * Drives the whole human path through the live API: register a partner, attach
 * rights evidence, record a signatory, catalogue a source, grant scopes, authorise
 * acquisition, issue an upload link — then upload a file **holding nothing but
 * that link**, with no DTP account at all.
 *
 * That last part is the point of this increment: until now nobody outside DTP
 * could hand over a file.
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
const PART_BYTES = 5 * 1024 * 1024;

const prisma = new PrismaClient();

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(60)} ${ok ? String(actual) : `expected ${expected}, got ${actual}`}`
  );
}

function section(t: string) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}

function adminHeaders(): Record<string, string> {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) throw new Error("ADMIN_API_KEY is not set");
  return { "x-admin-api-key": key, "Content-Type": "application/json" };
}

async function call(path: string, init: RequestInit, headers: Record<string, string>) {
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const api = (path: string, init?: RequestInit) => call(path, init ?? {}, adminHeaders());

/** A partner client: it holds the link and nothing else. */
const asPartner = (token: string) => (path: string, init?: RequestInit) =>
  call(path, init ?? {}, { "x-vision-upload-token": token, "Content-Type": "application/json" });

async function main() {
  const config = loadVisionConfig();
  const store: ObjectStore =
    config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();

  console.log("Vision catalog and partner upload — operator workflow");
  console.log(`  object store ${store.backendId}`);

  const suffix = randomUUID().slice(0, 8);
  let partnerId: string | null = null;
  let uploadedKey: string | null = null;

  try {
    // ── Partner and evidence ──────────────────────────────────────────────
    section("Partner");
    const partner = await api("/vision/partners", {
      method: "POST",
      body: JSON.stringify({ name: `Catalog check ${suffix}`, contactName: "Team Manager" }),
    });
    partnerId = partner.id;
    check("partner registered", Boolean(partner.id), true);

    const evidence = await api(`/vision/partners/${partner.id}/evidence`, {
      method: "POST",
      body: JSON.stringify({ kind: "contract", extension: "pdf" }),
    });
    check("evidence upload URL issued", typeof evidence.uploadUrl, "string");
    check("evidence lands in the master bucket", evidence.bucket, "master");

    const putEvidence = await fetch(evidence.uploadUrl, {
      method: "PUT",
      body: Buffer.from("%PDF-1.4 signed agreement"),
      headers: { "Content-Type": "application/pdf" },
    });
    check("agreement document stored", putEvidence.ok, true);

    const signatory = await api(`/vision/partners/${partner.id}/signatories`, {
      method: "POST",
      body: JSON.stringify({ name: "A. Manager", role: "Team Manager" }),
    });
    check("authorized signatory recorded", signatory.role, "Team Manager");

    // ── Catalogue ─────────────────────────────────────────────────────────
    section("Catalogue");
    const source = await api("/vision/sources", {
      method: "POST",
      body: JSON.stringify({
        partnerId: partner.id,
        url: `https://example.test/watch?v=${suffix}`,
        title: "Catalogued match",
        sourceQualityRank: "original_master",
        rightsOwnerName: "Partner Videography Ltd",
      }),
    });
    // Cataloguing grants nothing. That is the whole separation.
    check("registering a URL leaves it catalogued only", source.acquisitionStatus, "catalogued");

    const imported = await api("/vision/sources/import", {
      method: "POST",
      body: JSON.stringify({
        partnerId: partner.id,
        rows: [
          { url: `https://example.test/watch?v=${suffix}-a`, title: "Bulk A" },
          { url: `https://example.test/watch?v=${suffix}-b`, title: "Bulk B" },
          { title: "No locator at all" },
        ],
      }),
    });
    check("bulk import created the rows with a locator", imported.created, 2);
    check("and skipped the one without", imported.skipped.length, 1);

    // ── Rights ────────────────────────────────────────────────────────────
    section("Rights");
    const detailBefore = await api(`/vision/sources/${source.id}`);
    check("no analysis right yet", detailBefore.decisions.canAnalyze.allowed, false);
    check("and the reason is actionable", detailBefore.decisions.canAnalyze.reason, "no_scope");

    let refusedTwoTargets = false;
    try {
      await api("/vision/rights/scopes", {
        method: "POST",
        body: JSON.stringify({ partnerId: partner.id, playerId: randomUUID(), canAnalyze: true }),
      });
    } catch (error) {
      refusedTwoTargets = /exactly one of/.test(String(error));
    }
    check("a grant with two targets is refused", refusedTwoTargets, true);

    await api("/vision/rights/scopes", {
      method: "POST",
      body: JSON.stringify({
        partnerId: partner.id,
        canAnalyze: true,
        canTrain: true,
        evidenceId: evidence.evidenceId,
      }),
    });
    const detailAfter = await api(`/vision/sources/${source.id}`);
    check("analysis granted", detailAfter.decisions.canAnalyze.allowed, true);
    check("publication still not granted", detailAfter.decisions.canPublishHighlight.allowed, false);

    // ── Acquisition ───────────────────────────────────────────────────────
    section("Acquisition");
    let linkRefused = false;
    try {
      await api(`/vision/sources/${source.id}/upload-grant`, { method: "POST", body: "{}" });
    } catch (error) {
      linkRefused = /pending_acquisition/.test(String(error));
    }
    // Issuing a link before acquisition is authorised would hand out exactly the
    // permission the workflow withholds.
    check("no upload link before acquisition is authorized", linkRefused, true);

    let wrongSignatory = false;
    try {
      await api(`/vision/sources/${source.id}/authorize-acquisition`, {
        method: "POST",
        body: JSON.stringify({
          acquisitionMethod: "partner_direct_upload",
          signatoryId: randomUUID(),
        }),
      });
    } catch (error) {
      wrongSignatory = /signatory must belong/.test(String(error));
    }
    check("a signatory from another partner is refused", wrongSignatory, true);

    const authorized = await api(`/vision/sources/${source.id}/authorize-acquisition`, {
      method: "POST",
      body: JSON.stringify({
        acquisitionMethod: "partner_direct_upload",
        signatoryId: signatory.id,
      }),
    });
    check("acquisition authorized", authorized.acquisitionStatus, "authorized");
    check("and records who approved it", authorized.acquisitionAuthorizedBySignatoryId, signatory.id);

    // ── The point: a partner uploads with no DTP account ──────────────────
    section("Partner upload");
    const link = await api(`/vision/sources/${source.id}/upload-grant`, {
      method: "POST",
      body: JSON.stringify({ expiresInHours: 24, allowedMimeTypes: ["video/mp4"] }),
    });
    check("upload link issued, token shown once", typeof link.token, "string");

    const partner1 = asPartner(link.token);
    const whatIsThisFor = await partner1("/vision/partner-uploads/grant");
    check("the link tells its holder what it is for", whatIsThisFor.sourceVideoRecordId, source.id);

    let wrongType = false;
    try {
      await partner1("/vision/partner-uploads", {
        method: "POST",
        body: JSON.stringify({ mimeType: "application/zip" }),
      });
    } catch (error) {
      wrongType = /accepts video\/mp4/.test(String(error));
    }
    check("a media type the link forbids is refused", wrongType, true);

    const session = await partner1("/vision/partner-uploads", {
      method: "POST",
      body: JSON.stringify({ mimeType: "video/mp4", expectedBytes: PART_BYTES }),
    });
    uploadedKey = session.key;
    check("session opened by the partner alone", session.state, "in_progress");

    const signed = await partner1(`/vision/partner-uploads/${session.id}/parts`, {
      method: "POST",
      body: JSON.stringify({ partNumbers: [1] }),
    });
    const put = await fetch(signed.parts[0].url, {
      method: "PUT",
      body: Buffer.alloc(PART_BYTES, "M"),
      headers: { "Content-Type": "video/mp4" },
    });
    check("partner uploaded straight to storage", put.ok, true);

    const completed = await partner1(`/vision/partner-uploads/${session.id}/complete`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    check("partner completed the upload", completed.state, "completed");
    check("ingestion queued automatically", completed.jobsQueued.length, 2);

    const stored = await store.head("master", session.key);
    check("file is in the master bucket", stored?.bytes, PART_BYTES);

    // One grant, one upload.
    let reuseRefused = false;
    try {
      await partner1("/vision/partner-uploads", {
        method: "POST",
        body: JSON.stringify({ mimeType: "video/mp4" }),
      });
    } catch (error) {
      reuseRefused = /already been used/.test(String(error));
    }
    check("the link cannot be used twice", reuseRefused, true);

    // A partner token must not reach anything else.
    let staffRouteRefused = false;
    try {
      await partner1("/vision/sources");
    } catch (error) {
      staffRouteRefused = /HTTP 401/.test(String(error));
    }
    check("a partner token cannot reach a staff route", staffRouteRefused, true);

    // ── Impact, before revoking anything ──────────────────────────────────
    section("Impact");
    const impact = await api(`/vision/sources/${source.id}/impact`);
    check("impact counts the acquired asset", impact.assets, 1);
    check("and the live grants", impact.liveScopes >= 0, true);
  } finally {
    section("Cleanup");
    if (uploadedKey) {
      await store
        .deleteProtected("master", uploadedKey, "catalog-check fixture")
        .catch(() => undefined);
    }
    if (partnerId) {
      const ev = await prisma.visionRightsEvidence.findMany({
        where: { partnerId },
        select: { objectKey: true },
      });
      for (const row of ev) {
        if (row.objectKey) {
          await store.deleteProtected("master", row.objectKey, "catalog-check fixture").catch(() => undefined);
        }
      }
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
      where: { name: { startsWith: "Catalog check " } },
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
