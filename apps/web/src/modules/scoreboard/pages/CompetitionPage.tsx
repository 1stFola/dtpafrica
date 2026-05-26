import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchCompetition,
  fetchMatches,
  fetchStandings,
  type SbMatchListItem,
  type SbTeamWithSquad,
  type StandingRow,
} from "../../../api/scoreboard";
import { MatchCard } from "../components/MatchCard";
import { usePageTitle } from "../../../hooks/usePageTitle";

type CompetitionTab = "standings" | "teams" | "matches";

function matchdayLabel(match: SbMatchListItem) {
  if (match.roundLabel) {
    const matchday = match.roundLabel.match(/\bMD\s*\d+\b/i)?.[0];
    return matchday ? matchday.toUpperCase().replace(/\s+/, "") : match.roundLabel;
  }
  if (match.kickoffAt) {
    return new Date(match.kickoffAt).toLocaleDateString();
  }
  return "Unscheduled";
}

function groupMatchesByMatchday(matches: SbMatchListItem[]) {
  return matches.reduce<Array<{ label: string; matches: SbMatchListItem[] }>>((groups, match) => {
    const label = matchdayLabel(match);
    const group = groups.find((item) => item.label === label);
    if (group) {
      group.matches.push(match);
    } else {
      groups.push({ label, matches: [match] });
    }
    return groups;
  }, []);
}

export function CompetitionPage() {
  const { slug } = useParams<{ slug: string }>();
  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [competitionType, setCompetitionType] = useState("");
  const [teams, setTeams] = useState<SbTeamWithSquad[]>([]);
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [activeTab, setActiveTab] = useState<CompetitionTab>("standings");

  usePageTitle(name || "Competition");

  useEffect(() => {
    if (!slug) return;
    fetchCompetition(slug).then((c) => {
      setName(c.name);
      setSeason(c.season);
      setCompetitionType(c.type);
      setTeams(c.teams);
      fetchMatches({ competitionId: c.id }).then(setMatches);
      fetchStandings(c.id).then((s) => setStandings(s.rows));
    });
  }, [slug]);

  const groupedMatches = groupMatchesByMatchday(matches);

  return (
    <div className="sb-page">
      <header className="page-header">
        <h1>{name}</h1>
        <p className="muted">
          {season}
          {competitionType ? ` - ${competitionType}` : ""}
        </p>
      </header>

      <nav className="sb-tabs" aria-label="Competition sections">
        {(["standings", "teams", "matches"] as CompetitionTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? "sb-tab active" : "sb-tab"}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === "standings" && (
        <section className="sb-section">
          <h2>Standings</h2>
          <table className="sip-table sb-standings-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>P</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>GF</th>
                <th>GA</th>
                <th>GD</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => (
                <tr key={row.teamId}>
                  <td>{i + 1}</td>
                  <td>{row.teamName}</td>
                  <td>{row.played}</td>
                  <td>{row.won}</td>
                  <td>{row.drawn}</td>
                  <td>{row.lost}</td>
                  <td>{row.goalsFor}</td>
                  <td>{row.goalsAgainst}</td>
                  <td>{row.goalDifference}</td>
                  <td>
                    <strong>{row.points}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === "teams" && (
        <section className="sb-section">
          <h2>Teams & squads</h2>
          <div className="sb-team-grid">
            {teams.map((team) => (
              <article key={team.id} className="sb-team-card">
                <div className="sb-team-card__header">
                  <div>
                    <h3>
                      <Link to={`/scoreboard/team/${team.id}`} className="text-link">
                        {team.name}
                      </Link>
                    </h3>
                    {team.shortName && <span>{team.shortName}</span>}
                  </div>
                  <strong>{team.squad.length}</strong>
                </div>
                {team.squad.length === 0 ? (
                  <p className="muted">No public squad rows have been added yet.</p>
                ) : (
                  <ul className="sb-squad-list">
                    {team.squad.slice(0, 6).map((row) => {
                      const linkedPlayer = row.player?.isPublic ? row.player : null;
                      const profilePath = linkedPlayer?.slug
                        ? `/player/${linkedPlayer.slug}`
                        : linkedPlayer
                          ? `/player/${linkedPlayer.id}`
                          : null;

                      return (
                        <li key={row.id}>
                          <span className="sb-squad-number">
                            {row.shirtNumber ?? "Squad"}
                          </span>
                          <div>
                            {profilePath ? (
                              <Link to={profilePath} className="text-link">
                                {linkedPlayer?.displayName ?? row.displayName}
                              </Link>
                            ) : (
                              <strong>{row.displayName}</strong>
                            )}
                            <small>
                              {row.position ??
                                linkedPlayer?.positionPrimary ??
                                "Position pending"}
                              {linkedPlayer?.overallRating != null
                                ? ` - ${linkedPlayer.overallRating} OVR`
                                : ""}
                            </small>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {activeTab === "matches" && (
        <section className="sb-section">
          <h2>Matchdays</h2>
          {groupedMatches.map((group) => (
            <div key={group.label} className="sb-matchday-group">
              <div className="section-heading">
                <h3>{group.label}</h3>
                <span className="muted">{group.matches.length} matches</span>
              </div>
              <div className="sb-match-grid">
                {group.matches.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
