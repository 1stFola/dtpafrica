/**
 * Upload a video from this machine into the Vision Engine, through the API.
 *
 *   pnpm --filter @dtp/api vision:upload -- --source <sourceVideoRecordId> --file /path/to/match.mp4
 *   pnpm --filter @dtp/api vision:upload -- --source <id> --file match.mp4 --api http://54.225.155.75/api/v1 --key <ADMIN_API_KEY>
 *
 * The bytes never pass through the API (docs/vision/19): the API opens a
 * resumable session and signs a URL per part, this script PUTs each part to
 * the object store, and `complete` makes the asset and queues probe and
 * fingerprint. Parts are 8 MiB (the store needs at least 5 MiB for every part
 * but the last); a part that fails is retried, and if the script dies the
 * session can be resumed by running it again with `--resume <sessionId>`.
 *
 * `--api` defaults to the local API; `--key` to ADMIN_API_KEY from the API's
 * .env. The source must already exist in the catalogue with a rights scope
 * that allows analysis, or the asset is stored but nothing is queued.
 */
import { createReadStream, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { loadApiEnv } from "../src/shared/load-dotenv";

loadApiEnv();

const PART_BYTES = 8 * 1024 * 1024;
const MIME_BY_EXT: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".webm": "video/webm", ".avi": "video/x-msvideo", ".ts": "video/mp2t", ".m4v": "video/x-m4v" };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const API = (arg("api") ?? process.env.VISION_E2E_API ?? "http://localhost:3000/api/v1").replace(/\/$/, "");
const KEY = arg("key") ?? process.env.ADMIN_API_KEY?.trim();
const SOURCE = arg("source");
const FILE = arg("file");
const RESUME = arg("resume");

type Session = { id: string; state: string; videoAssetId: string | null; receivedParts: { partNumber: number; bytes: number }[]; expectedBytes?: number | null; jobsQueued?: string[] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!KEY) throw new Error("No admin key: pass --key or set ADMIN_API_KEY");
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", "x-admin-api-key": KEY, ...(init?.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function readPart(file: string, partNumber: number, totalBytes: number): Promise<Buffer> {
  const start = (partNumber - 1) * PART_BYTES;
  const end = Math.min(start + PART_BYTES, totalBytes) - 1;
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(file, { start, end })) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function putPart(url: string, body: Buffer, attempt = 1): Promise<string> {
  try {
    const res = await fetch(url, { method: "PUT", body: new Uint8Array(body), headers: { "Content-Length": String(body.length) } });
    if (!res.ok) throw new Error(`store answered ${res.status}`);
    const etag = res.headers.get("etag");
    if (!etag) throw new Error("store returned no ETag");
    return etag;
  } catch (error) {
    if (attempt >= 4) throw error;
    const wait = 1000 * 2 ** attempt;
    console.log(`  part failed (${error instanceof Error ? error.message : String(error)}); retrying in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return putPart(url, body, attempt + 1);
  }
}

async function main() {
  if (!FILE || (!SOURCE && !RESUME)) {
    console.error("usage: vision:upload -- --source <sourceVideoRecordId> --file <video> [--api URL] [--key ADMIN_API_KEY] [--resume <sessionId>]");
    process.exitCode = 2;
    return;
  }
  const totalBytes = statSync(FILE).size;
  const parts = Math.max(1, Math.ceil(totalBytes / PART_BYTES));
  const ext = extname(FILE).toLowerCase();
  const mimeType = arg("mime") ?? MIME_BY_EXT[ext] ?? "application/octet-stream";
  console.log(`${basename(FILE)}: ${(totalBytes / 1024 / 1024).toFixed(1)} MiB in ${parts} part(s), ${mimeType}, to ${API}`);

  let session: Session;
  if (RESUME) {
    session = await api<Session>(`/vision/uploads/${RESUME}`);
    console.log(`resuming session ${session.id}: ${session.receivedParts.length} part(s) already there`);
  } else {
    session = await api<Session>("/vision/uploads", {
      method: "POST",
      body: JSON.stringify({ sourceVideoRecordId: SOURCE, mimeType, expectedBytes: totalBytes, extension: ext.replace(".", "").slice(0, 8) || undefined }),
    });
    console.log(`session ${session.id} opened (keep this id to resume)`);
  }

  const have = new Set(session.receivedParts.map((p) => p.partNumber));
  const todo = Array.from({ length: parts }, (_, i) => i + 1).filter((n) => !have.has(n));
  const etags = new Map<number, string>();
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    const signed = await api<{ parts: { partNumber: number; url: string }[] }>(`/vision/uploads/${session.id}/parts`, { method: "POST", body: JSON.stringify({ partNumbers: batch }) });
    for (const n of batch) {
      const url = signed.parts.find((p) => p.partNumber === n)?.url;
      if (!url) throw new Error(`no signed URL for part ${n}`);
      const body = await readPart(FILE, n, totalBytes);
      const etag = await putPart(url, body);
      etags.set(n, etag);
      console.log(`  part ${n}/${parts} sent (${(body.length / 1024 / 1024).toFixed(1)} MiB)`);
    }
  }

  // The server prefers what the store actually holds over what we report, so
  // the etags are a courtesy for the parts sent in this run.
  const completed = await api<Session>(`/vision/uploads/${session.id}/complete`, {
    method: "POST",
    body: JSON.stringify({ parts: [...etags.entries()].map(([partNumber, etag]) => ({ partNumber, etag })) }),
  });
  console.log(`completed: state ${completed.state}, asset ${completed.videoAssetId ?? "(none)"}, jobs queued ${completed.jobsQueued?.length ?? 0}`);
  if (completed.videoAssetId) {
    console.log(`next: open the source in the admin app and queue transcode on this asset, or`);
    console.log(`      curl -X POST ${API}/vision/jobs -H "x-admin-api-key: …" -H "Content-Type: application/json" -d '{"type":"transcode","videoAssetId":"${completed.videoAssetId}"}'`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
