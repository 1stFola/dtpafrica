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
  it("takes the shirt number off the name", async () => {
    /* The live record. `/player/no-11-ebulu-emmanuel` was a real profile URL, reached by
       clicking the scorer on a match timeline. */
    const { svc, created } = service();
    await svc.resolveOrCreatePlayer("No. 11 EBULU EMMANUEL");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      displayName: "EBULU EMMANUEL",
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
  });
});
