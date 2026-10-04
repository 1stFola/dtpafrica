import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { VisionIdentityService } from "./identity.service";

/**
 * The review view of an asset's tracks: which run, how many, and whether the
 * answer is all of them. The fake holds rows and honours the filter, the order,
 * the skip and the take it is given, so a query that asks for the wrong rows
 * answers wrongly here.
 */
const ASSET = "asset-1";
type Row = { id: string; videoAssetId: string; inferenceJobId: string; localTrackId: number; class: string; startMs: number; endMs: number; artifactKey: string; teamAssignments: never[]; identities: Record<string, unknown>[] };

const row = (id: string, job: string, startMs: number, identities: Record<string, unknown>[] = []): Row => ({
  id,
  videoAssetId: ASSET,
  inferenceJobId: job,
  localTrackId: Number(id.split("-")[1]),
  class: "player",
  startMs,
  endMs: startMs + 1000,
  artifactKey: `inference/${job}/1/tracks.json`,
  teamAssignments: [],
  identities,
});
const accepted = { id: "ia-pub", supersededBy: null, reviewState: "accepted", playerId: "p-1", matchSquadPlayerId: null, validFromMs: 0 };
const waiting = { id: "ia-wait", supersededBy: null, reviewState: "unreviewed", playerId: "p-2", matchSquadPlayerId: null, validFromMs: 0 };

let rows: Row[];
type Where = { videoAssetId?: string; inferenceJobId?: string; identities?: { some: Record<string, unknown> } };
const isPublic = (a: Record<string, unknown>) => a.supersededBy === null && a.reviewState === "accepted" && a.playerId !== null;
const matching = (where: Where) =>
  rows.filter((r) => (!where.videoAssetId || r.videoAssetId === where.videoAssetId) && (!where.inferenceJobId || r.inferenceJobId === where.inferenceJobId) && (!where.identities || r.identities.some(isPublic)));

const prisma = {
  visionVideoAsset: { findUnique: vi.fn(async () => ({ id: ASSET, sbMatchId: null, sbMatch: null, variants: [] })) },
  visionTrack: {
    count: vi.fn(async ({ where }: { where: Where }) => matching(where).length),
    groupBy: vi.fn(async ({ where }: { where: Where }) => [...new Set(matching(where).map((r) => r.inferenceJobId))].map((inferenceJobId) => ({ inferenceJobId }))),
    findMany: vi.fn(async ({ where, skip = 0, take, include }: { where: Where; skip?: number; take?: number; include?: { identities?: { where?: { reviewState?: string } } } }) => {
      const publicOnly = include?.identities?.where?.reviewState === "accepted";
      return matching(where)
        .sort((a, b) => a.startMs - b.startMs || a.localTrackId - b.localTrackId || a.id.localeCompare(b.id))
        .slice(skip, take === undefined ? undefined : skip + take)
        .map((r) => ({ ...r, identities: publicOnly ? r.identities.filter(isPublic) : r.identities }));
    }),
  },
  visionJob: {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      [
        { id: "job-z-old", finishedAt: new Date("2026-10-01T10:00:00Z"), queuedAt: new Date("2026-10-01T09:00:00Z") },
        { id: "job-a-new", finishedAt: new Date("2026-10-03T10:00:00Z"), queuedAt: new Date("2026-10-03T09:00:00Z") },
      ].filter((j) => where.id.in.includes(j.id))
    ),
  },
  visionTeamSide: { findMany: vi.fn(async () => []) },
  sbMatchSquadPlayer: { findMany: vi.fn(async () => []) },
};
const clock = { currentAnchors: vi.fn(async () => []) };

let service: VisionIdentityService;
beforeEach(() => {
  vi.clearAllMocks();
  rows = [
    row("old-1", "job-z-old", 0, [accepted]),
    row("old-2", "job-z-old", 1000),
    row("new-1", "job-a-new", 0, [waiting]),
    row("new-2", "job-a-new", 1000),
    row("new-3", "job-a-new", 2000),
  ];
  service = new VisionIdentityService(prisma as never, { record: vi.fn() } as never, new InMemoryObjectStore(), { playback: { urlTtlSeconds: 600 } } as never, clock as never);
});

describe("an asset's tracks, for a reviewer", () => {
  it("are the latest run's, and the answer says which run and how many there are", async () => {
    const out = await service.forAsset(ASSET);
    expect(out.tracks.map((t) => t.id)).toEqual(["new-1", "new-2", "new-3"]);
    // The older run's id sorts after the newer one's: latest is by when the job finished.
    expect(out).toMatchObject({ trackJobId: "job-a-new", trackJobs: 2, total: 3, count: 3, truncated: false, offset: 0 });
  });

  it("are every run's when asked, or one named run's", async () => {
    const all = await service.forAsset(ASSET, { job: "all" });
    expect(all.tracks).toHaveLength(5);
    expect(all).toMatchObject({ trackJobId: null, trackJobs: 2, total: 5 });
    const old = await service.forAsset(ASSET, { job: "job-z-old" });
    expect(old.tracks.map((t) => t.id)).toEqual(["old-1", "old-2"]);
    expect(old.trackJobId).toBe("job-z-old");
  });

  it("come a page at a time, and say when there are more", async () => {
    const first = await service.forAsset(ASSET, { limit: 2 });
    expect(first.tracks.map((t) => t.id)).toEqual(["new-1", "new-2"]);
    // It stopped at its cap and called what it had the count.
    expect(first).toMatchObject({ count: 2, total: 3, truncated: true, limit: 2 });
    const rest = await service.forAsset(ASSET, { limit: 2, offset: 2 });
    expect(rest.tracks.map((t) => t.id)).toEqual(["new-3"]);
    expect(rest).toMatchObject({ count: 1, total: 3, truncated: false, offset: 2 });
  });

  it("clamp a page size that is absurd, and an offset below zero", async () => {
    expect((await service.forAsset(ASSET, { limit: 0 })).limit).toBe(1);
    expect((await service.forAsset(ASSET, { limit: 1_000_000 })).limit).toBe(5000);
    expect((await service.forAsset(ASSET, { offset: -5 })).offset).toBe(0);
    expect((await service.forAsset(ASSET)).limit).toBe(2000);
  });

  it("are none, with no run named, on footage that was never tracked", async () => {
    rows = [];
    expect(await service.forAsset(ASSET)).toMatchObject({ tracks: [], trackJobId: null, trackJobs: 0, total: 0, truncated: false });
  });
});

describe("an asset's tracks, for the public", () => {
  it("are those with an accepted, named identity, from every run: a re-run does not withdraw a person's decision", async () => {
    const out = await service.forAsset(ASSET, { publicOnly: true });
    expect(out.tracks.map((t) => t.id)).toEqual(["old-1"]);
    expect(out).toMatchObject({ trackJobId: null, total: 1, count: 1, truncated: false });
    expect(out.tracks[0]!.identities.map((a) => a.id)).toEqual(["ia-pub"]);
  });

  it("counts and pages the tracks that have something public, not every track", async () => {
    rows.push(row("new-4", "job-a-new", 3000, [{ ...accepted, id: "ia-pub-2" }]));
    const out = await service.forAsset(ASSET, { publicOnly: true, limit: 1 });
    // Cut first and filtered after, a name past the cap was dropped without a word.
    expect(out).toMatchObject({ total: 2, count: 1, truncated: true });
    const next = await service.forAsset(ASSET, { publicOnly: true, limit: 1, offset: 1 });
    expect(next.tracks.map((t) => t.id)).toEqual(["new-4"]);
  });
});
