import { describe, expect, it } from "vitest";
import { NON_PLAY_SEGMENT_KINDS } from "./events";
import { STAGE_CONTRACT_SINCE, VISION_CONTRACT_VERSION, VISION_JOB_TYPES, compareContractVersions, parseContractVersion, workerCompatibility } from "./jobs";
import { CAMERA_SEGMENT_KINDS, NON_LIVE_SEGMENT_KINDS } from "./media";
import { RIGHTS_SCOPE_KEYS, readRestrictions } from "./rights";

/**
 * Which worker may serve which stage, pinned. The Python worker holds the other
 * half of the rule (`config.contract_compatible`); what is asserted here is the
 * control plane's half and the table it reads.
 */
describe("a contract version", () => {
  it("is three numbers, and compares as numbers", () => {
    expect(parseContractVersion("1.12.0")).toEqual([1, 12, 0]);
    for (const bad of ["1.12", "v1.12.0", "1.12.0-rc1", "", null, undefined, 1.12, "1.x.0"]) expect(parseContractVersion(bad)).toBeNull();
    // As numbers: 1.9.0 is older than 1.12.0, which a string comparison gets backwards.
    expect(compareContractVersions([1, 9, 0], [1, 12, 0])).toBeLessThan(0);
    expect(compareContractVersions([1, 12, 1], [1, 12, 0])).toBeGreaterThan(0);
    expect(compareContractVersions([2, 0, 0], [1, 99, 99])).toBeGreaterThan(0);
    expect(compareContractVersions([1, 12, 0], [1, 12, 0])).toBe(0);
  });

  it("is itself readable, and every stage names a readable version no newer than it", () => {
    const current = parseContractVersion(VISION_CONTRACT_VERSION)!;
    expect(current).not.toBeNull();
    expect(Object.keys(STAGE_CONTRACT_SINCE).sort()).toEqual([...VISION_JOB_TYPES].sort());
    for (const type of VISION_JOB_TYPES) {
      const since = parseContractVersion(STAGE_CONTRACT_SINCE[type]);
      expect(since, type).not.toBeNull();
      expect(compareContractVersions(since!, current), type).toBeLessThanOrEqual(0);
    }
  });
});

describe("which worker may serve which stage", () => {
  it("serves every stage to a worker on the control plane's own version", () => {
    expect(workerCompatibility(VISION_CONTRACT_VERSION)).toEqual({ compatible: true, stages: [...VISION_JOB_TYPES] });
  });

  /** Every stage but these: what a worker of an older version is served. */
  const allBut = (...withheld: string[]) => ({ compatible: true, stages: VISION_JOB_TYPES.filter((type) => !withheld.includes(type)) });
  // Since 1.19.0 possession, events and gamestate read keyframed calibrations frame by frame.
  const perFrame = ["possession", "events", "gamestate"];
  // Since 1.21.0 detect runs (and colour-checks) the config its version names, and ball
  // trajectory drops parked tiled balls along pinned camera motion.
  const configured = ["detect", "ball_trajectory"];
  // Since 1.22.0 hard_frames picks frames for labelling, with the detector's boxes as pre-labels.
  const mining = ["hard_frames"];
  // Since 1.23.0 train fine-tunes a detector; before it, no worker had the stage.
  const training = ["train"];

  it("keeps older workers on their existing stages and withholds the new ball stage", () => {
    expect(workerCompatibility("1.12.0", "1.13.0")).toEqual(allBut("ball_trajectory", "camera_motion", "calibrate", ...perFrame, ...configured, ...mining, ...training));
  });
  it("withholds possession from a worker that only knows ball trajectories", () => {
    expect(workerCompatibility("1.13.0", "1.14.0")).toEqual(allBut("camera_motion", "calibrate", ...perFrame, ...configured, ...mining, ...training));
  });
  it("withholds changed possession inputs from a 1.14 worker, while other stages remain available", () => {
    expect(workerCompatibility("1.14.0")).toEqual(allBut("camera_motion", "calibrate", ...perFrame, ...configured, ...mining, ...training));
  });
  it("withholds carry inputs from a 1.15 worker while keeping its other stages", () => {
    expect(workerCompatibility("1.15.0")).toEqual(allBut("camera_motion", "calibrate", ...perFrame, ...configured, ...mining, ...training));
  });
  it("withholds camera motion from a 1.16 worker, which has no OpenCV and no such stage", () => {
    expect(workerCompatibility("1.16.0")).toEqual(allBut("camera_motion", "calibrate", ...perFrame, ...configured, ...mining, ...training));
    expect(workerCompatibility("1.17.0").stages).toContain("camera_motion");
  });
  it("withholds keyframe propagation from a 1.17 worker, whose calibrate was a GPU stage it never had", () => {
    expect(workerCompatibility("1.17.0")).toEqual(allBut("calibrate", ...perFrame, ...configured, ...mining, ...training));
    expect(workerCompatibility("1.18.0").stages).toContain("calibrate");
  });
  it("withholds the stages that read carried calibrations from a 1.18 worker, which would read a carried segment as uncalibrated", () => {
    expect(workerCompatibility("1.18.0")).toEqual(allBut(...perFrame, ...configured, ...mining, ...training));
    for (const stage of perFrame) expect(workerCompatibility("1.19.0").stages).toContain(stage);
  });
  it("withholds detect from a 1.19 worker, which would run the plain detector under a ball-tiles version's name", () => {
    expect(workerCompatibility("1.19.0")).toEqual(allBut(...configured, ...mining, ...training));
  });
  it("withholds detect and ball trajectory from a 1.20 worker, which knows neither the colour check nor the parked ball", () => {
    expect(workerCompatibility("1.20.0")).toEqual(allBut(...configured, ...mining, ...training));
    for (const stage of configured) expect(workerCompatibility("1.21.0").stages).toContain(stage);
  });

  it("withholds hard_frames from a 1.21 worker, which has no such stage", () => {
    expect(workerCompatibility("1.21.0")).toEqual(allBut(...mining, ...training));
    expect(workerCompatibility("1.22.0").stages).toContain("hard_frames");
  });

  it("withholds train from a 1.22 worker, which would fail it as an unknown stage", () => {
    expect(workerCompatibility("1.22.0")).toEqual(allBut(...training));
    expect(workerCompatibility("1.23.0").stages).toContain("train");
  });

  it("serves an older worker only the stages that have not changed since it was built", () => {
    // Every stage's entry is 1.12.0, so a worker from 1.11.0 is behind all of them.
    expect(workerCompatibility("1.11.0", "1.12.0")).toEqual({ compatible: true, stages: [] });
  });

  it("refuses another major, a worker newer than the control plane, and a version it cannot read", () => {
    expect(workerCompatibility("2.0.0", "1.12.0")).toMatchObject({ compatible: false, reason: "major" });
    expect(workerCompatibility("0.9.0", "1.12.0")).toMatchObject({ compatible: false, reason: "major" });
    expect(workerCompatibility("1.13.0", "1.12.0")).toMatchObject({ compatible: false, reason: "worker_newer" });
    expect(workerCompatibility("1.12.1", "1.12.0")).toMatchObject({ compatible: false, reason: "worker_newer" });
    expect(workerCompatibility("latest", "1.12.0")).toMatchObject({ compatible: false, reason: "unreadable" });
    expect(workerCompatibility(undefined, "1.12.0")).toMatchObject({ compatible: false, reason: "unreadable" });
  });
});

describe("the segment kinds in which an event is not play", () => {
  it("are one list under two names, all of them segment kinds", () => {
    expect(NON_PLAY_SEGMENT_KINDS).toBe(NON_LIVE_SEGMENT_KINDS);
    for (const kind of NON_PLAY_SEGMENT_KINDS) expect(CAMERA_SEGMENT_KINDS).toContain(kind);
    expect([...NON_PLAY_SEGMENT_KINDS]).toEqual(["replay", "intro", "halftime"]);
  });
});

describe("restrictions on a grant, as a person submits them", () => {
  it("are nothing, or an object", () => {
    expect(readRestrictions(undefined)).toEqual({ ok: true, value: null, unrecognised: [] });
    expect(readRestrictions(null)).toEqual({ ok: true, value: null, unrecognised: [] });
    for (const bad of ["no minors", 3, true, ["canTrain"]]) expect(readRestrictions(bad)).toMatchObject({ ok: false });
  });

  it("take a deny list of scopes and a note", () => {
    const input = { deny: ["canPublishHighlight", "canShareWithScout"], note: "not before the final" };
    expect(readRestrictions(input)).toEqual({ ok: true, value: input, unrecognised: [] });
    expect(readRestrictions({})).toEqual({ ok: true, value: {}, unrecognised: [] });
    expect(readRestrictions({ deny: [] })).toMatchObject({ ok: true, unrecognised: [] });
  });

  it("refuse a deny entry that is not a scope: it would read as a restriction and restrict nothing", () => {
    const out = readRestrictions({ deny: ["canPublish"] });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.problem).toContain('"canPublish"');
      for (const scope of RIGHTS_SCOPE_KEYS) expect(out.problem).toContain(scope);
    }
    expect(readRestrictions({ deny: "canTrain" })).toMatchObject({ ok: false });
    expect(readRestrictions({ deny: ["canTrain", 7] })).toMatchObject({ ok: false });
    expect(readRestrictions({ note: 12 })).toMatchObject({ ok: false });
  });

  it("accept a flag the policy does not understand, and say it will deny every scope", () => {
    expect(readRestrictions({ noIdentifiableMinors: true, territory: "NG", note: "x" })).toMatchObject({ ok: true, unrecognised: ["noIdentifiableMinors", "territory"] });
    // A flag that says nothing restricts nothing.
    expect(readRestrictions({ noIdentifiableMinors: false, territory: "", regions: [], extra: null })).toMatchObject({ ok: true, unrecognised: [] });
  });
});
