import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  fetchClubShowcase,
  isAbortError,
  type Academy,
  type ClubShowcase,
  type ClubShowcaseMatch,
  type ClubShowcaseTeamRef,
} from "../../../api/client";
import { matchCenterPath } from "../../scoreboard/utils/matchPath";
import { safeHref } from "../../../lib/safe-href";
import { clubInitials, stableHue } from "../../../utils/identity";

/**
 * "View club" showcase. Opens straight away with what the Clubs page already
 * has (crest, name, location, competitions) and fills in the record, form,
 * fixtures, scorers and players once GET /home/academies/:slug/showcase lands.
 */

type Props = {
  club: Academy;
  /** Partner clubs also get their login from inside the modal. */
  partnerLoginHref: string | null;
  onClose: () => void;
};

const OUTCOME_LABEL = { W: "Win", D: "Draw", L: "Loss" } as const;

function competitionTitle(name: string, season: string) {
  const year = season.match(/\d{4}/)?.[0];
  return !year || name.includes(year) ? name : `${name} ${year}`;
}

function kickoffLabel(iso: string | null) {
  if (!iso) return "Date to be confirmed";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MiniCrest({ team }: { team: ClubShowcaseTeamRef }) {
  return team.logoUrl ? (
    <img className="club-sc__mini-crest" src={team.logoUrl} alt="" loading="lazy" />
  ) : (
    <span className="club-sc__mini-crest club-sc__mini-crest--initials" aria-hidden="true">
      {clubInitials(team.shortName || team.name)}
    </span>
  );
}

function MatchRow({ match }: { match: ClubShowcaseMatch }) {
  const live = match.status === "live" || match.status === "halftime";
  const played = match.status === "finished" || live;
  return (
    <li>
      <Link to={matchCenterPath({ slug: match.matchSlug, id: match.matchId })} className="club-sc__match">
        <span className={`club-sc__side${match.clubSide === "home" ? " is-club" : ""}`}>
          <MiniCrest team={match.home} />
          <span className="club-sc__team-name">{match.home.name}</span>
        </span>
        <span className="club-sc__score" aria-label={played ? `${match.score.home} to ${match.score.away}` : "vs"}>
          {played ? `${match.score.home} – ${match.score.away}` : "vs"}
        </span>
        <span className={`club-sc__side club-sc__side--away${match.clubSide === "away" ? " is-club" : ""}`}>
          <span className="club-sc__team-name">{match.away.name}</span>
          <MiniCrest team={match.away} />
        </span>
        <span className="club-sc__match-meta">
          {live ? (
            <span className="club-sc__live">Live</span>
          ) : match.outcome ? (
            <span className={`club-sc__outcome club-sc__outcome--${match.outcome}`}>
              {OUTCOME_LABEL[match.outcome]}
            </span>
          ) : (
            kickoffLabel(match.kickoffAt)
          )}
          <span className="club-sc__match-comp">
            {competitionTitle(match.competitionName, match.season)}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** W/D/L as a donut, drawn with stroke dashes so it needs no chart library. */
function RecordRing({ record }: { record: ClubShowcase["record"] }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { key: "won", value: record.won, className: "club-sc__ring-win" },
    { key: "drawn", value: record.drawn, className: "club-sc__ring-draw" },
    { key: "lost", value: record.lost, className: "club-sc__ring-loss" },
  ];
  let offset = 0;
  const winRate = record.played ? Math.round((record.won / record.played) * 100) : 0;
  return (
    <div className="club-sc__ring" role="img" aria-label={`Won ${record.won}, drew ${record.drawn}, lost ${record.lost}`}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} className="club-sc__ring-track" />
        {segments.map((segment) => {
          const length = record.played ? (segment.value / record.played) * circumference : 0;
          const circle = (
            <circle
              key={segment.key}
              cx="40"
              cy="40"
              r={radius}
              className={segment.className}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return circle;
        })}
      </svg>
      <span className="club-sc__ring-label">
        <strong>{winRate}%</strong>
        <small>win rate</small>
      </span>
    </div>
  );
}

function SkeletonBody() {
  return (
    <div className="club-sc__body" aria-hidden="true">
      <div className="club-sc__skeleton club-sc__skeleton--wide" />
      <div className="club-sc__skeleton-row">
        <div className="club-sc__skeleton" />
        <div className="club-sc__skeleton" />
      </div>
    </div>
  );
}

export function ClubShowcaseModal({ club, partnerLoginHref, onClose }: Props) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<ClubShowcase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetchClubShowcase(club.slug, controller.signal)
      .then(setData)
      .catch((e) => {
        if (!isAbortError(e)) setError("This club's match record could not be loaded.");
      });
    return () => controller.abort();
  }, [club.slug, attempt]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Move focus into the dialog on open, and restore it to the trigger on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  const profile = data?.club ?? club;
  const websiteHref = safeHref(profile.websiteUrl);
  const competitions = profile.competitions ?? [];
  const record = data?.record;
  const location = [profile.city, profile.country].filter(Boolean).join(", ");
  const isPartner = Boolean(profile.loginUsername);
  const hue = stableHue(profile.slug);
  const goalDifference = record ? record.goalsFor - record.goalsAgainst : 0;
  // Oldest to newest, so the form guide reads left to right like a table.
  const form = (data?.recentResults ?? []).filter((m) => m.outcome).slice().reverse();

  return createPortal(
    <div className="club-sc-backdrop" role="presentation" onClick={onClose}>
      <div
        className="club-sc"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ "--club-hue": String(hue) } as CSSProperties}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="club-sc__close"
          aria-label="Close club profile"
          onClick={onClose}
        >
          ×
        </button>

        <header className="club-sc__hero">
          <div className="club-sc__crest">
            {profile.logoUrl ? (
              <img src={profile.logoUrl} alt="" />
            ) : (
              <span aria-hidden="true">{clubInitials(profile.name)}</span>
            )}
          </div>
          <div className="club-sc__ident">
            <p className="club-sc__eyebrow">
              {isPartner ? "Partner Academy" : "Club"}
              {competitions.length > 0 &&
                ` · ${competitions.length} competition${competitions.length === 1 ? "" : "s"}`}
            </p>
            <h2 id={titleId} className="club-sc__name">
              {profile.name}
            </h2>
            {location && <p className="club-sc__location">{location}</p>}
            {form.length > 0 && (
              <ol className="club-sc__form" aria-label="Recent form, oldest first">
                {form.map((match) => (
                  <li
                    key={match.matchId}
                    className={`club-sc__form-pip club-sc__form-pip--${match.outcome}`}
                    title={`${OUTCOME_LABEL[match.outcome!]} · ${match.home.name} ${match.score.home}–${match.score.away} ${match.away.name}`}
                  >
                    {match.outcome}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </header>

        {profile.description && <p className="club-sc__description">{profile.description}</p>}

        {error ? (
          <div className="club-sc__body">
            <p className="club-sc__empty" role="alert">
              {error}{" "}
              <button type="button" className="club-sc__retry" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </p>
          </div>
        ) : !data ? (
          <SkeletonBody />
        ) : (
          <div className="club-sc__body">
            {record && record.played > 0 ? (
              <section className="club-sc__record" aria-label="Match record">
                <RecordRing record={record} />
                <dl className="club-sc__stats">
                  <div>
                    <dt>Played</dt>
                    <dd>{record.played}</dd>
                  </div>
                  <div>
                    <dt>Won</dt>
                    <dd>{record.won}</dd>
                  </div>
                  <div>
                    <dt>Drawn</dt>
                    <dd>{record.drawn}</dd>
                  </div>
                  <div>
                    <dt>Lost</dt>
                    <dd>{record.lost}</dd>
                  </div>
                  <div>
                    <dt>Goals</dt>
                    <dd>
                      {record.goalsFor}
                      <small> – {record.goalsAgainst}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Goal diff.</dt>
                    <dd>{goalDifference > 0 ? `+${goalDifference}` : goalDifference}</dd>
                  </div>
                  <div>
                    <dt>Clean sheets</dt>
                    <dd>{record.cleanSheets}</dd>
                  </div>
                  <div>
                    <dt>Players</dt>
                    <dd>{data.squadSize}</dd>
                  </div>
                </dl>
              </section>
            ) : (
              <p className="club-sc__empty">
                {competitions.length
                  ? "No results yet — this club's first published match is still to come."
                  : "This club hasn't entered a ScoreBoard competition yet."}
              </p>
            )}

            {competitions.length > 0 && (
              <section className="club-sc__section">
                <h3>Competitions</h3>
                <ul className="club-sc__chips">
                  {competitions.map((entry) => (
                    <li key={entry.competitionId}>
                      <Link to={`/scoreboard/team/${entry.teamId}`}>
                        {competitionTitle(entry.competitionName, entry.season)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(data.recentResults.length > 0 || data.upcoming.length > 0) && (
              <div className="club-sc__columns">
                {data.recentResults.length > 0 && (
                  <section className="club-sc__section">
                    <h3>Recent results</h3>
                    <ul className="club-sc__matches">
                      {data.recentResults.map((match) => (
                        <MatchRow key={match.matchId} match={match} />
                      ))}
                    </ul>
                  </section>
                )}
                {data.upcoming.length > 0 && (
                  <section className="club-sc__section">
                    <h3>Next up</h3>
                    <ul className="club-sc__matches">
                      {data.upcoming.map((match) => (
                        <MatchRow key={match.matchId} match={match} />
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {data.topScorers.length > 0 && (
              <section className="club-sc__section">
                <h3>Top scorers</h3>
                <ol className="club-sc__scorers">
                  {data.topScorers.map((scorer, index) => {
                    const share = (scorer.goals / data.topScorers[0].goals) * 100;
                    const body = (
                      <>
                        <span className="club-sc__rank">{index + 1}</span>
                        <span className="club-sc__avatar">
                          {scorer.photoUrl ? (
                            <img src={scorer.photoUrl} alt="" loading="lazy" />
                          ) : (
                            clubInitials(scorer.name)
                          )}
                        </span>
                        <span className="club-sc__scorer-name">{scorer.name}</span>
                        <span className="club-sc__bar" aria-hidden="true">
                          <span style={{ width: `${share}%` }} />
                        </span>
                        <strong className="club-sc__goals">
                          {scorer.goals}
                          <small> goal{scorer.goals === 1 ? "" : "s"}</small>
                        </strong>
                      </>
                    );
                    return (
                      <li key={`${scorer.name}-${index}`}>
                        {scorer.slug ? (
                          <Link to={`/players/${scorer.slug}`} className="club-sc__scorer">
                            {body}
                          </Link>
                        ) : (
                          <span className="club-sc__scorer">{body}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {data.players.length > 0 && (
              <section className="club-sc__section">
                <h3>Players to watch</h3>
                <ul className="club-sc__players">
                  {data.players.map((player, index) => {
                    const body = (
                      <>
                        <span className="club-sc__player-photo">
                          {player.photoUrl ? (
                            <img src={player.photoUrl} alt="" loading="lazy" />
                          ) : (
                            <span aria-hidden="true">{clubInitials(player.name)}</span>
                          )}
                          {player.overallRating != null && (
                            <span className="club-sc__rating" aria-label={`Rating ${player.overallRating}`}>
                              {player.overallRating}
                            </span>
                          )}
                        </span>
                        <span className="club-sc__player-name">{player.name}</span>
                        <span className="club-sc__player-meta">
                          {[player.position, player.shirtNumber != null ? `#${player.shirtNumber}` : null]
                            .filter(Boolean)
                            .join(" · ") || "Squad player"}
                        </span>
                      </>
                    );
                    return (
                      <li key={`${player.name}-${index}`}>
                        {player.slug ? (
                          <Link to={`/players/${player.slug}`} className="club-sc__player">
                            {body}
                          </Link>
                        ) : (
                          <span className="club-sc__player">{body}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}

        <footer className="club-sc__foot">
          {websiteHref && (
            <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="club-sc__link">
              Club website ↗
            </a>
          )}
          {isPartner && partnerLoginHref && (
            <Link to={partnerLoginHref} className="dtp-btn">
              Partner login
            </Link>
          )}
        </footer>
      </div>
    </div>,
    document.body
  );
}
