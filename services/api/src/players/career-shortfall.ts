/**
 * How far a career total has fallen below the competition rows beneath it.
 *
 * One rule, in one place, because two things need it and they must agree:
 * `mergePlayerRecords` applies it to the survivor at the moment a merge would
 * otherwise lose goals, and `planCareerTopUp` applies it in bulk to clean up the
 * merges that happened before the first one existed. Two copies of this would drift,
 * and the cost of drift is somebody's goals.
 *
 * **Only a shortfall counts.** A career total *above* its competition rows is the
 * normal, expected case, not a fault: it is the career a player typed in at
 * registration (`home.service.register`) before they ever played a match here. This
 * returns zero for that, rather than a negative number the caller has to remember to
 * clamp. `Player.careerGoals` mixes that self-reported baseline with the platform's
 * own increments and nothing can separate them again, so the only safe direction is
 * up.
 *
 * Why the shortfall exists at all: a merge moves the folded record's competition
 * stats to the survivor and cannot add its career total — that would double the
 * self-reported part — and then deletes the record holding it. The platform's share
 * of the number goes with it. On live this had happened to 20 players, 36 goals in
 * total: `NWOSU HENRY` had five goals in the RAK BDFA League chart and zero on his
 * profile.
 */
export type GoalsAndAssists = { goals: number; assists: number };

export function careerShortfall(
  held: GoalsAndAssists,
  fromCompetitions: GoalsAndAssists
): GoalsAndAssists {
  return {
    goals: Math.max(0, fromCompetitions.goals - held.goals),
    assists: Math.max(0, fromCompetitions.assists - held.assists),
  };
}
