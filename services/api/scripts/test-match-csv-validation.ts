/**
 * Validation smoke tests for match CSV ingest + possession engine.
 * Run: pnpm --filter @dtp/api exec tsx scripts/test-match-csv-validation.ts
 */
import {
  deriveMatchStatsFromCsvEvents,
  POSSESSION_EVENT_TYPES,
  POSSESSION_EXCLUDE_EVENT_TYPES,
} from "../src/scoreboard/match-csv-events";
import { parseMatchTimelineCsv } from "../src/scoreboard/match-csv-ingest";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const NEUTRAL_UNKNOWN_CSV = `event_type,minute,team_side,player_name,assist_name,detail,home_score,away_score,narrative,pen_home,pen_away,pen_winner
full_time,,,,,,0,0,Draw,,,
kick_off,0,Unknown,,,,First half begins,,,,
match_flow,10,Unknown,,,,Phase of play,,,,
half_time,45,,,,,Half-time,,,,
second_half_kickoff,46,unknown,,,,Second half,,,,
foul,20,home,Player,,,,,,,
goal,55,away,Scorer,,,,,,,`;

const parsedNeutral = parseMatchTimelineCsv(NEUTRAL_UNKNOWN_CSV);
assert(parsedNeutral.events.length === 6, `expected 6 events, got ${parsedNeutral.events.length}`);
assert(
  parsedNeutral.events[0].csvType === "kick_off" && parsedNeutral.events[0].teamSide === undefined,
  "kick_off with Unknown team_side should parse without teamSide"
);

const PEN_OPTIONAL_CSV = `event_type,minute,team_side,player_name,assist_name,detail,home_score,away_score,narrative,pen_home,pen_away,pen_winner
full_time,,,,,,1,0,Win,,,
kick_off,0,,,,,Kick-off,,,,
foul,12,home,Player A,,,,,,,
goal,70,home,Scorer,,,,,,,`;

parseMatchTimelineCsv(PEN_OPTIONAL_CSV);

const POSSESSION_CSV = `event_type,minute,team_side,player_name,assist_name,detail,home_score,away_score,narrative
full_time,,,,,,1,0,Test
possession,10,home,,,spell
possession,20,away,,,spell
foul,15,home,Player,
substitution,46,home,Off,On,
goal,80,home,Scorer,`;

const parsedPoss = parseMatchTimelineCsv(POSSESSION_CSV);
const stats = deriveMatchStatsFromCsvEvents(parsedPoss.events);
assert(stats.possession?.home === 50, `expected 50-50 possession, got ${JSON.stringify(stats.possession)}`);

console.log("match-csv validation tests OK");
console.log("POSSESSION include count:", POSSESSION_EVENT_TYPES.size);
console.log("POSSESSION exclude count:", POSSESSION_EXCLUDE_EVENT_TYPES.size);
