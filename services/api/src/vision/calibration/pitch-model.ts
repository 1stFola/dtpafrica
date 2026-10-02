/**
 * The pitch, in metres.
 *
 * 105 × 68 by default, with the actual dimensions stored when known: grassroots
 * pitches are frequently non-standard, and assuming 105 × 68 on a short pitch
 * silently corrupts every distance derived from it (docs/vision/09 § Calibration).
 *
 * Coordinates: x runs along the length from the left goal line (0) to the right
 * (length); y runs across the width from the near touchline (0) to the far one
 * (width). Every landmark below is placed from the dimensions, so a 90 × 55 pitch
 * gets its own penalty spots eleven metres out and its own box corners, and the
 * fixed Laws-of-the-Game measurements (box depths, circle radius, goal width) are
 * what they are on any pitch.
 */

export type PitchDimensions = { lengthM: number; widthM: number };

export const DEFAULT_PITCH: PitchDimensions = { lengthM: 105, widthM: 68 };

/** Laws of the Game, in metres. These do not scale with the pitch. */
export const PENALTY_AREA_DEPTH_M = 16.5;
export const PENALTY_AREA_WIDTH_M = 40.32;
export const GOAL_AREA_DEPTH_M = 5.5;
export const GOAL_AREA_WIDTH_M = 18.32;
export const PENALTY_SPOT_M = 11;
export const CENTRE_CIRCLE_RADIUS_M = 9.15;
export const GOAL_WIDTH_M = 7.32;

export const MIN_PITCH_LENGTH_M = 45;
export const MAX_PITCH_LENGTH_M = 120;
export const MIN_PITCH_WIDTH_M = 30;
export const MAX_PITCH_WIDTH_M = 90;

export type PitchLandmark = {
  /** Stable id a calibration point names, e.g. `corner_left_near`. */
  id: string;
  name: string;
  xM: number;
  yM: number;
};

export function pitchProblem(dims: PitchDimensions): string | null {
  const { lengthM, widthM } = dims;
  if (!Number.isFinite(lengthM) || !Number.isFinite(widthM)) return "Pitch dimensions must be numbers of metres.";
  if (lengthM < MIN_PITCH_LENGTH_M || lengthM > MAX_PITCH_LENGTH_M) return `Pitch length must be ${MIN_PITCH_LENGTH_M}–${MAX_PITCH_LENGTH_M} m.`;
  if (widthM < MIN_PITCH_WIDTH_M || widthM > MAX_PITCH_WIDTH_M) return `Pitch width must be ${MIN_PITCH_WIDTH_M}–${MAX_PITCH_WIDTH_M} m.`;
  if (widthM >= lengthM) return "A pitch is longer than it is wide.";
  return null;
}

/**
 * Every landmark a person can click, placed from the dimensions. Left and right
 * are the two goal lines; near and far are the two touchlines; `_box` is the
 * penalty area and `_goal_area` the six-yard box.
 */
export function pitchLandmarks(dims: PitchDimensions = DEFAULT_PITCH): PitchLandmark[] {
  const L = dims.lengthM;
  const W = dims.widthM;
  const mid = W / 2;
  const out: PitchLandmark[] = [];
  const add = (id: string, name: string, xM: number, yM: number) => out.push({ id, name, xM: round(xM), yM: round(yM) });

  add("corner_left_near", "Left corner, near touchline", 0, 0);
  add("corner_left_far", "Left corner, far touchline", 0, W);
  add("corner_right_near", "Right corner, near touchline", L, 0);
  add("corner_right_far", "Right corner, far touchline", L, W);
  add("halfway_near", "Halfway line, near touchline", L / 2, 0);
  add("halfway_far", "Halfway line, far touchline", L / 2, W);
  add("centre_spot", "Centre spot", L / 2, mid);
  add("centre_circle_near", "Centre circle, nearest the near touchline", L / 2, mid - CENTRE_CIRCLE_RADIUS_M);
  add("centre_circle_far", "Centre circle, nearest the far touchline", L / 2, mid + CENTRE_CIRCLE_RADIUS_M);
  add("centre_circle_left", "Centre circle, left of the spot", L / 2 - CENTRE_CIRCLE_RADIUS_M, mid);
  add("centre_circle_right", "Centre circle, right of the spot", L / 2 + CENTRE_CIRCLE_RADIUS_M, mid);

  for (const [side, x0, dir] of [["left", 0, 1], ["right", L, -1]] as const) {
    const boxX = x0 + dir * PENALTY_AREA_DEPTH_M;
    const goalAreaX = x0 + dir * GOAL_AREA_DEPTH_M;
    add(`${side}_box_near_goalline`, `${cap(side)} penalty area, near corner on the goal line`, x0, mid - PENALTY_AREA_WIDTH_M / 2);
    add(`${side}_box_far_goalline`, `${cap(side)} penalty area, far corner on the goal line`, x0, mid + PENALTY_AREA_WIDTH_M / 2);
    add(`${side}_box_near`, `${cap(side)} penalty area, near corner`, boxX, mid - PENALTY_AREA_WIDTH_M / 2);
    add(`${side}_box_far`, `${cap(side)} penalty area, far corner`, boxX, mid + PENALTY_AREA_WIDTH_M / 2);
    add(`${side}_goal_area_near_goalline`, `${cap(side)} goal area, near corner on the goal line`, x0, mid - GOAL_AREA_WIDTH_M / 2);
    add(`${side}_goal_area_far_goalline`, `${cap(side)} goal area, far corner on the goal line`, x0, mid + GOAL_AREA_WIDTH_M / 2);
    add(`${side}_goal_area_near`, `${cap(side)} goal area, near corner`, goalAreaX, mid - GOAL_AREA_WIDTH_M / 2);
    add(`${side}_goal_area_far`, `${cap(side)} goal area, far corner`, goalAreaX, mid + GOAL_AREA_WIDTH_M / 2);
    add(`${side}_penalty_spot`, `${cap(side)} penalty spot`, x0 + dir * PENALTY_SPOT_M, mid);
    add(`${side}_post_near`, `${cap(side)} goal, near post`, x0, mid - GOAL_WIDTH_M / 2);
    add(`${side}_post_far`, `${cap(side)} goal, far post`, x0, mid + GOAL_WIDTH_M / 2);
  }
  return out;
}

export function landmarkById(dims: PitchDimensions): Map<string, PitchLandmark> {
  return new Map(pitchLandmarks(dims).map((l) => [l.id, l]));
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
