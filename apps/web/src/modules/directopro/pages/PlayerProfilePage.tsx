import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@dtp/ui";
import { apiGet, isAbortError, type PlayerSkeletonProfile, type PublicPlayerProfile } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { isGoalkeeper } from "../../../utils/position";
import { resolvePositionFullLabel } from "../../../utils/positionLabels";
import { BenchmarkPlaystyleComparison } from "../components/PlaystyleComparisonModal";
import {
  PlayerCategoryRadar,
  type CategoryScore,
} from "../components/playerProfile/PlayerCategoryRadar";
import { PlayerPitchGraphic } from "../components/playerProfile/PlayerPitchGraphic";
import { PlayerRoleProfileSection } from "../components/playerProfile/PlayerRoleProfileSection";
import { ScoutingDetailsTab } from "../components/playerProfile/ScoutingDetailsTab";
import { PositionScoutingMetricsRow } from "../../scouting/components/PositionScoutingMetricsRow";
import { matchCenterPath } from "../../scoreboard/utils/matchPath";
import { buildPerformanceRadarScores } from "../../scouting/utils/strongXiPlayerModalUtils";

/**
 * Navigation context a linking surface (e.g. Top Scorers, squad rows) can pass
 * via router `state` so a not-yet-seeded player still renders a populated
 * "Premium Skeleton Profile" instead of an error. All fields are optional.
 */
export type PlayerProfileLinkState = {
  displayName?: string;
  club?: string;
  competition?: string;
  /** Normalized role token; only "GK" unlocks the Clean Sheets metric. */
  role?: string;
};

type ProfileTab = "overview" | "scoreboard" | "scouting" | "videos" | "photos" | "publications";
type ProfileMediaItem = NonNullable<PublicPlayerProfile["mediaItems"]>[number] & {
  url: string;
};
type CareerStatBox = { label: string; value: string };

const SCOREBOARD_EVENT_LABELS: Record<string, string> = {
  goal: "Goal",
  own_goal: "Own goal",
  yellow_card: "Yellow card",
  red_card: "Red card",
  substitution: "Substitution",
  injury: "Injury",
};

function scoreboardHistoryEventLabel(
  event: NonNullable<PublicPlayerProfile["scoreboardHistory"]>["events"][number]
): string {
  if (event.type === "goal" && event.role === "assist") return "Assist";
  if (event.role === "secondary") {
    return `${SCOREBOARD_EVENT_LABELS[event.type] ?? event.type} involvement`;
  }
  return SCOREBOARD_EVENT_LABELS[event.type] ?? event.type;
}

/** Turn a route slug/name param into a readable display name ("ahmed-adesanu" → "Ahmed Adesanu"). */
function deslugifyName(value: string): string {
  const cleaned = value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Player";
  return cleaned
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** First letters of the first two words ("Ahmed Adesanu" → "AA"). */
function initialsFromName(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return initials || "?";
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

function isGkProfile(player: Pick<PublicPlayerProfile, "role" | "positionPrimary">): boolean {
  return isGoalkeeper(player.role) || isGoalkeeper(player.positionPrimary);
}

function ratingBadgeTone(rating?: number | null): string {
  if (rating == null) return "player-profile-rating-badge--muted";
  if (rating >= 85) return "player-profile-rating-badge--elite";
  if (rating >= 75) return "player-profile-rating-badge--ready";
  return "player-profile-rating-badge--standard";
}

type BioFact = { label: string; value: string; highlight?: boolean };

function isDuplicateScoutingCopy(
  biography: string | null | undefined,
  scoutingSummary: string | null | undefined
): boolean {
  const bio = biography?.trim();
  const summary = scoutingSummary?.trim();
  if (!bio || !summary) return false;
  return bio === summary;
}

function resolveShirtNumber(player: PublicPlayerProfile): number | null {
  const teams = player.scoreboardHistory?.teams ?? [];
  for (const team of teams) {
    if (team.shirtNumber != null) return team.shirtNumber;
  }
  return null;
}

function readEstimatedPlayerValue(player: PublicPlayerProfile): string | null {
  const meta = player.benchmarkMetadata;
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>).estimatedPlayerValue;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildBioFacts(
  player: PublicPlayerProfile,
  valuation: PublicPlayerProfile["valuation"]
): BioFact[] {
  const facts: BioFact[] = [];
  if (player.club) facts.push({ label: "Club", value: player.club });
  if (player.nationality) facts.push({ label: "Nationality", value: player.nationality });
  if (player.age != null) {
    facts.push({ label: "Age", value: String(player.age) });
  } else if (player.ageGroup) {
    facts.push({ label: "Squad", value: player.ageGroup });
  }
  if (player.heightCm != null && player.heightCm >= 100 && player.heightCm <= 230) {
    facts.push({ label: "Height", value: `${player.heightCm} cm` });
  }
  if (player.dominantFoot) facts.push({ label: "Preferred foot", value: player.dominantFoot });
  facts.push({ label: "Position", value: player.positionPrimary });
  const shirt = resolveShirtNumber(player);
  if (shirt != null) facts.push({ label: "Shirt number", value: String(shirt) });
  const estimatedValue = readEstimatedPlayerValue(player);
  if (valuation?.marketValueLabel) {
    facts.push({
      label: "Player value",
      value: valuation.marketValueLabel,
      highlight: true,
    });
  } else if (
    valuation &&
    (valuation.marketValueMinEur != null || valuation.marketValueMaxEur != null)
  ) {
    facts.push({
      label: "Player value",
      value: formatCurrencyRange(
        valuation.marketValueMinEur,
        valuation.marketValueMaxEur
      ),
      highlight: true,
    });
  } else if (estimatedValue) {
    facts.push({
      label: "Player value",
      value: estimatedValue,
      highlight: true,
    });
  }
  return facts;
}

function buildCareerStatBoxes(
  player: PublicPlayerProfile,
  minutesPlayed: number | null,
  isGk: boolean
): CareerStatBox[] {
  const boxes: CareerStatBox[] = [
    { label: "Appearances", value: String(player.stats?.appearances ?? 0) },
    { label: "Goals", value: String(player.stats?.goals ?? 0) },
    { label: "Assists", value: String(player.stats?.assists ?? 0) },
    { label: "Minutes played", value: formatMinutesPlayed(minutesPlayed) },
  ];
  if (isGk) {
    boxes.push({ label: "Clean sheets", value: String(player.stats?.cleanSheets ?? 0) });
  }
  return boxes;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : "Date pending";
}

function resolveProfileMinutes(player: PublicPlayerProfile): number | null {
  const top = player.minutesPlayed;
  if (top != null && top > 0) return top;
  const career = player.stats?.minutes;
  if (career != null && career > 0) return career;
  const rolling = player.scoutingIntelligence?.aggregateMetrics?.minutesPlayed;
  if (rolling != null && rolling > 0) return Math.round(rolling);
  return null;
}

function formatMinutesPlayed(value: number | null | undefined): string {
  if (value == null || value <= 0) return "—";
  return value.toLocaleString();
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [player, setPlayer] = useState<PublicPlayerProfile | null>(null);
  const [skeleton, setSkeleton] = useState<PlayerSkeletonProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  // Known context from the click/URL (router state preferred, query params as fallback).
  const linkState = (location.state ?? null) as PlayerProfileLinkState | null;
  const knownName =
    linkState?.displayName?.trim() ||
    searchParams.get("name")?.trim() ||
    (slugOrId ? deslugifyName(slugOrId) : "Player");
  const knownClub =
    linkState?.club?.trim() || searchParams.get("club")?.trim() || null;
  const knownCompetition =
    linkState?.competition?.trim() || searchParams.get("competition")?.trim() || null;
  const knownRole =
    (linkState?.role ?? searchParams.get("role"))?.trim().toUpperCase() || null;

  usePageTitle(player?.displayName ?? skeleton?.displayName ?? knownName);

  useEffect(() => {
    if (!slugOrId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setPlayer(null);
    setSkeleton(null);
    setError(null);
    setLoading(true);
    const qs = new URLSearchParams();
    if (knownClub) qs.set("club", knownClub);
    if (knownCompetition) qs.set("competition", knownCompetition);
    if (knownRole) qs.set("role", knownRole);
    const query = qs.toString();
    apiGet<PublicPlayerProfile | PlayerSkeletonProfile>(
      `/home/players/${slugOrId}${query ? `?${query}` : ""}`,
      controller.signal
    )
      .then((data) => {
        if (cancelled) return;
        if (data.isSkeleton) {
          setSkeleton(data);
        } else {
          setPlayer(data);
        }
      })
      .catch((e) => {
        if (cancelled || isAbortError(e)) return;
        setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slugOrId, knownClub, knownCompetition, knownRole]);

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

  if (skeleton) {
    return (
      <PremiumSkeletonProfile
        name={skeleton.displayName}
        club={skeleton.club ?? knownClub}
        competition={skeleton.competition ?? knownCompetition}
        role={skeleton.role ?? knownRole}
        stats={skeleton.stats}
      />
    );
  }

  if (!player && !skeleton && loading) {
    return (
      <div className="home-page profile-page player-profile" aria-busy="true">
        <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "10rem" }} />
        <div className="player-profile-banner player-profile-banner--loading" style={{ marginTop: "1.5rem" }}>
          <span className="dtp-skeleton" style={{ width: "100%", height: 220, borderRadius: "var(--radius-lg)" }} />
        </div>
        <div className="dtp-skeleton dtp-skeleton--card" style={{ marginTop: "2rem" }} />
      </div>
    );
  }

  if (!player) {
    return (
      <div className="home-page">
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">Player profile unavailable</p>
          <p>We could not load this profile. Try again or browse featured players.</p>
          <Link to="/featured-players" className="text-link">
            Featured players
          </Link>
        </div>
      </div>
    );
  }

  const tactical = player.tacticalSummary;
  const attributes = buildAttributeMap(player);
  const mediaItems = buildMediaItems(player);
  const videoItems = mediaItems.filter((item) => item.type === "video");
  const photoItems = mediaItems.filter((item) => item.type === "photo");
  const publicationItems = mediaItems.filter(
    (item) =>
      item.type === "article" ||
      item.type === "publication" ||
      (item.type !== "video" && item.type !== "photo")
  );
  const benchmark = player.benchmarkMetadata?.nearest ?? null;
  const scoreboard = player.scoreboardHistory;
  const minutesPlayed = resolveProfileMinutes(player);
  const isGk = isGkProfile(player);
  const careerStatBoxes = buildCareerStatBoxes(player, minutesPlayed, isGk);
  const positionLabel = resolvePositionFullLabel(player.positionPrimary.trim(), null);
  const highlights = [
    `${ratingTier(player.overallRating)} ${player.positionPrimary} profile`,
    player.ageGroup ? `${player.ageGroup} pathway candidate` : "Open age-band profile",
    tactical ? "Tactical scores available" : "Awaiting tactical recalculation",
    scoreboard?.aggregates.goals
      ? `${scoreboard.aggregates.goals} ScoreBoard goal${scoreboard.aggregates.goals === 1 ? "" : "s"}`
      : scoreboard?.aggregates.assists
        ? `${scoreboard.aggregates.assists} ScoreBoard assist${scoreboard.aggregates.assists === 1 ? "" : "s"}`
      : "ScoreBoard history pending",
  ];

  const categoryScores = buildPerformanceRadarScores(player);
  const bioFacts = buildBioFacts(player, player.valuation);

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "scouting", label: "Scouting Details" },
    { id: "scoreboard", label: "ScoreBoard Metrics" },
    {
      id: "videos",
      label: videoItems.length > 0 ? `Videos (${videoItems.length})` : "Videos",
    },
    {
      id: "photos",
      label: photoItems.length > 0 ? `Photos (${photoItems.length})` : "Photos",
    },
    {
      id: "publications",
      label:
        publicationItems.length > 0
          ? `Publications (${publicationItems.length})`
          : "Publications",
    },
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
    <div className="home-page profile-page player-profile">
      <Link to="/featured-players" className="back-link">
        ← Featured players
      </Link>

      <PlayerCardBanner
        player={player}
        positionLabel={positionLabel}
        tierLabel={ratingTier(player.overallRating)}
        bioFacts={bioFacts}
        categoryScores={categoryScores}
        onShare={copyShareLink}
        shareStatus={shareStatus}
      />

      {player.biography &&
        !isDuplicateScoutingCopy(player.biography, player.scoutingSummary) && (
          <p className="player-profile-bio">{player.biography}</p>
        )}

      <section className="player-profile-scout-strip" aria-label="Scouting summary">
        <div className="player-profile-scout-strip__summary">
          <h2 className="player-profile-heading">Scouting summary</h2>
          <p className="player-profile-scout-strip__text">
            {player.scoutingSummary ?? "Scouting summary pending calibration review."}
          </p>
        </div>
        <PositionScoutingMetricsRow player={player} variant="strip" />
      </section>

      <nav className="player-profile-tabs" aria-label="Player profile sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === activeTab ? "player-profile-tabs__btn active" : "player-profile-tabs__btn"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <>
          <section className="profile-section">
            <PlayerRoleProfileSection
              attributes={attributes}
              positionPrimary={player.positionPrimary}
              role={player.role}
              secondaryRole={
                player.positionSecondary ??
                player.positionFit?.secondaryPositionFit ??
                player.scoutingIntelligence?.positionFit?.secondaryPositionFit ??
                null
              }
              dataSourceLabel={
                player.ratingAttributes ? "From match data" : "Estimated from profile"
              }
            />

            <div className="profile-detail-grid">
              <article className="profile-panel player-profile-panel">
                <h3 className="player-profile-subheading">Profile highlights</h3>
                <ul className="profile-list">
                  {highlights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
              <article className="profile-panel player-profile-panel">
                <h3 className="player-profile-subheading">Performance metrics</h3>
                <div className="profile-metric-list">
                  <span>Minutes played</span>
                  <strong>{formatMinutesPlayed(minutesPlayed)}</strong>
                  {player.positionFit?.secondaryPositionFit && (
                    <>
                      <span>Secondary role</span>
                      <strong>{player.positionFit.secondaryPositionFit}</strong>
                    </>
                  )}
                  {isGk && (
                    <>
                      <span>Clean sheets</span>
                      <strong>{player.stats?.cleanSheets ?? 0}</strong>
                    </>
                  )}
                </div>
              </article>
            </div>

            <BenchmarkPlaystyleComparison
              playerName={player.displayName}
              playerPhotoUrl={player.playerPhotoUrl}
              benchmark={benchmark}
              attributes={attributes}
            />
          </section>
        </>
      )}

      {activeTab === "scoreboard" && (
        <>
          <CareerStatBoxesSection stats={careerStatBoxes} />
          <ScoreboardHistorySection history={scoreboard} />
        </>
      )}

      {activeTab === "scouting" && <ScoutingDetailsTab player={player} />}

      {activeTab === "videos" && (
        <TypedMediaTab
          eyebrow="Media"
          title="Videos"
          emptyTitle="No highlight videos yet"
          emptyDetail="Highlight reels and match clips will appear here once they are linked to this profile."
          items={videoItems}
        />
      )}

      {activeTab === "photos" && (
        <TypedMediaTab
          eyebrow="Media"
          title="Photos"
          emptyTitle="No photos yet"
          emptyDetail="Profile and action photos will appear here once they are linked to this profile."
          items={photoItems}
          gallery
        />
      )}

      {activeTab === "publications" && (
        <TypedMediaTab
          eyebrow="Media"
          title="Publications"
          emptyTitle="No publications yet"
          emptyDetail="Press coverage and scouting articles will appear here once they are linked to this profile."
          items={publicationItems}
        />
      )}
    </div>
  );
}

const PENDING_SYNC_CAPTION =
  "Profile Pending Synchronization — Performance data and tournament history for this athlete are currently being verified by the DTP Africa scouting network.";

function PlayerCardBanner({
  player,
  positionLabel,
  tierLabel,
  bioFacts,
  categoryScores,
  onShare,
  shareStatus,
}: {
  player: PublicPlayerProfile;
  positionLabel: string;
  tierLabel: string;
  bioFacts: BioFact[];
  categoryScores: CategoryScore[];
  onShare: () => void;
  shareStatus: string | null;
}) {
  return (
    <header className="player-profile-banner" aria-label={`${player.displayName} profile card`}>
      <div className="player-profile-banner__top">
        <div className="player-profile-banner__hero">
          <div className="player-profile-banner__portrait">
            {player.playerPhotoUrl ? (
              <img
                src={player.playerPhotoUrl}
                alt=""
                className="player-profile-banner__photo"
              />
            ) : (
              <span className="player-profile-banner__fallback" aria-hidden="true">
                {initialsFromName(player.displayName)}
              </span>
            )}
          </div>

          <div className="player-profile-banner__identity">
            <span className="player-profile-eyebrow">DirectToPro verified</span>
            <h1 className="player-profile-banner__name">{player.displayName}</h1>
            <p className="player-profile-banner__role">
              {positionLabel}
              {player.positionSecondary ? ` · ${player.positionSecondary}` : ""}
              {player.competition ? ` · ${player.competition}` : ""}
            </p>
            <p className="player-profile-banner__tier">{tierLabel} tier</p>
          </div>
        </div>

        <aside
          className="player-profile-banner__toolbar"
          aria-label="Ratings and profile actions"
        >
          <div className="player-profile-banner__ratings" aria-label="Core ratings">
            <div
              className={`player-profile-rating-badge player-profile-rating-badge--overall ${ratingBadgeTone(
                player.overallRating
              )}`}
            >
              <span className="player-profile-rating-badge__value">
                {player.overallRating ?? "—"}
              </span>
              <span className="player-profile-rating-badge__label">Overall</span>
            </div>
            <div
              className={`player-profile-rating-badge player-profile-rating-badge--attack ${ratingBadgeTone(
                player.offensiveRating
              )}`}
            >
              <span className="player-profile-rating-badge__value">
                {player.offensiveRating ?? "—"}
              </span>
              <span className="player-profile-rating-badge__label">Attack</span>
            </div>
            <div
              className={`player-profile-rating-badge player-profile-rating-badge--defense ${ratingBadgeTone(
                player.defensiveRating
              )}`}
            >
              <span className="player-profile-rating-badge__value">
                {player.defensiveRating ?? "—"}
              </span>
              <span className="player-profile-rating-badge__label">Defense</span>
            </div>
          </div>
          <div className="player-profile-banner__toolbar-actions">
            <Button type="button" variant="secondary" onClick={onShare}>
              Share profile
            </Button>
            {shareStatus && (
              <p className="profile-share-status player-profile-banner__share-status">
                {shareStatus}
              </p>
            )}
          </div>
        </aside>
      </div>

      <div className="player-profile-banner__insights">
        <PlayerBioGrid facts={bioFacts} />
        <PlayerPitchGraphic
          positionPrimary={player.positionPrimary}
          positionFull={player.positionFull}
          role={player.role}
          positionSecondary={player.positionSecondary}
          positionFitSecondary={player.positionFit?.secondaryPositionFit ?? null}
          scoutingSecondaryPositionFit={
            player.scoutingIntelligence?.positionFit?.secondaryPositionFit ?? null
          }
          positionFitHybrid={player.positionFit?.hybridFit ?? null}
          scoutingHybridFit={player.scoutingIntelligence?.positionFit?.hybridFit ?? null}
          ratingAttributes={player.ratingAttributes}
          tacticalSummary={player.tacticalSummary}
        />
        <div className="player-profile-cat-radar__frame">
          <PlayerCategoryRadar scores={categoryScores} />
        </div>
      </div>
    </header>
  );
}

function PlayerBioGrid({ facts }: { facts: BioFact[] }) {
  if (facts.length === 0) {
    return (
      <div className="player-profile-banner__bio">
        <p className="player-profile-muted">Profile details pending calibration.</p>
      </div>
    );
  }

  return (
    <div className="player-profile-banner__bio" aria-label="Player details">
      <ul className="player-profile-banner__bio-grid">
        {facts.map((fact) => (
          <li
            key={`${fact.label}-${fact.value}`}
            className={
              fact.highlight
                ? "player-profile-banner__bio-cell player-profile-banner__bio-cell--highlight"
                : "player-profile-banner__bio-cell"
            }
          >
            <strong className="player-profile-banner__bio-value">{fact.value}</strong>
            <span className="player-profile-banner__bio-label">{fact.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CareerStatBoxesSection({ stats }: { stats: CareerStatBox[] }) {
  return (
    <section className="profile-section" aria-label="Career totals">
      <div className="profile-section-heading">
        <div>
          <span className="player-profile-eyebrow">ScoreBoard metrics</span>
          <h2 className="player-profile-heading">Career totals</h2>
        </div>
      </div>
      <div className="player-profile-stat-grid">
        {stats.map((stat) => (
          <article key={stat.label} className="player-profile-stat-box">
            <span className="player-profile-stat-box__label">{stat.label}</span>
            <strong className="player-profile-stat-box__value">{stat.value}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function TypedMediaTab({
  eyebrow,
  title,
  emptyTitle,
  emptyDetail,
  items,
  gallery = false,
}: {
  eyebrow: string;
  title: string;
  emptyTitle: string;
  emptyDetail: string;
  items: ProfileMediaItem[];
  gallery?: boolean;
}) {
  return (
    <section className="profile-section player-profile-media">
      <span className="player-profile-eyebrow">{eyebrow}</span>
      <h2 className="player-profile-heading">{title}</h2>
      {items.length === 0 ? (
        <div className="profile-empty-state player-profile-media-empty">
          <strong>{emptyTitle}</strong>
          <p>{emptyDetail}</p>
        </div>
      ) : (
        <MediaSection title="" empty="" items={items} gallery={gallery} embedded />
      )}
    </section>
  );
}

/**
 * High-fidelity fallback for a player routed by name/slug whose full record
 * isn't seeded yet. Renders any known navigation context (name, club,
 * competition, role) and premium animated placeholders for everything else.
 */
function PremiumSkeletonProfile({
  name,
  club,
  competition,
  role,
}: {
  name: string;
  club: string | null;
  competition: string | null;
  role: string | null;
  stats?: { cleanSheets?: number };
}) {
  const isGk = isGoalkeeper(role);
  const metrics: { label: string; hint: string }[] = [
    { label: "Goals", hint: "Match-verified tally" },
    { label: "Assists", hint: "Creative output" },
    { label: "Matches Played", hint: "Tournament appearances" },
    { label: "Minutes Played", hint: "Verified pitch time" },
  ];
  if (isGk) {
    metrics.push({ label: "Clean Sheets", hint: "Shutout record" });
  }

  return (
    <div className="home-page profile-page profile-pending player-profile" aria-busy="true">
      <Link to="/featured-players" className="back-link">
        ← Featured players
      </Link>

      <div className="profile-pending-notice" role="status">
        <span className="profile-pending-notice__dot" aria-hidden="true" />
        <span>
          <strong>Profile pending synchronization.</strong> We&apos;re verifying this
          athlete&apos;s record with the DTP Africa scouting network.
        </span>
      </div>

      <div className="profile-hero">
        <div
          className="profile-avatar profile-avatar--pending"
          aria-hidden="true"
        >
          <span className="profile-avatar__initials">{initialsFromName(name)}</span>
        </div>
        <div className="profile-hero__body">
          <h1>{name}</h1>
          <div className="profile-pending-badges">
            {club && <span className="profile-pending-badge">{club}</span>}
            {competition && (
              <span className="profile-pending-badge profile-pending-badge--soft">
                {competition}
              </span>
            )}
            <span className="profile-pending-badge profile-pending-badge--status">
              Verifying
            </span>
          </div>
          <div className="profile-pending-herolines" aria-hidden="true">
            <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "42%" }} />
            <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "28%" }} />
          </div>
        </div>
      </div>

      <section className="profile-section">
        <div className="profile-section-heading">
          <div>
            <span className="profile-section__eyebrow">Core performance</span>
            <h2>Season metrics</h2>
          </div>
          <span className="profile-data-note">Awaiting sync</span>
        </div>
        <div className="profile-metric-grid">
          {metrics.map((metric) => (
            <article key={metric.label} className="profile-metric-card">
              <span className="profile-metric-card__label">{metric.label}</span>
              <span
                className="dtp-skeleton profile-metric-card__bar"
                aria-label={`${metric.label} pending`}
              />
              <span className="profile-metric-card__hint">{metric.hint}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="profile-section">
        <h2>Tournament history</h2>
        <div className="profile-pending-empty">
          <span className="profile-pending-empty__glow" aria-hidden="true" />
          <p className="profile-pending-empty__caption">{PENDING_SYNC_CAPTION}</p>
        </div>
      </section>
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
        <div>
          <span>Assists</span>
          <strong>{history.aggregates.assists}</strong>
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
                  <Link
                    to={matchCenterPath({ slug: match.matchSlug, id: match.matchId })}
                    className="text-link"
                  >
                    {match.homeTeam.shortName ?? match.homeTeam.name} {match.score.home} -{" "}
                    {match.score.away} {match.awayTeam.shortName ?? match.awayTeam.name}
                  </Link>
                  <span>
                    {match.competitionName} · {formatDate(match.kickoffAt)}
                    {match.goals ? ` · ${match.goals} goal${match.goals === 1 ? "" : "s"}` : ""}
                    {match.assists
                      ? ` · ${match.assists} assist${match.assists === 1 ? "" : "s"}`
                      : ""}
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
                <strong>{scoreboardHistoryEventLabel(event)}</strong>
                <em>
                  {event.playerLabel ? `${event.playerLabel} · ` : ""}
                  {event.match.homeTeam} vs {event.match.awayTeam} ·{" "}
                  {event.match.competitionName}
                  {event.matchedBy === "label" ? " · matched from timeline name" : ""}
                </em>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

function MediaSection({
  title,
  empty,
  items,
  gallery = false,
  embedded = false,
}: {
  title: string;
  empty: string;
  items: ProfileMediaItem[];
  gallery?: boolean;
  embedded?: boolean;
}) {
  const sectionClass = embedded ? "player-profile-media-block" : "profile-section";

  return (
    <div className={sectionClass}>
      {title ? <h3 className="player-profile-subheading">{title}</h3> : null}
      {items.length === 0 ? (
        empty ? (
          <div className="profile-empty-state">
            <strong>{empty}</strong>
            <p>Public media can be added through admin profile management or calibration imports.</p>
          </div>
        ) : null
      ) : (
        <div className={gallery ? "profile-media-grid profile-media-grid--photos" : "profile-media-grid"}>
          {items.map((item) => (
            <a
              key={item.url}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="profile-media-card player-profile-media-card"
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
    </div>
  );
}
