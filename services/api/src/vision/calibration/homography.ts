/**
 * A homography from the picture to the pitch, and how much to trust it.
 *
 * Four or more correspondences between a pixel and a point in metres give a 3 × 3
 * projective map by the direct linear transform, after Hartley normalisation of
 * both point sets -- without which the system is conditioned by pixel magnitudes
 * in the thousands against metres in the tens, and the answer is noise. The
 * eight unknowns (h33 fixed at 1) are the least-squares solution of the stacked
 * equations, by Gaussian elimination with pivoting on the normal matrix; a
 * near-singular normal matrix means the points are degenerate (collinear, or
 * fewer than four distinct), and that is reported rather than returned as a
 * number that looks fine.
 *
 * Trust is the reprojection error: project every clicked pixel onto the pitch
 * and measure the distance to the landmark it named, in metres, and project
 * every landmark back and measure the distance to the click, in pixels. The
 * metre figure is the one the suppression rule reads, because a metre is what a
 * distance metric is wrong by.
 *
 * Standard library only; this is a page of arithmetic, not a dependency.
 */

/** Row-major 3 × 3, mapping homogeneous pixel [x, y, 1] to homogeneous pitch [X, Y, W]. */
export type Homography = [number, number, number, number, number, number, number, number, number];

export type Point = { x: number; y: number };

export type Correspondence = {
  /** In the picture, proxy pixels. */
  px: number;
  py: number;
  /** On the pitch, metres. */
  xM: number;
  yM: number;
};

export type Fit = {
  homography: Homography;
  /** Root-mean-square distance, in metres, between each click projected to the pitch and its landmark. */
  rmseM: number;
  /** The worst single point, in metres. */
  maxErrorM: number;
  /** Root-mean-square distance, in pixels, between each landmark projected to the picture and its click. */
  rmsePx: number;
  points: number;
  /**
   * Clicked points the fit puts beyond the horizon. Landmarks a person clicked are
   * in the picture, so any here means the fit is wrong about where the camera is
   * looking, however small its error reads: such a calibration is `failed`.
   */
  acrossHorizon: number;
};

export type FitFailure = { reason: "too_few_points" | "degenerate" | "duplicate_points" };

export const MIN_POINTS = 4;

/**
 * How far, in metres on the pitch, a landmark must lie from the line through two
 * others to count as off it. Less than that tells the fit almost nothing across the
 * line: three landmarks spanning the pitch a few centimetres off one line pin it no
 * better than three on it. A fit needs only some four landmarks clear of this, so
 * extra near-collinear ones do no harm.
 */
export const COLLINEAR_TOLERANCE_M = 1;

export function fitHomography(pairs: readonly Correspondence[]): Fit | FitFailure {
  if (pairs.length < MIN_POINTS) return { reason: "too_few_points" };
  if (hasDuplicates(pairs.map((p) => ({ x: p.px, y: p.py }))) || hasDuplicates(pairs.map((p) => ({ x: p.xM, y: p.yM })))) {
    return { reason: "duplicate_points" };
  }
  // The solver below only notices exact degeneracy. Four landmarks on the halfway line
  // and one off it give a system that is singular on the pitch but not quite in the
  // clicked pixels, so it solves -- to a view metres wrong away from that line, with
  // an error of millimetres at the points (docs/vision/97). The landmarks are exact,
  // so ask them directly.
  if (!inGeneralPosition(pairs.map((p) => ({ x: p.xM, y: p.yM })))) return { reason: "degenerate" };

  const src = normalise(pairs.map((p) => ({ x: p.px, y: p.py })));
  const dst = normalise(pairs.map((p) => ({ x: p.xM, y: p.yM })));

  // Each pair gives two rows of A h = b with h33 = 1.
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < pairs.length; i += 1) {
    const { x, y } = src.points[i]!;
    const { x: X, y: Y } = dst.points[i]!;
    rows.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    rhs.push(X);
    rows.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    rhs.push(Y);
  }
  const normal = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const normalRhs = new Array<number>(8).fill(0);
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r]!;
    for (let i = 0; i < 8; i += 1) {
      normalRhs[i] += row[i]! * rhs[r]!;
      for (let j = 0; j < 8; j += 1) normal[i]![j] += row[i]! * row[j]!;
    }
  }
  const h = solve(normal, normalRhs);
  if (!h) return { reason: "degenerate" };

  const hn: Homography = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
  // Undo the normalisation: H = T_dst^-1 · Hn · T_src.
  const undoDst = invert3(dst.transform);
  if (!undoDst) return { reason: "degenerate" };
  const H = multiply(multiply(undoDst, hn), src.transform);
  if (!Number.isFinite(H[8]) || Math.abs(H[8]) < 1e-12) return { reason: "degenerate" };
  // Scaled so the last entry is +-1, and signed so the clicked points are in view.
  const oriented = orientation(H.map((v) => v / H[8]) as Homography, pairs.map((p) => ({ x: p.px, y: p.py })));
  if (!oriented) return { reason: "degenerate" };
  const scaled = oriented.homography;

  const inverse = invert3(scaled);
  if (!inverse) return { reason: "degenerate" };
  let sumM = 0;
  let maxM = 0;
  let sumPx = 0;
  for (const p of pairs) {
    // A click the fit puts beyond the horizon still has an error to report, read without the sign.
    const onPitch = projectInView(scaled, { x: p.px, y: p.py }) ?? project(scaled, { x: p.px, y: p.py });
    if (!onPitch) return { reason: "degenerate" };
    const dM = Math.hypot(onPitch.x - p.xM, onPitch.y - p.yM);
    sumM += dM * dM;
    maxM = Math.max(maxM, dM);
    const onPicture = project(inverse, { x: p.xM, y: p.yM });
    if (!onPicture) return { reason: "degenerate" };
    sumPx += (onPicture.x - p.px) ** 2 + (onPicture.y - p.py) ** 2;
  }
  return {
    homography: scaled,
    rmseM: round(Math.sqrt(sumM / pairs.length)),
    maxErrorM: round(maxM),
    rmsePx: round(Math.sqrt(sumPx / pairs.length)),
    points: pairs.length,
    acrossHorizon: oriented.across,
  };
}

export function isFit(result: Fit | FitFailure): result is Fit {
  return "homography" in result;
}

/**
 * The homogeneous scale a point gets through the homography. Its sign tells which
 * side of the horizon the point is on: a point whose sign differs from a point
 * known to be in view is behind the camera, and `project` would mirror it to a
 * finite pixel that means nothing.
 */
export function homogeneousW(H: Homography, p: Point): number {
  return H[6] * p.x + H[7] * p.y + H[8];
}

/**
 * The homography signed so that `w` is positive at the picture points, with how
 * many of them disagree; null when a point lies on the horizon itself.
 *
 * A homography is defined only up to scale: `H` and `-H` send every pixel to the
 * same point on the pitch. They differ in the sign of `w`, and that sign is how a
 * reader tells a pixel the camera sees from one beyond the horizon, which
 * projects to a finite point that means nothing. So the sign has to be fixed by
 * something known to be in view, and the clicked landmarks are: a person clicked
 * them on the picture. The fit used to leave the sign to chance (it scaled the
 * last entry to +1, which is `w` at the top-left pixel, usually sky), and the
 * worker's `w <= 0` test then suppressed the whole pitch for such a camera
 * (docs/vision/50, appendix C).
 *
 * Points on both sides of the horizon cannot all be on the pitch in view: one of
 * them was clicked on the wrong thing. The sign then goes with the majority, and
 * `across` counts the rest so the caller can fail the calibration.
 */
export function orientation(H: Homography, picturePoints: readonly Point[]): { homography: Homography; across: number } | null {
  let positive = 0;
  let negative = 0;
  for (const p of picturePoints) {
    const w = homogeneousW(H, p);
    if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return null;
    if (w > 0) positive += 1;
    else negative += 1;
  }
  const flip = negative > positive;
  return { homography: flip ? (H.map((v) => -v) as Homography) : H, across: flip ? positive : negative };
}

/**
 * A stored homography, signed by the points it was fitted from. A row filed
 * before the fit oriented its result may be either way round, so every reader
 * that tells the horizon by sign orients what it reads. With no usable points,
 * or points that disagree, the matrix is returned as it was stored: nothing
 * better is known.
 */
export function orientStored(homography: unknown, points: unknown): Homography {
  const H = homography as Homography;
  const clicked = Array.isArray(points)
    ? points.flatMap((p: unknown) => {
        const c = p as { px?: unknown; py?: unknown } | null;
        return c && typeof c.px === "number" && typeof c.py === "number" ? [{ x: c.px, y: c.py }] : [];
      })
    : [];
  return (clicked.length ? orientation(H, clicked)?.homography : null) ?? H;
}

/** A point through an *oriented* homography, or null at or beyond the horizon. */
export function projectInView(H: Homography, p: Point): Point | null {
  const w = homogeneousW(H, p);
  if (!Number.isFinite(w) || w <= 1e-9) return null;
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

/**
 * A point through the homography whichever way it is signed, or null when it maps
 * to infinity. For the pitch-to-picture direction and for drawing; placing a
 * detection on the pitch uses `projectInView`, which knows the horizon.
 */
export function project(H: Homography, p: Point): Point | null {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return null;
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

export function invert3(m: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export function multiply(p: Homography, q: Homography): Homography {
  const out = new Array<number>(9).fill(0) as unknown as Homography;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = p[r * 3]! * q[c]! + p[r * 3 + 1]! * q[3 + c]! + p[r * 3 + 2]! * q[6 + c]!;
    }
  }
  return out;
}

/** Hartley normalisation: centroid at the origin, mean distance √2. Exported for its test. */
export function normalise(points: readonly Point[]): { points: Point[]; transform: Homography } {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p.x, 0) / n;
  const cy = points.reduce((s, p) => s + p.y, 0) / n;
  const mean = points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n;
  const s = mean > 0 ? Math.SQRT2 / mean : 1;
  return {
    points: points.map((p) => ({ x: (p.x - cx) * s, y: (p.y - cy) * s })),
    transform: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1],
  };
}

/** Gaussian elimination with partial pivoting; null when the matrix is singular to working precision. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  const scale = Math.max(...a.flat().map((v) => Math.abs(v)), 1);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-10 * scale) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    for (let r = col + 1; r < n; r += 1) {
      const factor = a[r]![col]! / a[col]![col]!;
      for (let c = col; c <= n; c += 1) a[r]![c] -= factor * a[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = a[r]![n]!;
    for (let c = r + 1; c < n; c += 1) sum -= a[r]![c]! * x[c]!;
    x[r] = sum / a[r]![r]!;
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

/**
 * Whether some four of the points have no three on one line: what a homography
 * needs to be fixed by them. Exported for its test.
 */
export function inGeneralPosition(points: readonly Point[], toleranceM = COLLINEAR_TOLERANCE_M): boolean {
  const n = points.length;
  const off = (a: number, b: number, c: number) => {
    const p = points[a]!, q = points[b]!, r = points[c]!;
    const base = Math.hypot(q.x - p.x, q.y - p.y);
    // The distance of each from the line through the other two; the triple is collinear if any is small.
    const area2 = Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    const longest = Math.max(base, Math.hypot(r.x - p.x, r.y - p.y), Math.hypot(r.x - q.x, r.y - q.y));
    return longest > 0 && area2 / longest > toleranceM;
  };
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      for (let c = b + 1; c < n; c += 1) {
        if (!off(a, b, c)) continue;
        for (let d = c + 1; d < n; d += 1) {
          if (off(a, b, d) && off(a, c, d) && off(b, c, d)) return true;
        }
      }
    }
  }
  return false;
}

function hasDuplicates(points: readonly Point[]): boolean {
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y) < 1e-6) return true;
    }
  }
  return false;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
