import { describe, expect, it } from "vitest";
import { CALIBRATION_THRESHOLDS, qualityOf } from "./calibration-thresholds";
import { fitHomography, homogeneousW, invert3, isFit, multiply, normalise, orientStored, orientation, project, projectInView, type Correspondence, type Homography } from "./homography";
import { DEFAULT_PITCH, PENALTY_SPOT_M, landmarkById, pitchLandmarks, pitchLines, pitchProblem } from "./pitch-model";

/**
 * A synthetic camera: a known homography from pitch metres to picture pixels,
 * looking at the pitch from a stand on the near touchline. Everything below is
 * checked against it -- the fit must recover it, and a point must land where it
 * says.
 */
const CAMERA: Homography = [9.2, -3.1, 160, 0.4, 2.6, 80, 0.0004, 0.011, 1];
const PITCH_TO_PIXEL = CAMERA;
const PIXEL_TO_PITCH = invert3(CAMERA)!;

function see(xM: number, yM: number): { px: number; py: number } {
  const p = project(PITCH_TO_PIXEL, { x: xM, y: yM })!;
  return { px: p.x, py: p.y };
}

function clicks(ids: string[], noisePx = 0, seed = 1): Correspondence[] {
  const by = landmarkById(DEFAULT_PITCH);
  let s = seed;
  const rand = () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647 - 0.5;
  };
  return ids.map((id) => {
    const l = by.get(id)!;
    const { px, py } = see(l.xM, l.yM);
    return { px: px + rand() * 2 * noisePx, py: py + rand() * 2 * noisePx, xM: l.xM, yM: l.yM };
  });
}

const SIX = ["corner_left_near", "corner_left_far", "halfway_near", "halfway_far", "left_penalty_spot", "centre_spot"];

describe("the pitch model", () => {
  it("places the laws' fixed measurements on any pitch, and scales the rest", () => {
    const std = landmarkById(DEFAULT_PITCH);
    expect(std.get("centre_spot")).toMatchObject({ xM: 52.5, yM: 34 });
    expect(std.get("left_penalty_spot")).toMatchObject({ xM: PENALTY_SPOT_M, yM: 34 });
    expect(std.get("right_box_near")).toMatchObject({ xM: 88.5, yM: 13.84 });
    const small = landmarkById({ lengthM: 90, widthM: 55 });
    expect(small.get("centre_spot")).toMatchObject({ xM: 45, yM: 27.5 });
    expect(small.get("right_penalty_spot")).toMatchObject({ xM: 79, yM: 27.5 });
    expect(small.get("left_post_far")).toMatchObject({ xM: 0, yM: 27.5 + 3.66 });
    expect(pitchLandmarks().length).toBe(33);
  });

  it("draws its markings as polylines from the dimensions, the circle sampled", () => {
    const lines = pitchLines({ lengthM: 90, widthM: 55 });
    const byId = new Map(lines.map((l) => [l.id, l]));
    expect([...byId.keys()]).toEqual(["outline", "halfway", "centre_circle", "left_box", "left_goal_area", "right_box", "right_goal_area"]);
    expect(byId.get("outline")!.points).toEqual([{ xM: 0, yM: 0 }, { xM: 90, yM: 0 }, { xM: 90, yM: 55 }, { xM: 0, yM: 55 }, { xM: 0, yM: 0 }]);
    expect(byId.get("halfway")!.points).toEqual([{ xM: 45, yM: 0 }, { xM: 45, yM: 55 }]);
    expect(byId.get("centre_circle")!.points).toHaveLength(37);
    expect(byId.get("centre_circle")!.points[0]).toEqual({ xM: 54.15, yM: 27.5 });
    expect(byId.get("right_box")!.points[1]).toEqual({ xM: 73.5, yM: 27.5 - 20.16 });
  });

  it("refuses dimensions no pitch has", () => {
    expect(pitchProblem(DEFAULT_PITCH)).toBeNull();
    expect(pitchProblem({ lengthM: 30, widthM: 20 })).toContain("length");
    expect(pitchProblem({ lengthM: 100, widthM: 20 })).toContain("width");
    expect(pitchProblem({ lengthM: 60, widthM: 60 })).toContain("longer");
    expect(pitchProblem({ lengthM: Number.NaN, widthM: 68 })).toContain("numbers");
  });
});

describe("fitting a homography", () => {
  it("recovers the camera from six exact landmarks", () => {
    const fit = fitHomography(clicks(SIX));
    if (!isFit(fit)) throw new Error(fit.reason);
    expect(fit.rmseM).toBeLessThan(0.001);
    expect(fit.rmsePx).toBeLessThan(0.01);
    expect(fit.points).toBe(6);
    const seen = see(105, 68);
    const corner = project(fit.homography, { x: seen.px, y: seen.py })!;
    expect(corner.x).toBeCloseTo(105, 2);
    expect(corner.y).toBeCloseTo(68, 2);
  });

  it("recovers it from the minimum four, and reports a pixel of noise as metres", () => {
    const exact = fitHomography(clicks(SIX.slice(0, 4)));
    if (!isFit(exact)) throw new Error(exact.reason);
    expect(exact.rmseM).toBeLessThan(0.001);
    const noisy = fitHomography(clicks(SIX, 3));
    if (!isFit(noisy)) throw new Error(noisy.reason);
    expect(noisy.rmseM).toBeGreaterThan(0.05);
    expect(noisy.rmseM).toBeLessThan(2);
    expect(noisy.rmsePx).toBeGreaterThan(0.5);
  });

  it("refuses fewer than four points, duplicates, and collinear points, by name", () => {
    expect(fitHomography(clicks(SIX.slice(0, 3)))).toEqual({ reason: "too_few_points" });
    const dup = clicks(SIX.slice(0, 4));
    expect(fitHomography([...dup, { ...dup[0]! }])).toEqual({ reason: "duplicate_points" });
    // Three points on the near touchline and one off it: no homography is determined.
    const threeOnALine = clicks(["corner_left_near", "halfway_near", "corner_right_near", "left_box_near_goalline"]);
    expect(fitHomography(threeOnALine)).toEqual({ reason: "degenerate" });
    // Four points with no three collinear: determined, from a quadrilateral however thin.
    const quad = clicks(["corner_left_near", "corner_right_near", "halfway_far", "left_box_near"]);
    expect(isFit(fitHomography(quad))).toBe(true);
  });

  it("reports the errors of the homography it reports, root-mean-square and worst point", () => {
    // Nine exact landmarks and one clicked two hundred pixels wide, third in the list: with
    // twenty equations for eight unknowns the fit cannot absorb it, so it is the worst point,
    // and it is neither first nor last.
    const pairs = clicks([...SIX, "right_penalty_spot", "corner_right_near", "corner_right_far", "left_box_near"]);
    pairs[2]!.px += 200;
    const fit = fitHomography(pairs);
    if (!isFit(fit)) throw new Error(fit.reason);
    let sum = 0;
    let worst = 0;
    for (const p of pairs) {
      const on = project(fit.homography, { x: p.px, y: p.py })!;
      const d = Math.hypot(on.x - p.xM, on.y - p.yM);
      sum += d * d;
      worst = Math.max(worst, d);
    }
    expect(fit.rmseM).toBeCloseTo(Math.sqrt(sum / pairs.length), 3);
    expect(fit.maxErrorM).toBeCloseTo(worst, 3);
    expect(fit.maxErrorM).toBeGreaterThanOrEqual(fit.rmseM);
  });

  it("normalises points to a centroid at the origin and a mean distance of root two", () => {
    const { points, transform } = normalise([{ x: 100, y: 200 }, { x: 1100, y: 200 }, { x: 1100, y: 700 }, { x: 100, y: 700 }]);
    const cx = points.reduce((s, p) => s + p.x, 0) / 4;
    const cy = points.reduce((s, p) => s + p.y, 0) / 4;
    const mean = points.reduce((s, p) => s + Math.hypot(p.x, p.y), 0) / 4;
    expect(cx).toBeCloseTo(0, 9);
    expect(cy).toBeCloseTo(0, 9);
    expect(mean).toBeCloseTo(Math.SQRT2, 9);
    const back = project(transform, { x: 100, y: 200 })!;
    expect(back.x).toBeCloseTo(points[0]!.x, 9);
  });

  it("projects the pitch's far corner back to where the camera saw it", () => {
    const fit = fitHomography(clicks(SIX));
    if (!isFit(fit)) throw new Error(fit.reason);
    const back = invert3(fit.homography)!;
    const seen = see(105, 68);
    const re = project(back, { x: 105, y: 68 })!;
    expect(re.x).toBeCloseTo(seen.px, 1);
    expect(re.y).toBeCloseTo(seen.py, 1);
  });

  it("maps a point on the horizon to nothing rather than a huge number", () => {
    // w = h6·x + h7·y + h8 = 0 along the horizon line of the camera.
    const H = PIXEL_TO_PITCH;
    const y = -H[8] / H[7];
    expect(project(H, { x: 0, y })).toBeNull();
  });

  it("inverts and multiplies as matrices should", () => {
    const I = multiply(CAMERA, invert3(CAMERA)!);
    expect(I[0]).toBeCloseTo(1, 9);
    expect(I[4]).toBeCloseTo(1, 9);
    expect(I[8]).toBeCloseTo(1, 9);
    expect(Math.abs(I[1]) + Math.abs(I[2]) + Math.abs(I[3]) + Math.abs(I[5]) + Math.abs(I[6]) + Math.abs(I[7])).toBeLessThan(1e-9);
    expect(invert3([1, 2, 3, 2, 4, 6, 7, 8, 9])).toBeNull();
  });
});

describe("how much to trust it", () => {
  it("is good with a small error on enough points, usable with more, failed beyond", () => {
    expect(qualityOf({ rmseM: 0.5, maxErrorM: 1, points: 6 })).toBe("good");
    expect(qualityOf({ rmseM: 0.5, maxErrorM: 1, points: 4 })).toBe("usable");
    expect(qualityOf({ rmseM: 1.9, maxErrorM: 3, points: 8 })).toBe("usable");
    expect(qualityOf({ rmseM: 2.1, maxErrorM: 3, points: 8 })).toBe("failed");
    expect(qualityOf({ rmseM: 0.3, maxErrorM: 5.5, points: 8 })).toBe("failed");
    expect(CALIBRATION_THRESHOLDS.version).toContain("provisional");
  });
});

/**
 * A camera in a stand, thirty metres behind the near touchline, looking across
 * the pitch with the horizon a quarter of the way down the picture: the far
 * touchline at about y = 353, the near one at y = 700, sky above y = 200. The
 * top-left pixel is sky. Scaling the fitted matrix so its last entry is +1 makes
 * `w` positive *there*, and so negative everywhere on the pitch
 * (docs/vision/50, appendix C; docs/vision/56).
 */
const SKY_CAMERA: Homography = [1000, 640, -33300, 0, 200, 21000, 0, 1, 30];

function skyClicks(ids: string[]): Correspondence[] {
  const by = landmarkById(DEFAULT_PITCH);
  return ids.map((id) => {
    const l = by.get(id)!;
    const p = project(SKY_CAMERA, { x: l.xM, y: l.yM })!;
    return { px: p.x, py: p.y, xM: l.xM, yM: l.yM };
  });
}

describe("which way round a homography is", () => {
  it("is fitted with the clicked points in view, whatever the top-left pixel is", () => {
    const pairs = skyClicks(SIX);
    const fit = fitHomography(pairs);
    if (!isFit(fit)) throw new Error(fit.reason);
    expect(fit.acrossHorizon).toBe(0);
    expect(fit.rmseM).toBeLessThan(0.01);
    for (const p of pairs) expect(homogeneousW(fit.homography, { x: p.px, y: p.py })).toBeGreaterThan(0);
    // The sky is on the other side: negative w at the top-left pixel, which is the last entry.
    expect(fit.homography[8]).toBe(-1);
    // A pixel on the grass lands where it should, read by the sign.
    const spot = project(SKY_CAMERA, { x: 52.5, y: 34 })!;
    const back = projectInView(fit.homography, spot)!;
    expect(back.x).toBeCloseTo(52.5, 2);
    expect(back.y).toBeCloseTo(34, 2);
    // A pixel in the sky is beyond the horizon. Read without the sign it is a point on the pitch that is not there.
    expect(projectInView(fit.homography, { x: 640, y: 100 })).toBeNull();
    expect(project(fit.homography, { x: 640, y: 100 })).not.toBeNull();
    expect(projectInView(fit.homography, { x: 640, y: 200 })).toBeNull();
  });

  it("leaves a camera whose whole picture is pitch as it was", () => {
    const fit = fitHomography(clicks(SIX));
    if (!isFit(fit)) throw new Error(fit.reason);
    expect(fit.homography[8]).toBe(1);
    expect(fit.acrossHorizon).toBe(0);
  });

  it("orients a stored matrix by the points it was fitted from", () => {
    const pairs = skyClicks(SIX);
    const fit = fitHomography(pairs);
    if (!isFit(fit)) throw new Error(fit.reason);
    const stored = pairs.map((p, i) => ({ landmark: SIX[i], px: p.px, py: p.py }));
    // As rows filed before this fix hold it: last entry +1, the pitch on the negative side.
    const older = fit.homography.map((v) => -v) as Homography;
    expect(older[8]).toBe(1);
    expect(orientStored(older, stored)).toEqual(fit.homography);
    expect(orientStored(fit.homography, stored)).toEqual(fit.homography);
    // Nothing to orient by: returned as stored.
    expect(orientStored(older, [])).toEqual(older);
    expect(orientStored(older, null)).toEqual(older);
    expect(orientStored(older, [{ landmark: "x" }, "nonsense"])).toEqual(older);
  });

  it("counts the points on the wrong side, signs by the majority, and has no answer on the horizon itself", () => {
    const H: Homography = [1, 0, 0, 0, 1, 0, 0, -0.01, 1]; // w = 1 - y/100
    expect(orientation(H, [{ x: 0, y: 10 }, { x: 0, y: 20 }])).toEqual({ homography: H, across: 0 });
    expect(orientation(H, [{ x: 0, y: 150 }, { x: 0, y: 300 }])).toEqual({ homography: H.map((v) => -v), across: 0 });
    expect(orientation(H, [{ x: 0, y: 10 }, { x: 0, y: 20 }, { x: 0, y: 300 }])).toEqual({ homography: H, across: 1 });
    expect(orientation(H, [{ x: 0, y: 10 }, { x: 0, y: 200 }, { x: 0, y: 300 }])).toMatchObject({ across: 1 });
    expect(orientation(H, [{ x: 0, y: 100 }])).toBeNull();
  });

  it("fails a calibration whose clicks straddle the horizon, however small its error reads", () => {
    expect(qualityOf({ rmseM: 0.1, maxErrorM: 0.2, points: 8, acrossHorizon: 0 })).toBe("good");
    expect(qualityOf({ rmseM: 0.1, maxErrorM: 0.2, points: 8, acrossHorizon: 1 })).toBe("failed");
    expect(qualityOf({ rmseM: 0.1, maxErrorM: 0.2, points: 8 })).toBe("good");
  });
});
