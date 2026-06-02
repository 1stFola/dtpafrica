import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@dtp/ui";
import { apiGet, isAbortError, type PublicPlayerProfile } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { BenchmarkPlaystyleComparison } from "../components/PlaystyleComparisonModal";

type ProfileTab =
  | "attributes"
  | "scoreboard"
  | "scouting"
  | "valuation"
  | "videos"
  | "photos"
  | "media";
type ProfileMediaItem = NonNullable<PublicPlayerProfile["mediaItems"]>[number] & {
  url: string;
};

const SCOREBOARD_EVENT_LABELS: Record<string, string> = {
  goal: "Goal",
  own_goal: "Own goal",
  yellow_card: "Yellow card",
  red_card: "Red card",
  substitution: "Substitution",
  injury: "Injury",
};

const ATTRIBUTE_GROUPS = [
  {
    title: "Athletic",
    keys: ["pace", "acceleration", "sprint_speed", "stamina", "strength", "agility"],
  },
  {
    title: "Technical",
    keys: ["dribbling", "ball_control", "passing", "finishing", "technique", "first_touch"],
  },
  {
    title: "Mental",
    keys: ["vision", "composure", "decision_making"],
  },
  {
    title: "Team impact",
    keys: ["work_rate", "positioning", "team_play"],
  },
] as const;

const ATTRIBUTE_LABELS: Record<string, string> = {
  pace: "Pace",
  acceleration: "Acceleration",
  sprint_speed: "Sprint speed",
  stamina: "Stamina",
  strength: "Strength",
  agility: "Agility",
  dribbling: "Dribbling",
  ball_control: "Ball control",
  passing: "Passing",
  finishing: "Finishing",
  technique: "Technique",
  first_touch: "First touch",
  vision: "Vision",
  composure: "Composure",
  decision_making: "Decision making",
  work_rate: "Work rate",
  positioning: "Positioning",
  team_play: "Team play",
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildAttributeFallback(player: PublicPlayerProfile) {
  const overall = player.overallRating ?? 62;
  const offensive = player.offensiveRating ?? overall;
  const defensive = player.defensiveRating ?? overall;
  const tactical = player.tacticalSummary;

  return {
    pace: overall,
    acceleration: overall,
    sprint_speed: overall,
    stamina: defensive,
    strength: defensive,
    agility: offensive,
    dribbling: offensive,
    ball_control: offensive,
    passing: tactical ? tactical.tikiTakaScore : offensive,
    finishing: offensive,
    technique: offensive,
    first_touch: offensive,
    vision: tactical ? tactical.totalFootballScore : overall,
    composure: overall,
    decision_making: overall,
    work_rate: defensive,
    positioning: defensive,
    team_play: tactical ? tactical.counterAttackScore : overall,
  };
}

function buildAttributeMap(player: PublicPlayerProfile) {
  return {
    ...buildAttributeFallback(player),
    ...(player.ratingAttributes ?? {}),
  };
}

function ratingTier(rating?: number | null) {
  if (rating == null) return "Emerging";
  if (rating >= 85) return "Elite";
  if (rating >= 75) return "Pro-ready";
  if (rating >= 65) return "Developing";
  return "Emerging";
}

function starText(rating?: number | null) {
  const stars = rating == null ? 0 : Math.max(0, Math.min(5, Math.round(rating / 20)));
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : "Date pending";
}

function formatCurrencyRange(min?: number | null, max?: number | null) {
  if (min == null && max == null) return "Undisclosed";
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  if (min != null && max != null) return `${formatter.format(min)} - ${formatter.format(max)}`;
  return formatter.format(min ?? max ?? 0);
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(String).filter(Boolean);
  }
  return [];
}

function buildMediaItems(player: PublicPlayerProfile): ProfileMediaItem[] {
  const items: ProfileMediaItem[] = [];

  for (const item of player.mediaItems ?? []) {
    if (item.url) items.push({ ...item, url: item.url });
  }

  if (player.videoUrl && !items.some((item) => item.url === player.videoUrl)) {
    items.push({ type: "video", title: "Highlight video", url: player.videoUrl });
  }

  if (player.playerPhotoUrl && !items.some((item) => item.url === player.playerPhotoUrl)) {
    items.push({ type: "photo", title: "Profile photo", url: player.playerPhotoUrl });
  }

  return items;
}

export function PlayerProfilePage() {
  const { slugOrId } = useParams<{ slugOrId: string }>();
  const [player, setPlayer] = useState<PublicPlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("attributes");
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  usePageTitle(player?.displayName);

  useEffect(() => {
    if (!slugOrId) return;
    const controller = new AbortController();
    let cancelled = false;
    setPlayer(null);
    setError(null);
    apiGet<PublicPlayerProfile>(`/home/players/${slugOrId}`, controller.signal)
      .then((data) => {
        if (!cancelled) setPlayer(data);
      })
      .catch((e) => {
        if (!cancelled && !isAbortError(e)) setError(String(e));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slugOrId]);

  if (error) {
    return (
      <div className="home-page">
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
        <Link to="/featured-players" className="back-link">
          ← Back to featured players
        </Link>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="home-page profile-page" aria-busy="true">
        <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "10rem" }} />
        <div className="profile-hero" style={{ marginTop: "1.5rem" }}>
          <span className="dtp-skeleton" style={{ width: 96, height: 96, borderRadius: "50%" }} />
          <div className="profile-hero__body" style={{ width: "100%" }}>
            <span className="dtp-skeleton" style={{ height: "2rem", width: "60%", marginBottom: "0.75rem" }} />
            <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "40%" }} />
            <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "30%" }} />
          </div>
        </div>
        <div className="dtp-skeleton dtp-skeleton--card" style={{ marginTop: "2rem" }} />
      </div>
    );
  }

  const tactical = player.tacticalSummary;
  const attributes = buildAttributeMap(player);
  const mediaItems = buildMediaItems(player);
  const videoItems = mediaItems.filter((item) => item.type === "video");
  const photoItems = mediaItems.filter((item) => item.type === "photo");
  const otherMediaItems = mediaItems.filter(
    (item) => item.type !== "video" && item.type !== "photo"
  );
  const benchmark = player.benchmarkMetadata?.nearest ?? null;
  const scoreboard = player.scoreboardHistory;
  const scouting = player.scoutingIntelligence;
  const valuation = player.valuation;
  const quickFacts = [
    { label: "Overall", value: player.overallRating ?? "Pending" },
    { label: "Attack", value: player.offensiveRating ?? "Pending" },
    { label: "Defense", value: player.defensiveRating ?? "Pending" },
    {
      label: "Tactical fit",
      value: scouting?.tacticalFit
        ? `${scouting.tacticalFit.score} · ${scouting.tacticalFit.label}`
        : "Pending",
    },
    {
      label: "Philosophy match",
      value: scouting?.philosophyMatch
        ? `${scouting.philosophyMatch.score}% · ${scouting.philosophyMatch.philosophy}`
        : "Pending",
    },
    {
      label: "Position fit",
      value: player.positionFit
        ? `${Math.round(player.positionFit.confidence)}%`
        : "Pending",
    },
    { label: "ScoreBoard apps", value: scoreboard?.aggregates.appearances ?? 0 },
    {
      label: "MVCE value",
      value: valuation?.marketValueLabel ?? "Pending",
    },
  ];
  const highlights = [
    `${ratingTier(player.overallRating)} ${player.positionPrimary} profile`,
    player.ageGroup ? `${player.ageGroup} pathway candidate` : "Open age-band profile",
    tactical ? "Tactical scores available" : "Awaiting tactical recalculation",
    scoreboard?.aggregates.goals
      ? `${scoreboard.aggregates.goals} ScoreBoard goal${scoreboard.aggregates.goals === 1 ? "" : "s"}`
      : "ScoreBoard history pending",
  ];

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: "attributes", label: "Attributes" },
    {
      id: "scoreboard",
      label: `ScoreBoard (${scoreboard?.aggregates.appearances ?? 0})`,
    },
    { id: "scouting", label: "Scouting" },
    { id: "valuation", label: "Valuation" },
    { id: "videos", label: `Videos (${videoItems.length})` },
    { id: "photos", label: `Photos (${photoItems.length})` },
    { id: "media", label: `Media (${otherMediaItems.length})` },
  ];

  const copyShareLink = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("Profile link copied.");
    } catch {
      setShareStatus(url);
    }
  };

  return (
    <div className="home-page profile-page">
      <Link to="/featured-players" className="back-link">
        ← Featured players
      </Link>
      <div className="profile-notice" role="status">
        Verified public DirectToPro profile. Ratings combine match data, calibration, and scout
        review where available.
      </div>
      <div className="profile-hero">
        <div className="profile-avatar">
          {player.playerPhotoUrl ? (
            <img src={player.playerPhotoUrl} alt="" />
          ) : (
            <span>{player.displayName.charAt(0)}</span>
          )}
        </div>
        <div className="profile-hero__body">
          <h1>{player.displayName}</h1>
          <p className="profile-meta">
            {player.positionPrimary}
            {player.positionSecondary ? ` / ${player.positionSecondary}` : ""}
            {player.nationality ? ` · ${player.nationality}` : ""}
            {player.ageGroup ? ` · ${player.ageGroup}` : ""}
            {player.age ? ` · Age ${player.age}` : ""}
            {player.city ? ` · ${player.city}` : ""}
          </p>
          <div className="profile-stars" aria-label={`${player.overallRating ?? 0} rating`}>
            <span>{starText(player.overallRating)}</span>
            <strong>{ratingTier(player.overallRating)}</strong>
          </div>
          {player.overallRating != null && (
            <div className="rating-pills">
              <span className="rating-pill">Overall {player.overallRating}</span>
              {player.offensiveRating != null && (
                <span className="rating-pill">OFF {player.offensiveRating}</span>
              )}
              {player.defensiveRating != null && (
                <span className="rating-pill">DEF {player.defensiveRating}</span>
              )}
            </div>
          )}
          <div className="profile-actions">
            <Button type="button" variant="secondary" onClick={copyShareLink}>
              Share profile
            </Button>
            <Button as={Link} to="/scouting" variant="secondary">
              Open scouting tools
            </Button>
          </div>
          {shareStatus && <p className="profile-share-status">{shareStatus}</p>}
        </div>
      </div>

      {player.biography && <p className="profile-bio">{player.biography}</p>}

      <section className="profile-section profile-summary-card">
        <div>
          <span className="profile-section__eyebrow">Scouting summary</span>
          <h2>Current read</h2>
          <p>{player.scoutingSummary}</p>
        </div>
        <div className="profile-facts">
          {quickFacts.map((fact) => (
            <div key={fact.label}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <nav className="profile-tabs" aria-label="Player profile sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === activeTab ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "attributes" && (
        <section className="profile-section">
          <div className="profile-section-heading">
            <div>
              <span className="profile-section__eyebrow">Rating attributes</span>
              <h2>18-point profile</h2>
            </div>
            <span className="profile-data-note">
              {player.ratingAttributes ? "Calibrated" : "Derived fallback"}
            </span>
          </div>

          <div className="profile-attribute-grid">
            {ATTRIBUTE_GROUPS.map((group) => (
              <article key={group.title} className="profile-attribute-card">
                <h3>{group.title}</h3>
                {group.keys.map((key) => {
                  const score = clampScore(attributes[key]);
                  return (
                    <div key={key} className="profile-attribute">
                      <div className="profile-attribute__head">
                        <span>{ATTRIBUTE_LABELS[key]}</span>
                        <strong>{score}</strong>
                      </div>
                      <div className="profile-progress" aria-hidden>
                        <span style={{ width: `${score}%` }} />
                      </div>
                    </div>
                  );
                })}
              </article>
            ))}
          </div>

          <div className="profile-detail-grid">
            <article className="profile-panel">
              <h3>Profile highlights</h3>
              <ul className="profile-list">
                {highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="profile-panel">
              <h3>Performance metrics</h3>
              <div className="profile-metric-list">
                <span>Dominant foot</span>
                <strong>{player.dominantFoot ?? "Pending"}</strong>
                <span>Primary role</span>
                <strong>{player.positionFit?.primaryPositionFit ?? player.positionPrimary}</strong>
                <span>Secondary role</span>
                <strong>{player.positionFit?.secondaryPositionFit ?? "Pending"}</strong>
              </div>
            </article>
          </div>

          <BenchmarkPlaystyleComparison
            playerName={player.displayName}
            playerAge={player.age}
            playerRating={player.overallRating}
            benchmark={benchmark}
            attributes={attributes}
          />
        </section>
      )}

      {activeTab === "attributes" && tactical && (
        <section className="profile-section">
          <h2>Tactical snapshot</h2>
          <div className="tactical-grid">
            <div>
              <span className="label">Gegenpress</span>
              <strong>{Math.round(tactical.gegenpressScore)}</strong>
            </div>
            <div>
              <span className="label">Tiki-taka</span>
              <strong>{Math.round(tactical.tikiTakaScore)}</strong>
            </div>
            <div>
              <span className="label">Counter</span>
              <strong>{Math.round(tactical.counterAttackScore)}</strong>
            </div>
            <div>
              <span className="label">Winger</span>
              <strong>{Math.round(tactical.wingerScore)}</strong>
            </div>
          </div>
        </section>
      )}

      {activeTab === "attributes" && player.positionFit && (
        <section className="profile-section">
          <h2>Position fit</h2>
          <p>
            Primary {player.positionFit.primaryPositionFit}
            {player.positionFit.secondaryPositionFit
              ? ` · Secondary ${player.positionFit.secondaryPositionFit}`
              : ""}
          </p>
        </section>
      )}

      {activeTab === "scoreboard" && (
        <ScoreboardHistorySection history={scoreboard} />
      )}

      {activeTab === "scouting" && (
        <ScoutingIntelligenceSection scouting={scouting} />
      )}

      {activeTab === "valuation" && (
        <ValuationSection valuation={valuation} playerId={player.id} />
      )}

      {activeTab === "videos" && (
        <MediaSection
          title="Videos"
          empty="No public video has been attached to this profile yet."
          items={videoItems}
        />
      )}

      {activeTab === "photos" && (
        <MediaSection
          title="Photos"
          empty="No public photo gallery has been attached to this profile yet."
          items={photoItems}
          gallery
        />
      )}

      {activeTab === "media" && (
        <MediaSection
          title="Media"
          empty="Articles, interviews, and third-party media will appear here when published."
          items={otherMediaItems}
        />
      )}
    </div>
  );
}

function ScoreboardHistorySection({
  history,
}: {
  history: PublicPlayerProfile["scoreboardHistory"];
}) {
  if (!history || (history.teams.length === 0 && history.appearances.length === 0)) {
    return (
      <section className="profile-section">
        <h2>ScoreBoard history</h2>
        <div className="profile-empty-state">
          <strong>No linked ScoreBoard history yet.</strong>
          <p>Squad rows, match appearances, and events appear here once a team links this profile.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="profile-section">
      <div className="profile-section-heading">
        <div>
          <span className="profile-section__eyebrow">ScoreBoard history</span>
          <h2>Teams, appearances, and events</h2>
        </div>
        <span className="profile-data-note">
          {history.aggregates.events} event{history.aggregates.events === 1 ? "" : "s"}
        </span>
      </div>

      <div className="profile-facts profile-facts--wide">
        <div>
          <span>Teams</span>
          <strong>{history.aggregates.teams}</strong>
        </div>
        <div>
          <span>Competitions</span>
          <strong>{history.aggregates.competitions}</strong>
        </div>
        <div>
          <span>Appearances</span>
          <strong>{history.aggregates.appearances}</strong>
        </div>
        <div>
          <span>Goals</span>
          <strong>{history.aggregates.goals}</strong>
        </div>
      </div>

      <div className="profile-integration-grid">
        <article className="profile-panel">
          <h3>Team links</h3>
          {history.teams.length === 0 ? (
            <p className="muted">No squad rows are linked yet.</p>
          ) : (
            <ul className="profile-card-list">
              {history.teams.map((team) => (
                <li key={`${team.competition.id}-${team.teamId}`}>
                  <strong>{team.teamName}</strong>
                  <span>
                    {team.competition.name} {team.competition.season}
                    {team.shirtNumber ? ` · #${team.shirtNumber}` : ""}
                    {team.position ? ` · ${team.position}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="profile-panel">
          <h3>Recent appearances</h3>
          {history.appearances.length === 0 ? (
            <p className="muted">No event-backed appearances are linked yet.</p>
          ) : (
            <ul className="profile-card-list">
              {history.appearances.slice(0, 6).map((match) => (
                <li key={match.matchId}>
                  <Link to={`/scoreboard/match/${match.matchId}`} className="text-link">
                    {match.homeTeam.shortName ?? match.homeTeam.name} {match.score.home} -{" "}
                    {match.score.away} {match.awayTeam.shortName ?? match.awayTeam.name}
                  </Link>
                  <span>
                    {match.competitionName} · {formatDate(match.kickoffAt)}
                    {match.goals ? ` · ${match.goals} goal${match.goals === 1 ? "" : "s"}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <article className="profile-panel profile-benchmark">
        <h3>Event timeline</h3>
        {history.events.length === 0 ? (
          <p className="muted">No player events are linked yet.</p>
        ) : (
          <ul className="profile-event-list">
            {history.events.slice(0, 10).map((event) => (
              <li key={event.id}>
                <span>{event.minute}&apos;</span>
                <strong>{SCOREBOARD_EVENT_LABELS[event.type] ?? event.type}</strong>
                <em>
                  {event.match.homeTeam} vs {event.match.awayTeam} ·{" "}
                  {event.match.competitionName}
                </em>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

function ScoutingIntelligenceSection({
  scouting,
}: {
  scouting: PublicPlayerProfile["scoutingIntelligence"];
}) {
  const hasSnapshot =
    scouting &&
    (scouting.tacticalFit ||
      scouting.philosophyMatch ||
      scouting.topTacticalScores.length > 0 ||
      scouting.positionFit ||
      scouting.philosophyFits.length > 0 ||
      scouting.aggregateMetrics);

  if (!hasSnapshot) {
    return (
      <section className="profile-section">
        <h2>Scouting Intelligence</h2>
        <div className="profile-empty-state">
          <strong>No SIP scouting snapshot yet.</strong>
          <p>
            Match metrics, calibration imports, or ScoreBoard ingest are required before tactical
            fit and philosophy matching can be computed.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="profile-section">
      <div className="profile-section-heading">
        <div>
          <span className="profile-section__eyebrow">Scouting Intelligence</span>
          <h2>Tactical and fit snapshot</h2>
        </div>
        {scouting.aggregateMetrics && (
          <span className="profile-data-note">
            {scouting.aggregateMetrics.matchesPlayed} SIP match
            {scouting.aggregateMetrics.matchesPlayed === 1 ? "" : "es"}
          </span>
        )}
      </div>

      <div className="profile-facts profile-facts--wide">
        <div>
          <span>Tactical fit</span>
          <strong>
            {scouting.tacticalFit
              ? `${scouting.tacticalFit.score} · ${scouting.tacticalFit.label}`
              : "Pending"}
          </strong>
        </div>
        <div>
          <span>Philosophy matching</span>
          <strong>
            {scouting.philosophyMatch
              ? `${scouting.philosophyMatch.score}% · ${scouting.philosophyMatch.philosophy}`
              : "Pending"}
          </strong>
        </div>
      </div>

      {scouting.topTacticalScores.length > 0 && (
        <div className="tactical-grid">
          {scouting.topTacticalScores.map((score) => (
            <div key={score.label}>
              <span className="label">{score.label}</span>
              <strong>{Math.round(score.value)}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="profile-detail-grid">
        <article className="profile-panel">
          <h3>Position intelligence</h3>
          <div className="profile-metric-list">
            <span>Primary fit</span>
            <strong>{scouting.positionFit?.primaryPositionFit ?? "Pending"}</strong>
            <span>Secondary fit</span>
            <strong>{scouting.positionFit?.secondaryPositionFit ?? "Pending"}</strong>
            <span>Confidence</span>
            <strong>
              {scouting.positionFit ? `${Math.round(scouting.positionFit.confidence)}%` : "Pending"}
            </strong>
          </div>
        </article>

        <article className="profile-panel">
          <h3>Philosophy fits</h3>
          {scouting.philosophyFits.length === 0 ? (
            <p className="muted">No saved philosophy-fit rows yet.</p>
          ) : (
            <ul className="profile-card-list">
              {scouting.philosophyFits.map((fit) => (
                <li key={`${fit.formation}-${fit.philosophy}-${fit.positionSlot ?? "any"}`}>
                  <strong>{fit.philosophy}</strong>
                  <span>
                    {fit.formation}
                    {fit.positionSlot ? ` · ${fit.positionSlot}` : ""} ·{" "}
                    {Math.round(fit.philosophyFitScore)} fit
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}

function ValuationSection({
  valuation,
  playerId,
}: {
  valuation: PublicPlayerProfile["valuation"];
  playerId: string;
}) {
  if (!valuation) {
    return (
      <section className="profile-section">
        <h2>MVCE valuation</h2>
        <div className="profile-empty-state">
          <strong>No MVCE valuation has been generated yet.</strong>
          <p>Generate a valuation to show projected market range and scout notes here.</p>
          <Link to={`/valuation/player/${playerId}`} className="text-link">
            Open valuation workspace
          </Link>
        </div>
      </section>
    );
  }

  const strengths = stringList(valuation.strengths);
  const weaknesses = stringList(valuation.weaknesses);

  return (
    <section className="profile-section">
      <div className="profile-section-heading">
        <div>
          <span className="profile-section__eyebrow">MVCE valuation</span>
          <h2>Market value and confidence</h2>
        </div>
        <Link to={`/valuation/player/${playerId}`} className="text-link">
          Open report
        </Link>
      </div>

      <div className="profile-summary-card">
        <div>
          <h2>{valuation.marketValueLabel}</h2>
          <p>{valuation.scoutNotes}</p>
          <p className="muted">Generated {formatDate(valuation.createdAt)}</p>
        </div>
        <div className="profile-facts">
          <div>
            <span>Adjusted score</span>
            <strong>{Math.round(valuation.adjustedScore)}</strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>{valuation.confidenceLabel}</strong>
          </div>
          <div>
            <span>Market range</span>
            <strong>
              {formatCurrencyRange(
                valuation.marketValueMinEur,
                valuation.marketValueMaxEur
              )}
            </strong>
          </div>
          <div>
            <span>Base score</span>
            <strong>{Math.round(valuation.baseScore)}</strong>
          </div>
        </div>
      </div>

      <div className="profile-detail-grid">
        <article className="profile-panel">
          <h3>Strengths</h3>
          {strengths.length === 0 ? (
            <p className="muted">No strengths saved with this valuation.</p>
          ) : (
            <ul className="profile-list">
              {strengths.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </article>
        <article className="profile-panel">
          <h3>Development flags</h3>
          {weaknesses.length === 0 ? (
            <p className="muted">No weaknesses saved with this valuation.</p>
          ) : (
            <ul className="profile-list">
              {weaknesses.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}

function MediaSection({
  title,
  empty,
  items,
  gallery = false,
}: {
  title: string;
  empty: string;
  items: ProfileMediaItem[];
  gallery?: boolean;
}) {
  return (
    <section className="profile-section">
      <h2>{title}</h2>
      {items.length === 0 ? (
        <div className="profile-empty-state">
          <strong>{empty}</strong>
          <p>Public media can be added through admin profile management or calibration imports.</p>
        </div>
      ) : (
        <div className={gallery ? "profile-media-grid profile-media-grid--photos" : "profile-media-grid"}>
          {items.map((item) => (
            <a
              key={item.url}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="profile-media-card"
            >
              {gallery ? (
                <img src={item.thumbnailUrl ?? item.url} alt={item.title ?? "Player media"} />
              ) : (
                <span className="profile-media-card__icon">Play</span>
              )}
              <strong>{item.title ?? "Profile media"}</strong>
              {item.caption && <span>{item.caption}</span>}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
