/**
 * Which timeline events appear on a player's own profile.
 *
 * A profile is the player's showcase. An offside or a booking is a fact about the match,
 * not something the page is for, so the timeline list leaves those out.
 *
 * **A display rule, not a payload rule.** The events stay in the API response, because two
 * other things on the profile need them: the appearance rows count yellows and reds per
 * match, and the goalkeeper panel treats a red card as a negative signal worth surfacing.
 * Filtering server-side would quietly empty both and the cause would be nowhere near the
 * symptom.
 */

const HIDDEN_TYPES = new Set(["offside", "yellow_card", "red_card"]);

export function showsOnProfileTimeline(event: { type: string }): boolean {
  return !HIDDEN_TYPES.has(event.type);
}
