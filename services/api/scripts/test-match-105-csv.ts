/**
 * Quick smoke test for match 105 (Oguntuase vs Omoruyi) CSV ingest parsing.
 * Run: pnpm --filter @dtp/api exec tsx scripts/test-match-105-csv.ts
 */
import { deriveMatchStatsFromCsvEvents } from "../src/scoreboard/match-csv-events";
import { parseMatchTimelineCsv } from "../src/scoreboard/match-csv-ingest";

const MATCH_105_CSV = `event_type,minute,team_side,player_name,assist_name,detail,home_score,away_score,narrative
full_time,,,,,,0,1,FC OMORUYI 1-0 FC OGUNTUASE — Destiny Nosa 84'
kick_off,0,,,,First half begins
half_time,45,,,,Half-time
second_half_kickoff,46,,,,Second half begins
possession,15,home,,,Oguntuase control midfield
possession,30,away,,,Omoruyi spell
foul,20,away,Ololade Yusuf,
corner_kick,25,away,,
save,38,home,Goalkeeper,
substitution,46,home,Anuoluwapo Oluwow,Korede Elejoba,#12 off #17 on
substitution,53,away,Ololade Yusuf,Destiny,#11 off #12 on
substitution,58,home,Shodakin Sodiq,Luka Samuel,#9 off #8 on
substitution,58,home,Jide Oluseye,Baare Adeyemi,#19 off #14 on
substitution,58,home,Tunde Oladejo,Okanlawon Adedapo,#7 off #16 on
substitution,61,away,David Adesanya,Sunday Komolafe,#9 off #7 on
close_chance,78,away,Destiny Nosa,,Header saved
goal,84,away,Destiny Nosa,
score_update,84,away,,,OMORUYI 1-0 OGUNTUASE`;

const parsed = parseMatchTimelineCsv(MATCH_105_CSV);
const stats = deriveMatchStatsFromCsvEvents(parsed.events, { narrative: parsed.narrative });

console.log("Match 105 CSV parse OK");
console.log("Score:", parsed.homeScore, "-", parsed.awayScore);
console.log("Events:", parsed.events.length);
console.log("Event types:", [...new Set(parsed.events.map((e) => e.csvType))].sort().join(", "));
console.log("Derived stats:", JSON.stringify(stats, null, 2));
