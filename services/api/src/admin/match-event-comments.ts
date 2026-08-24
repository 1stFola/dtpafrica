/**
 * Professional match commentary generated from tapped events.
 *
 * A recorder taps only minute, type, side and shirt number. This turns that
 * into the kind of line the timeline already carries, in the house voice taken
 * from the existing match summaries.
 *
 * Each type has several variants so a match with six corners does not read the
 * same sentence six times; the variant is picked deterministically from the
 * event's position, so regenerating a sheet produces identical copy.
 */

export type RecordedEventInput = {
  type: string;
  /** Logged match minute. Added time is carried separately, football-style. */
  minute: number;
  addedMinute?: number | null;
  side: "home" | "away";
  playerNumber?: number | null;
};

export type CommentContext = {
  teamName: string;
  opponentName: string;
  /** Resolved from the matchday squad when one exists, else null. */
  playerName?: string | null;
};

/** "23'" or "45+2'" — the prefix every comment opens with. */
export function formatMinute(minute: number, addedMinute?: number | null): string {
  return addedMinute && addedMinute > 0 ? `${minute}+${addedMinute}'` : `${minute}'`;
}

/**
 * How the player is named. A squad gives a real name; without one the shirt
 * number still reads properly, which is what most RAK fixtures will have.
 */
function playerPhrase(ctx: CommentContext, event: RecordedEventInput): string {
  const { playerName } = ctx;
  const number = event.playerNumber;
  if (playerName && number) return `No. ${number} ${playerName}`;
  if (playerName) return playerName;
  if (number) return `No. ${number}`;
  return "";
}

/** Subject for lines that work with or without a known player. */
function actor(ctx: CommentContext, event: RecordedEventInput): string {
  const player = playerPhrase(ctx, event);
  return player ? `${ctx.teamName} ${player}` : ctx.teamName;
}

type Variant = (ctx: CommentContext, event: RecordedEventInput) => string;

/* Voice matched to the existing summaries: a headline, then one clause of
   detail. Team and player are woven in where the event has an obvious owner. */
const TEMPLATES: Record<string, Variant[]> = {
  assist: [
    (c, e) => `Assist: ${playerPhrase(c, e) || c.teamName}`,
    (c, e) => `Assist! ${actor(c, e)} provides the pass for the goal.`,
  ],
  clearance: [
    (c, e) => `Clearance! ${actor(c, e)} reacts quickly to clear the danger.`,
    (c) => `Defensive Clearance! ${c.teamName}'s defence hacks the ball to safety under pressure.`,
    (c, e) => `Clearance! ${actor(c, e)} gets a vital touch to end the attack.`,
  ],
  corner_kick: [
    (c, e) => `Corner Kick! ${actor(c, e)} delivers the set piece.`,
    (c) => `Corner Kick! ${c.teamName} earn a corner as ${c.opponentName} defend deep.`,
    (c, e) => `Corner Kick! ${actor(c, e)} takes another corner for ${c.teamName}.`,
    (c) => `Corner Kick! Sustained pressure from ${c.teamName} forces another corner.`,
  ],
  cross: [
    (c, e) => `Cross! ${actor(c, e)} swings a dangerous ball into the box.`,
    (c) => `Cross! ${c.teamName} work the ball wide and whip a delivery towards the far post.`,
    (c, e) => `Cross! ${actor(c, e)} picks out a team-mate with an inviting delivery.`,
  ],
  dribble: [
    (c, e) => `Dribble! ${actor(c, e)} produces an excellent run to advance ${c.teamName}'s attack.`,
    (c, e) => `Skillful Play! ${actor(c, e)} beats his man and drives at the ${c.opponentName} defence.`,
    (c, e) => `Dribble! ${actor(c, e)} carries the ball through midfield and breaks the line.`,
  ],
  freekick: [
    (c, e) => `Free-Kick! ${actor(c, e)} takes the resulting set piece.`,
    (c) => `Free-Kick! ${c.teamName} earn a set-piece opportunity.`,
    (c, e) => `Free-Kick! ${actor(c, e)} takes another set piece for ${c.teamName}.`,
    (c) => `Free-Kick! ${c.teamName} restart play from the resulting infringement.`,
  ],
  goal: [
    (c, e) => `GOAL! ${c.teamName.toUpperCase()} – ${playerPhrase(c, e) || "the striker"} finds the back of the net.`,
    (c, e) => `GOAL! ${c.teamName.toUpperCase()} – ${playerPhrase(c, e) || "the forward"} finishes brilliantly to beat the goalkeeper.`,
    (c, e) => `GOAL! ${c.teamName.toUpperCase()} – ${playerPhrase(c, e) || "the attacker"} converts to extend ${c.teamName}'s advantage.`,
  ],
  goal_line_clearance: [
    (c, e) => `Goal-Line Clearance! ${actor(c, e)} hooks the ball off the line with the goalkeeper beaten.`,
    (c) => `Goal-Line Clearance! ${c.teamName} survive as a defender scrambles the ball clear from under the bar.`,
  ],
  goal_penalty: [
    (c, e) => `GOAL! ${c.teamName.toUpperCase()} – ${playerPhrase(c, e) || "the taker"} converts from the penalty spot.`,
    (c, e) => `PENALTY GOAL! ${playerPhrase(c, e) || "The taker"} sends the goalkeeper the wrong way for ${c.teamName}.`,
  ],
  goalkeeper_claim: [
    (c, e) => `Goalkeeper Claim! ${actor(c, e)} comes off his line to gather the cross safely.`,
    (c) => `Goalkeeper Claim! ${c.teamName}'s keeper takes the ball cleanly under pressure.`,
  ],
  goalkeeper_command: [
    (c, e) => `Goalkeeper Command! ${actor(c, e)} organises his defence and takes charge of the area.`,
    (c) => `Goalkeeper Command! ${c.teamName}'s keeper commands his box and settles the back line.`,
  ],
  goalkeeper_distribution: [
    (c, e) => `Goalkeeper Distribution! ${actor(c, e)} launches a quick counter with an accurate throw.`,
    (c) => `Goalkeeper Distribution! ${c.teamName} build from the back as the keeper picks out a team-mate.`,
  ],
  goalkeeper_intervention: [
    (c, e) => `Goalkeeper Intervention! ${actor(c, e)} races out to sweep up behind the defence.`,
    (c) => `Goalkeeper Intervention! ${c.teamName}'s keeper reads the through ball and clears the danger.`,
  ],
  interception: [
    (c, e) => `Interception! ${actor(c, e)} reads the danger and breaks up the move.`,
    (c) => `Interception! ${c.teamName} cut out a ${c.opponentName} attack with an important defensive intervention.`,
    (c, e) => `Interception! ${actor(c, e)} steps in to win the ball back.`,
  ],
  long_throw: [
    (c, e) => `Long Throw! ${actor(c, e)} launches the ball deep into the penalty area.`,
    (c) => `Long Throw! ${c.teamName} use the throw as a set piece and cause problems in the box.`,
  ],
  midfield_battle: [
    (c) => `Midfield Battle! Neither side gives an inch as ${c.teamName} and ${c.opponentName} contest every second ball.`,
    (c) => `Midfield Battle! The game tightens up as ${c.teamName} fight to win control of the centre.`,
  ],
  missed_chance: [
    (c, e) => `Missed Chance! ${actor(c, e)} is presented with a clear opening but cannot make it count.`,
    (c) => `Missed Chance! ${c.teamName} carve out a golden opportunity and waste it.`,
  ],
  offside: [
    (c) => `Offside! ${c.teamName} are caught beyond the ${c.opponentName} defensive line.`,
    (c) => `Offside! ${c.teamName} are flagged offside during another attacking move.`,
    (c, e) => `Offside! ${actor(c, e)} times the run poorly and the flag goes up.`,
  ],
  one_on_one: [
    (c, e) => `One-on-One! ${actor(c, e)} breaks clean through with only the goalkeeper to beat.`,
    (c) => `One-on-One! ${c.teamName} spring the offside trap and race in behind the ${c.opponentName} defence.`,
  ],
  own_goal: [
    (c, e) => `OWN GOAL! ${playerPhrase(c, e) || "A defender"} turns the ball into his own net, gifting ${c.opponentName} the goal.`,
    (c) => `OWN GOAL! Disaster for ${c.teamName} as the clearance ends up in the back of their own net.`,
  ],
  penalty_saved: [
    (c, e) => `PENALTY SAVED! ${actor(c, e)} guesses right and keeps the spot-kick out.`,
    (c) => `PENALTY SAVED! ${c.teamName}'s goalkeeper produces a huge stop from twelve yards.`,
  ],
  penalty_shootout: [
    (c) => `Penalty Shootout! The match goes to spot-kicks between ${c.teamName} and ${c.opponentName}.`,
  ],
  recovery_tackle: [
    (c, e) => `Recovery Tackle! ${actor(c, e)} chases back and wins the ball with a perfectly timed challenge.`,
    (c) => `Recovery Tackle! A ${c.teamName} defender recovers ground to snuff out the counter.`,
  ],
  save: [
    (c, e) => `Save! ${actor(c, e)} makes an important stop to deny ${c.opponentName}.`,
    (c) => `Save! ${c.teamName}'s goalkeeper reacts well to keep the effort out.`,
    (c) => `Save! ${c.teamName}'s goalkeeper gathers safely to prevent further danger.`,
    (c) => `Save! Another important stop from the ${c.teamName} goalkeeper.`,
  ],
  shot_off_target: [
    (c, e) => `Shot Off Target! ${actor(c, e)} sends the effort wide.`,
    (c, e) => `Shot Off Target! ${actor(c, e)} attempts an ambitious strike but misses the target.`,
    (c) => `Shot Off Target! ${c.teamName} attempt an effort on goal, but it drifts off target.`,
  ],
  sustained_pressure: [
    (c) => `Sustained Pressure! ${c.teamName} pin ${c.opponentName} deep in their own half with relentless possession.`,
    (c) => `Sustained Pressure! Wave after wave of ${c.teamName} attack keeps the defence pinned back and unable to clear.`,
    (c) => `Sustained Pressure! The ball is recycled constantly as ${c.opponentName} are forced into a desperate block.`,
    (c) => `Sustained Pressure! Dominant midfield control allows ${c.teamName} to camp inside the opposition half.`,
  ],
  volley_missed: [
    (c, e) => `Volley Missed! ${actor(c, e)} gets under the ball and sends the half-volley high over the bar.`,
    (c) => `Volley Missed! A first-time volley from the cut-back lacks composure and skews wide.`,
    (c, e) => `Volley Missed! ${actor(c, e)} strikes the volley with too much power and it flies well over.`,
  ],
  woodwork: [
    (c, e) => `Woodwork! ${actor(c, e)} unleashes a thunderous strike that beats the keeper but crashes back off the crossbar.`,
    (c) => `Woodwork! A curling ${c.teamName} effort clips the outside of the post and bounces wide.`,
    (c, e) => `Woodwork! ${actor(c, e)} rattles the upright with the goalkeeper completely beaten.`,
  ],
};

/** Readable fallback for any type without bespoke copy. */
function fallback(type: string, ctx: CommentContext, event: RecordedEventInput): string {
  const label = type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const who = actor(ctx, event);
  return `${label}! ${who}.`;
}

/**
 * Build the comment for one event.
 *
 * `occurrence` is how many events of this type have already been generated for
 * the match, so repeated events cycle through the variants instead of
 * repeating. Deterministic: same sheet in, same copy out.
 */
export function generateEventComment(
  event: RecordedEventInput,
  ctx: CommentContext,
  occurrence = 0
): string {
  const variants = TEMPLATES[event.type];
  const body = variants?.length
    ? variants[occurrence % variants.length](ctx, event)
    : fallback(event.type, ctx, event);
  return `${formatMinute(event.minute, event.addedMinute)} - ${body}`;
}

/** Generate comments for a whole sheet, cycling variants per type. */
export function generateEventComments(
  events: RecordedEventInput[],
  contextFor: (event: RecordedEventInput) => CommentContext
): string[] {
  const seen = new Map<string, number>();
  return events.map((event) => {
    const count = seen.get(event.type) ?? 0;
    seen.set(event.type, count + 1);
    return generateEventComment(event, contextFor(event), count);
  });
}
