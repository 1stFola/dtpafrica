import { Link } from "react-router-dom";
import type { SbCompetition, SbMatchListItem } from "../../../api/scoreboard";
import { matchCenterPath } from "../utils/matchPath";
import { TeamCrest } from "./TeamCrest";

/* Figma "Scorebaord" 186:139 -> "card/match1" (384x82, r19.24, #2b2b3d) and
   "Card/1" (382x42), the two rows that make up the Match Centre panel.

   card/match1 geometry, measured off the frame and expressed card-relative:
     crest pair   x19  y19   84x43  — two 43px #222232 discs overlapping by 2px
     title        x120 y19          — Source Sans 600 / 16.84 / lh 21.2 / #fff
     score row    y41              — same face, wide gaps around the dash
     status panel x327 y0   57x82  — #222232, label centred, e.g. FT / HT

   Card/1 geometry:
     flag  x0  y7  29x29
     name  x44 y0        — Source Sans 600 / 19.24 / lh 24.2 / #ffffff
     place x44 y26       — Source Sans 400 / 14.43 / lh 18.1 / #aaaaaa
     arrow x363 y12 19x19 */

/** Short status chip shown in the card's right-hand panel. */
function statusChip(match: SbMatchListItem): string {
  switch (match.status) {
    case "live":
      return "LIVE";
    case "halftime":
      return "HT";
    case "finished":
      return "FT";
    default:
      return "VS";
  }
}

/** Kick-off shown as time then date, e.g. "15:30 · 12 Aug". */
function kickoffLabel(kickoffAt: string | null): string {
  if (!kickoffAt) return "TBC";
  const d = new Date(kickoffAt);
  if (Number.isNaN(d.getTime())) return "TBC";
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${time} · ${date}`;
}

export function SbFixtureCard({ match }: { match: SbMatchListItem }) {
  const scored = match.status !== "scheduled";
  const live = match.status === "live" || match.status === "halftime";

  return (
    <Link
      to={matchCenterPath(match)}
      className="sb-fixture"
      data-live={live ? "true" : undefined}
    >
      <span className="sb-fixture__crests" aria-hidden="true">
        <span className="sb-fixture__crest">
          <TeamCrest team={match.homeTeam} size="sm" />
        </span>
        <span className="sb-fixture__crest">
          <TeamCrest team={match.awayTeam} size="sm" />
        </span>
      </span>

      <span className="sb-fixture__main">
        <span className="sb-fixture__teams">
          {match.homeTeam.name} vs {match.awayTeam.name}
        </span>
        <span className="sb-fixture__score">
          {scored ? (
            <>
              <span>{match.homeScore}</span>
              <span className="sb-fixture__dash">-</span>
              <span>{match.awayScore}</span>
            </>
          ) : (
            <span className="sb-fixture__kickoff">{kickoffLabel(match.kickoffAt)}</span>
          )}
        </span>
      </span>

      <span className="sb-fixture__status">{statusChip(match)}</span>
    </Link>
  );
}

/** Figma "Card/1" — the competition heading that sits above each fixture.
 *  Typed loosely so it takes either a full SbCompetition or the slim
 *  `{id, name, slug}` a match carries, which has no country. */
export type SbCompetitionRowRef = Pick<SbCompetition, "slug" | "name"> & {
  country?: string | null;
};

export function SbCompetitionRow({ competition }: { competition: SbCompetitionRowRef }) {
  return (
    <Link to={`/scoreboard/competition/${competition.slug}`} className="sb-comp-row">
      {/* Figma places a 29px flag here; the competition payload carries no crest
          field, so the disc renders as a neutral placeholder until it does. */}
      <span className="sb-comp-row__flag" aria-hidden="true" />
      <span className="sb-comp-row__text">
        <span className="sb-comp-row__name">{competition.name}</span>
        {competition.country ? (
          <span className="sb-comp-row__place">{competition.country}</span>
        ) : null}
      </span>
      <svg
        className="sb-comp-row__arrow"
        viewBox="0 0 7 13"
        width="7"
        height="13"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M0.5 0.5L6 6.5L0.5 12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
