import { describe, expect, it, vi } from "vitest";
import { PlaceholderPlayerNameError } from "../players/placeholder-names";
import { PlayerDirectoryService } from "./player-directory.service";

/**
 * What may become a player record, and under what name.
 *
 * A timeline event stores its player as `No. 11 EBULU EMMANUEL`. Any path handing that
 * label straight to this service created a player *named* that, with the slug
 * `no-11-ebulu-emmanuel` — and the number then followed that person into their profile
 * URL, where no amount of front-end tidying could reach it.
 */

type Created = { displayName: string; normalizedName: string | null; slug: string };

function service(over: { existingByKey?: Record<string, { id: string }> } = {}) {
  const created: Created[] = [];
  const prisma = {
    player: {
      findUnique: vi.fn(async (args: { where: { normalizedName?: string; slug?: string } }) => {
        const key = args.where.normalizedName;
        return key ? (over.existingByKey?.[key] ?? null) : null;
      }),
      findFirst: vi.fn(async () => null),
      findUniqueOrThrow: vi.fn(async () => ({ id: "x" })),
      update: vi.fn(async () => ({ id: "x" })),
      create: vi.fn(async (args: { data: Created }) => {
        created.push(args.data);
        return { id: `new-${created.length}`, ...args.data };
      }),
    },
  };
  return {
    svc: new PlayerDirectoryService(prisma as never),
    created,
    prisma,
  };
}

describe("creating a player from a timeline label", () => {
  it("leaves a name that is not shouting alone", async () => {
    const { svc, created } = service();
    await svc.resolveOrCreatePlayer("Chidera Isaiah");
    expect(created[0]).toMatchObject({ displayName: "Chidera Isaiah" });
  });

  it("does not re-case a record it cannot read", async () => {
    /* A digit means the record is not understood, and `VIDO 99 FC` title-cased to
       `Vido 99 Fc` once already. The tidy rules decline both; this is here so a change to
       them cannot quietly start damaging names on the write path. */
    const { svc, created } = service();
    await svc.resolveOrCreatePlayer("Ademola James (19)");
    expect(created[0]).toMatchObject({ displayName: "Ademola James (19)" });
  });

  it("takes the shirt number off the name and stops it shouting", async () => {
    /* The live record. `/player/no-11-ebulu-emmanuel` was a real profile URL, reached by
       clicking the scorer on a match timeline.

       This asserted `EBULU EMMANUEL` until the casing was fixed on write. Nothing tidied a
       name as it was created, so every shouted label became a record that shouts, and only
       `db:repair:player-display-names` ever put it right -- 241 of them on the last run. A
       repair that has to be re-run after every match is a gap, not a tool. */
    const { svc, created } = service();
    await svc.resolveOrCreatePlayer("No. 11 EBULU EMMANUEL");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      displayName: "Ebulu Emmanuel",
      /* Unchanged, and that is the point: the dedupe key is lowercased, so tidying the
         casing cannot move a name onto a different record. */
      normalizedName: "ebulu emmanuel",
    });
    expect(created[0]?.slug).not.toContain("no-11");
  });

  it("handles the other spellings the importers write", async () => {
    for (const label of ["no 7 Ogundeji Elijah", "#10 Wasiu Yayah", "NO.9 Biola Olajide"]) {
      const { svc, created } = service();
      await svc.resolveOrCreatePlayer(label);
      expect(created[0]?.displayName).not.toMatch(/^(no|#)/i);
    }
  });

  it("finds the existing player behind a numbered label instead of creating a second", async () => {
    /* The point of stripping rather than refusing: the name behind the number is the
       person, so a labelled event should resolve to the record that already exists. */
    const { svc, created, prisma } = service({
      existingByKey: { "ebulu emmanuel": { id: "already-here" } },
    });
    const player = await svc.resolveOrCreatePlayer("No. 11 EBULU EMMANUEL");
    expect(player).toMatchObject({ id: "already-here" });
    expect(created).toEqual([]);
    expect(prisma.player.findUnique).toHaveBeenCalledWith({
      where: { normalizedName: "ebulu emmanuel" },
    });
  });

  it("still refuses a bare shirt number", async () => {
    /* Stripping leaves `No. 11` untouched — there is no name behind it to take — so it
       reaches the placeholder guard exactly as before. */
    for (const label of ["No. 11", "no9", "#7", "7"]) {
      const { svc } = service();
      await expect(svc.resolveOrCreatePlayer(label)).rejects.toThrow(PlaceholderPlayerNameError);
    }
  });

  it("still refuses the other placeholders", async () => {
    for (const label of ["Unknown", "Player", "Goalkeeper"]) {
      const { svc } = service();
      await expect(svc.resolveOrCreatePlayer(label)).rejects.toThrow(PlaceholderPlayerNameError);
    }
  });

  it("leaves an ordinary name exactly as it is", async () => {
    const { svc, created } = service();
    await svc.resolveOrCreatePlayer("Nwosu Henry");
    expect(created[0]).toMatchObject({ displayName: "Nwosu Henry" });
  });

  it("does not mistake a name beginning with No for a number", async () => {
    const { svc, created } = service();
    await svc.resolveOrCreatePlayer("Noah Idris");
    expect(created[0]).toMatchObject({ displayName: "Noah Idris" });
  });

  it("creates a draft that is not public", async () => {
    /* A name harvested from a label must not appear in the public directory until
       somebody approves it. */
    const { svc, prisma } = service();
    await svc.resolveOrCreatePlayer("Fresh Name");
    expect(prisma.player.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ registrationStatus: "draft", isPublic: false }),
      })
    );
  });});

describe("publishing the players on a registered squad", () => {
  it("promotes only drafts, through the client it is given", async () => {
    /* `pending` is somebody's own registration awaiting review, and an admin may have hidden
       an approved player; a squad upload decides neither. */
    const tx = { player: { updateMany: vi.fn(async () => ({ count: 2 })) } };
    const { svc } = service();
    const count = await svc.publishRegisteredPlayers(["a", "b", "c"], tx as never);
    expect(count).toBe(2);
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b", "c"] }, registrationStatus: "draft" },
      data: { registrationStatus: "approved", isPublic: true },
    });
  });

  it("writes nothing for an empty squad", async () => {
    const tx = { player: { updateMany: vi.fn() } };
    const { svc } = service();
    expect(await svc.publishRegisteredPlayers([], tx as never)).toBe(0);
    expect(tx.player.updateMany).not.toHaveBeenCalled();
  });
});
