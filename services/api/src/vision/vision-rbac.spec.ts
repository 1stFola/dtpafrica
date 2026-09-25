import { describe, expect, it } from "vitest";
import {
  ADMIN_PERMISSIONS,
  ALL_PERMISSION_SLUGS,
  DEFAULT_ROLES,
  READ_ONLY_PERMISSION_SLUGS,
  VISION_PERMISSION_SLUGS,
} from "../admin/rbac/permissions.catalog";

function role(slug: string) {
  const found = DEFAULT_ROLES.find((r) => r.slug === slug);
  if (!found) throw new Error(`No default role "${slug}"`);
  return found;
}

function slugsFor(roleSlug: string): string[] {
  const def = role(roleSlug);
  return def.permissionSlugs === "all" ? ALL_PERMISSION_SLUGS : def.permissionSlugs;
}

describe("Vision extends the existing RBAC catalogue", () => {
  it("adds vision.* permissions rather than a second auth system", () => {
    expect(VISION_PERMISSION_SLUGS.length).toBeGreaterThan(0);
    for (const slug of VISION_PERMISSION_SLUGS) {
      expect(ALL_PERMISSION_SLUGS).toContain(slug);
    }
  });

  it("gives every permission a resource, action and description", () => {
    for (const perm of ADMIN_PERMISSIONS.filter((p) => p.slug.startsWith("vision."))) {
      expect(perm.resource).toBe("vision");
      expect(perm.action).toBeTruthy();
      expect(perm.description).toBeTruthy();
    }
  });

  it("keeps permission slugs unique across the whole catalogue", () => {
    expect(new Set(ALL_PERMISSION_SLUGS).size).toBe(ALL_PERMISSION_SLUGS.length);
  });

  it("registers the five Vision personas as seeded roles", () => {
    for (const slug of [
      "vision_admin",
      "vision_annotator",
      "vision_reviewer",
      "vision_ml_engineer",
      "vision_scout_readonly",
    ]) {
      expect(() => role(slug)).not.toThrow();
    }
  });

  it("grants super_admin the new permissions automatically", () => {
    // super_admin is "all", which is why seed-rbac tops it up on every run.
    expect(role("super_admin").permissionSlugs).toBe("all");
  });

  it("leaves every Vision role able to verify its own session", () => {
    for (const slug of [
      "vision_admin",
      "vision_annotator",
      "vision_reviewer",
      "vision_ml_engineer",
      "vision_scout_readonly",
    ]) {
      expect(slugsFor(slug)).toContain("admin.session.read");
    }
  });
});

// Two omissions in docs/vision/04-DATA-MODEL.md are deliberate, and are exactly
// the kind of thing a later "let's just add it" would quietly undo.
describe("separation of duty", () => {
  it("does not let an ML engineer promote their own model", () => {
    const slugs = slugsFor("vision_ml_engineer");
    expect(slugs).toContain("vision.models.train");
    expect(slugs).not.toContain("vision.models.promote");
  });

  it("does not give annotators the raw youth-footage corpus", () => {
    const slugs = slugsFor("vision_annotator");
    expect(slugs).toContain("vision.annotate");
    expect(slugs).not.toContain("vision.media.raw.read");
  });

  it("does not let an annotator publish or review", () => {
    const slugs = slugsFor("vision_annotator");
    expect(slugs).not.toContain("vision.publish");
    expect(slugs).not.toContain("vision.review");
  });

  it("does not let a reviewer train or promote models", () => {
    const slugs = slugsFor("vision_reviewer");
    expect(slugs).toContain("vision.review");
    expect(slugs).not.toContain("vision.models.train");
    expect(slugs).not.toContain("vision.models.promote");
  });

  it("limits a read-only scout to searching approved evidence", () => {
    const slugs = slugsFor("vision_scout_readonly");
    expect(slugs).toContain("vision.evidence.search");
    expect(slugs).not.toContain("vision.read");
    expect(slugs).not.toContain("vision.media.raw.read");
    expect(slugs).not.toContain("vision.publish");
  });
});

describe("existing roles are unchanged", () => {
  // Phase 0 must not widen anyone's access. A Vision permission appearing in a
  // ScoreBoard role would be a silent privilege escalation.
  it.each([
    "scoreboard_ops",
    "scoreboard_records_manager",
    "calibration_editor",
    "match_recorder",
    "match_supervisor",
  ])("%s gains no vision.* permission", (roleSlug) => {
    expect(slugsFor(roleSlug).filter((s) => s.startsWith("vision."))).toEqual([]);
  });

  // read_only is derived from the catalogue by action, so a new `vision.read`
  // does land there by design. Asserted so the consequence is a decision on the
  // record rather than a surprise.
  it("read_only picks up vision.read because it is derived by action", () => {
    expect(READ_ONLY_PERMISSION_SLUGS).toContain("vision.read");
    expect(READ_ONLY_PERMISSION_SLUGS).not.toContain("vision.publish");
    expect(READ_ONLY_PERMISSION_SLUGS).not.toContain("vision.media.raw.read");
  });
});
