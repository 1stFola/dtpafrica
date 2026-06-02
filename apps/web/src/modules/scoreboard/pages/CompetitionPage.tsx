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
import { isAbortError } from "../../../api/client";
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
  const [standingsGroups, setStandingsGroups] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<CompetitionTab>("standings");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(name || "Competition");

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCompetition(slug, controller.signal)
      .then((c) => {
        if (cancelled) return null;
        setName(c.name);
        setSeason(c.season);
        setCompetitionType(c.type);
        setTeams(c.teams);
        // Matches + standings depend on the competition id, so they run in
        // parallel after the single competition fetch resolves (no extra waterfall).
        return Promise.all([
          fetchMatches({ competitionId: c.id }, controller.signal).then((m) => {
            if (!cancelled) setMatches(m);
          }),
          fetchStandings(c.id, controller.signal).then((s) => {
            if (cancelled) return;
            setStandings(s.rows);
            setStandingsGroups(s.groups ?? []);
          }),
        ]);
      })
      .catch((e) => {
        if (!cancelled && !isAbortError(e)) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug]);

  const groupedMatches = groupMatchesByMatchday(matches);

  return (
    <div className="sb-page">
      <header className="page-header">
        <h1>{name || (loading ? "Loading competition…" : "Competition")}</h1>
        <p className="muted">
          {season}
          {competitionType ? ` - ${competitionType}` : ""}
        </p>
      </header>

      {error && (
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
      )}

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
          {loading ? (
            <div className="sb-standings-skeleton" aria-busy="true">
              <span className="dtp-skeleton" style={{ height: "14rem", width: "100%" }} />
            </div>
          ) : standings.length === 0 ? (
            <div className="dtp-empty-state sb-empty">
              <p className="dtp-empty-state__title">No standings yet</p>
              <p>Standings appear once group matches are completed.</p>
            </div>
          ) : null}
          {!loading &&
            (standingsGroups.length ? standingsGroups : [""]).map((groupKey) => {
            const rows = groupKey
              ? standings.filter((r) => r.groupKey === groupKey)
              : standings;
            return (
              <div key={groupKey || "all"} className="sb-standings-group">
                {groupKey && <h3>Group {groupKey}</h3>}
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
                      <th>Form</th>
                      <th>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.teamId}>
                        <td>{row.rank ?? 0}</td>
                        <td>{row.teamName}</td>
                        <td>{row.played}</td>
                        <td>{row.won}</td>
                        <td>{row.drawn}</td>
                        <td>{row.lost}</td>
                        <td>{row.goalsFor}</td>
                        <td>{row.goalsAgainst}</td>
                        <td>{row.goalDifference}</td>
                        <td className="sb-form-cell">
                          <span className="sb-form-badges" aria-label={`Form ${(row.form ?? []).join(" ")}`}>
                            {(row.form ?? []).map((f, i) => (
                              <span key={`${row.teamId}-f-${i}`} className={`sb-form-badge sb-form-badge--${f.toLowerCase()}`}>
                                {f}
                              </span>
                            ))}
                            {(row.form ?? []).length === 0 && "—"}
                          </span>
                        </td>
                        <td>
                          <strong>{row.points}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>
      )}

      {activeTab === "teams" && (
        <section className="sb-section">
          <h2>Teams & squads</h2>
          {!loading && teams.length === 0 && (
            <div className="dtp-empty-state">
              <p className="dtp-empty-state__title">No teams registered</p>
              <p>Teams appear here once they are added to this competition.</p>
            </div>
          )}
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
          {!loading && groupedMatches.length === 0 && (
            <div className="dtp-empty-state">
              <p className="dtp-empty-state__title">No matches scheduled</p>
              <p>Fixtures will appear here once matchdays are published.</p>
            </div>
          )}
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
