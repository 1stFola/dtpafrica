import { describe, expect, it } from "vitest";
import { NO_FILTERS, actionFamilies, activeFilterCount, dayBoundary, describeActor, describeKind, familyOf, filtersFromParams, hasDetails, paramsFromFilters, requestFor, targetLink } from "./audit-trail";

describe("the filters live in the address", () => {
  it("reads them from it, and nothing else", () => {
    const f = filtersFromParams(new URLSearchParams("action=media.raw.read&actor=%20ada%40%20&page=3"));
    expect(f).toEqual({ ...NO_FILTERS, action: "media.raw.read", actor: "ada@" });
  });

  it("writes only the ones that are set", () => {
    expect(paramsFromFilters(NO_FILTERS).toString()).toBe("");
    expect(paramsFromFilters({ ...NO_FILTERS, targetKind: "vision_worker", targetId: " w-1 ", method: "  " }).toString()).toBe("targetKind=vision_worker&targetId=w-1");
  });

  it("round-trips", () => {
    const f = { action: "identity.", targetKind: "vision_track", targetId: "t-1", actor: "ada@dtp.africa", method: "jwt", from: "2026-10-01", to: "2026-10-04" };
    expect(filtersFromParams(paramsFromFilters(f))).toEqual(f);
    expect(activeFilterCount(f)).toBe(7);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });
});

describe("a picked day", () => {
  it("is the reader's own day: its first millisecond and its last", () => {
    expect(dayBoundary("2026-10-04", "start")).toBe(new Date(2026, 9, 4, 0, 0, 0, 0).toISOString());
    expect(dayBoundary("2026-10-04", "end")).toBe(new Date(2026, 9, 4, 23, 59, 59, 999).toISOString());
    // One day picked at both ends is that whole day, not an empty instant.
    const start = Date.parse(dayBoundary("2026-10-04", "start")!);
    const end = Date.parse(dayBoundary("2026-10-04", "end")!);
    expect(end - start).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it("is nothing when it is not a day", () => {
    for (const bad of ["", "yesterday", "2026-10", "2026-02-31", "2026-13-01", "04/10/2026"]) expect(dayBoundary(bad, "start"), bad).toBeNull();
  });
});

describe("what is asked of the API", () => {
  it("is the filters, with days turned into moments", () => {
    expect(requestFor(NO_FILTERS)).toEqual({});
    expect(requestFor({ ...NO_FILTERS, action: "worker.", from: "2026-10-01", to: "2026-10-04" })).toEqual({
      action: "worker.",
      from: dayBoundary("2026-10-01", "start"),
      to: dayBoundary("2026-10-04", "end"),
    });
  });

  it("leaves out a day it cannot read, so the API is not sent nonsense", () => {
    expect(requestFor({ ...NO_FILTERS, from: "soon", actor: "ada" })).toEqual({ actor: "ada" });
  });
});

describe("who did it", () => {
  it("names a signed-in person by email, or by id when the email is gone", () => {
    expect(describeActor({ actorId: "u-1", actorEmail: "ada@dtp.africa", actorMethod: "jwt" })).toEqual({ who: "ada@dtp.africa", how: "signed in", person: true });
    expect(describeActor({ actorId: "12345678-aaaa", actorEmail: null, actorMethod: "jwt" })).toMatchObject({ who: "admin 12345678", person: true });
  });

  it("says plainly when it was not a person", () => {
    expect(describeActor({ actorId: null, actorEmail: null, actorMethod: "api_key" })).toMatchObject({ who: "the operator key", person: false });
    expect(describeActor({ actorId: null, actorEmail: null, actorMethod: "provision_key" })).toMatchObject({ who: "the worker on the box", person: false });
    expect(describeActor({ actorId: null, actorEmail: null, actorMethod: null })).toMatchObject({ who: "the system", person: false });
  });
});

describe("actions and targets", () => {
  it("groups actions by family, in the order given", () => {
    expect(familyOf("media.raw.read")).toBe("media");
    expect(familyOf("oddity")).toBe("oddity");
    expect(actionFamilies(["source.registered", "media.raw.read", "source.updated", "worker.retired"])).toEqual([
      { family: "source", actions: ["source.registered", "source.updated"] },
      { family: "media", actions: ["media.raw.read"] },
      { family: "worker", actions: ["worker.retired"] },
    ]);
  });

  it("reads a kind as words, and links the kinds that have a page", () => {
    expect(describeKind("vision_video_asset")).toBe("video asset");
    expect(describeKind("something_else")).toBe("something else");
    expect(targetLink("vision_source_video_record", "s-1")).toBe("/admin/vision/sources/s-1");
    expect(targetLink("vision_video_asset", "a-1")).toBe("/admin/vision/events?asset=a-1");
    expect(targetLink("vision_worker", "w-1")).toBeNull();
    expect(targetLink("vision_video_asset", null)).toBeNull();
  });

  it("offers details only when there are some", () => {
    expect(hasDetails({ jobId: "j" })).toBe(true);
    for (const none of [null, undefined, {}, "text", 3]) expect(hasDetails(none), String(none)).toBe(false);
  });
});
