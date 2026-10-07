import { useEffect, useState, type CSSProperties } from "react";
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
import {
  detectVideoMediaType,
  highlightThumbnailUrl,
  videoEmbedUrl,
} from "../../../utils/media-url";
import { matchCenterPath } from "../../scoreboard/utils/matchPath";
import { playerDisplayName } from "../../../lib/player-display-name";
import { showsOnProfileTimeline } from "../../../lib/profile-timeline";
import {
  buildAttributeMap as buildProfileAttributeMap,
  buildPerformanceRadarScores,
} from "../../scouting/utils/strongXiPlayerModalUtils";

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
type ProfilePlayableVideo = {
  item: ProfileMediaItem;
  embedUrl: string;
  mode: "iframe" | "video";
  thumbnailUrl: string | null;
};
type ProfilePhotoPreview = {
  item: ProfileMediaItem;
  imageUrl: string;
};

const SCOREBOARD_EVENT_LABELS: Record<string, string> = {
  goal: "Goal",
  own_goal: "Own goal",
  yellow_card: "Yellow card",
  red_card: "Red card",
  substitution: "Substitution",
  injury: "Injury",
  save: "Save",
  double_save: "Double save",
  penalty_saved: "Penalty saved",
  goalkeeper_claim: "Claim",
  goalkeeper_command: "Command",
  goalkeeper_distribution: "Distribution",
  goalkeeper_error: "Goalkeeper error",
  goalkeeper_intervention: "Intervention",
  goal_line_clearance: "Goal-line clearance",
  clearance: "Clearance",
};

const GOALKEEPER_SCOREBOARD_EVENT_TYPES = new Set([
  "save",
  "double_save",
  "penalty_saved",
  "goalkeeper_claim",
  "goalkeeper_command",
  "goalkeeper_distribution",
  "goalkeeper_intervention",
  "goal_line_clearance",
  "clearance",
]);

const GOALKEEPER_NEGATIVE_EVENT_TYPES = new Set(["goalkeeper_error", "red_card"]);


function humanizeScoreboardEventType(type: string): string {
  return (
    SCOREBOARD_EVENT_LABELS[type] ??
    type
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function scoreboardHistoryEventLabel(
  event: NonNullable<PublicPlayerProfile["scoreboardHistory"]>["events"][number]
): string {
  if (event.type === "goal" && event.role === "assist") return "Assist";
  if (event.role === "secondary") {
    return `${humanizeScoreboardEventType(event.type)} involvement`;
  }
  return humanizeScoreboardEventType(event.type);
}

type ScoreboardAppearanceTeam = NonNullable<
  PublicPlayerProfile["scoreboardHistory"]
>["appearances"][number]["homeTeam"];

function scoreboardTeamName(team: Pick<ScoreboardAppearanceTeam, "name" | "shortName">): string {
  return team.shortName ?? team.name;
}

function ScoreboardTeamLogo({
  team,
  className = "",
}: {
  team: Pick<ScoreboardAppearanceTeam, "name" | "shortName" | "logoUrl">;
  className?: string;
}) {
  const name = scoreboardTeamName(team);
  return (
    <span className={`scoreboard-history-team-logo ${className}`} aria-hidden="true">
      {team.logoUrl ? (
        <img src={team.logoUrl} alt="" loading="lazy" />
      ) : (
        <span>{initialsFromName(name)}</span>
      )}
    </span>
  );
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

/**
 * Figma 239:2425 sets the profile name in title case ("Yusuf Ramadan"), but
 * some records arrive from the registration feed fully capitalised. Only
 * all-caps values are recased, so names that already carry deliberate casing
 * ("McCarthy", "van Dijk", "O'Neill") are left exactly as entered.
 */
function displayNameCased(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}

/**
 * Figma draws the name at 80px. Long names have to give some of that back or
 * they overrun the identity column, so the ceiling steps down with length and
 * bottoms out at 40px — the CSS clamp still handles viewport scaling.
 */
function nameMaxSize(name: string): string {
  const len = displayNameCased(name).length;
  if (len <= 14) return "5rem";
  const rem = Math.max(2.5, 5 - (len - 14) * 0.16);
  return `${Math.round(rem * 100) / 100}rem`;
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

type BioFact = { label: string; value: string; highlight?: boolean };

// Temporarily hide valuation on public profiles; keep its calculation and data intact.
const SHOW_PLAYER_VALUE = false;

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
  const profilePhotoUrl = resolveProfilePhotoUrl(player);

  for (const item of player.mediaItems ?? []) {
    if (item.url) items.push({ ...item, url: item.url });
  }

  if (player.videoUrl && !items.some((item) => item.url === player.videoUrl)) {
    items.push({ type: "video", title: "Highlight video", url: player.videoUrl });
  }

  if (profilePhotoUrl && !items.some((item) => item.url === profilePhotoUrl)) {
    items.push({ type: "photo", title: "Profile photo", url: profilePhotoUrl });
  }

  return items;
}

function resolveProfilePhotoUrl(player: PublicPlayerProfile): string | null {
  const primary = player.playerPhotoUrl?.trim();
  if (primary && !isTemporaryProfileImage(primary)) return primary;
  const mediaPhoto = player.mediaItems?.find(
    (item) =>
      item.type === "photo" &&
      item.url?.trim() &&
      !isTemporaryProfileImage(item.url)
  )?.url;
  return mediaPhoto?.trim() || null;
}

function isDirectVideoUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /\.(mp4|webm|ogg|mov)(?:$|\?)/i.test(pathname);
  } catch {
    return /\.(mp4|webm|ogg|mov)(?:$|\?)/i.test(url);
  }
}

function buildPlayableVideo(item: ProfileMediaItem): ProfilePlayableVideo | null {
  const url = item.url.trim();
  if (!url) return null;
  const mediaType = detectVideoMediaType(url);
  const embedUrl = videoEmbedUrl(url, mediaType);
  if (!embedUrl) return null;
  return {
    item,
    embedUrl,
    mode: mediaType === "external" && isDirectVideoUrl(url) ? "video" : "iframe",
    thumbnailUrl: item.thumbnailUrl?.trim() || highlightThumbnailUrl(url) || null,
  };
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
  const attributes = buildProfileAttributeMap(player);
  const mediaItems = buildMediaItems(player);
  const videoItems = mediaItems.filter((item) => item.type === "video");
  const photoItems = mediaItems.filter((item) => item.type === "photo");
  const profilePhotoUrl = resolveProfilePhotoUrl(player);
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
  const positionLabel = resolvePositionFullLabel(player.positionPrimary.trim(), null);
  const highlights = [
    `${ratingTier(player.overallRating)} ${player.positionPrimary} profile`,
    tactical ? "Tactical scores available" : "Tactical profile building",
    scoreboard?.aggregates.goals
      ? `${scoreboard.aggregates.goals} ScoreBoard goal${scoreboard.aggregates.goals === 1 ? "" : "s"}`
      : scoreboard?.aggregates.assists
        ? `${scoreboard.aggregates.assists} ScoreBoard assist${scoreboard.aggregates.assists === 1 ? "" : "s"}`
      : "ScoreBoard history pending",
  ];

  const categoryScores = buildPerformanceRadarScores(player);
  const bioFacts = buildBioFacts(player, player.valuation).filter(
    (fact) => SHOW_PLAYER_VALUE || fact.label !== "Player value"
  );

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
    <div className="home-page profile-page player-profile dtp-page">
      <Link to="/featured-players" className="dtp-profile-back">
        ← Featured players
      </Link>

      <PlayerCardBanner
        player={player}
        photoUrl={profilePhotoUrl}
        positionLabel={positionLabel}
        tierLabel={ratingTier(player.overallRating)}
        bioFacts={bioFacts}
        categoryScores={categoryScores}
        onShare={copyShareLink}
        shareStatus={shareStatus}
      />

      <div className="player-profile-body-sheet">
        {player.biography &&
          !isDuplicateScoutingCopy(player.biography, player.scoutingSummary) && (
            <p className="player-profile-bio">{player.biography}</p>
          )}

        <section className="player-profile-scout-strip" aria-label="Scouting summary">
          <div className="player-profile-scout-strip__summary">
            <h2 className="player-profile-heading">Scouting Summary</h2>
            <p className="player-profile-scout-strip__text">
              {player.scoutingSummary ?? "Scouting summary will appear as verified match data grows."}
            </p>
          </div>
          <PositionScoutingMetricsRow
            player={player}
            variant="strip"
            className="player-profile-scout-strip__metrics"
          />
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

              <section className="player-profile-proof-block" aria-label="Profile proof points">
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
                      <span>Appearances</span>
                      <strong>{player.stats?.appearances ?? scoreboard?.aggregates.appearances ?? 0}</strong>
                      {isGk ? (
                        <>
                          <span>Clean sheets</span>
                          <strong>{player.stats?.cleanSheets ?? 0}</strong>
                        </>
                      ) : (
                        <>
                          <span>Goal contributions</span>
                          <strong>
                            {(player.stats?.goals ?? scoreboard?.aggregates.goals ?? 0) +
                              (player.stats?.assists ?? scoreboard?.aggregates.assists ?? 0)}
                          </strong>
                        </>
                      )}
                    </div>
                  </article>
                </div>

                <BenchmarkPlaystyleComparison
                  playerName={player.displayName}
                  playerPhotoUrl={profilePhotoUrl}
                  benchmark={benchmark}
                  attributes={attributes}
                />
              </section>
            </section>
          </>
        )}

        {activeTab === "scoreboard" && (
          <>
            {isGk && <GoalkeeperScoreboardProfileSection history={scoreboard} />}
            <ScoreboardHistorySection history={scoreboard} minutesPlayed={minutesPlayed} />
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
    </div>
  );
}

const PENDING_SYNC_CAPTION =
  "Profile Pending Synchronization — Performance data and tournament history for this athlete are currently being verified by the DTP Africa scouting network.";

function isTemporaryProfileImage(value: string | null | undefined): boolean {
  if (!value) return true;
  return /thumbnail|temporar|placeholder|unavailable/i.test(value);
}

function resolveProfileHeroPhotoUrl(photoUrl: string | null): string | null {
  if (isTemporaryProfileImage(photoUrl)) return null;
  return photoUrl;
}

const SNAPSHOT_FACT_ORDER = [
  "nationality",
  "category",
  "preferred foot",
  "position",
  "player value",
];

function buildSnapshotBioFacts(facts: BioFact[]): BioFact[] {
  return SNAPSHOT_FACT_ORDER.flatMap((label) => {
    const match = facts.find((fact) => fact.label.toLowerCase() === label);
    return match ? [match] : [];
  });
}

function PlayerCardBanner({
  player,
  photoUrl,
  positionLabel,
  tierLabel,
  bioFacts,
  categoryScores,
  onShare,
  shareStatus,
}: {
  player: PublicPlayerProfile;
  photoUrl: string | null;
  positionLabel: string;
  tierLabel: string;
  bioFacts: BioFact[];
  categoryScores: CategoryScore[];
  onShare: () => void;
  shareStatus: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const heroPhotoUrl = imageFailed ? null : resolveProfileHeroPhotoUrl(photoUrl);
  const snapshotBioFacts = buildSnapshotBioFacts(bioFacts);

  return (
    <header className="player-profile-banner" aria-label={`${player.displayName} profile card`}>
      {/* Figma "DTP" -> Featured Players Profile 239:2425 */}
      <div className="dtp-profile-card">
        <div className="dtp-profile-card__portrait">
          {heroPhotoUrl ? (
            <img
              src={heroPhotoUrl}
              alt=""
              onError={(event) => {
                event.currentTarget.removeAttribute("src");
                setImageFailed(true);
              }}
            />
          ) : (
            <span
              aria-hidden="true"
              style={{
                display: "grid",
                placeItems: "center",
                width: "100%",
                height: "100%",
                fontFamily: "var(--dtp-font-display)",
                fontSize: "3rem",
                color: "var(--dtp-blue)",
              }}
            >
              {initialsFromName(player.displayName)}
            </span>
          )}
        </div>

        <div className="dtp-profile-card__identity">
          <span className="dtp-profile-card__verified">DTP Verified</span>
          <h1
            className="dtp-profile-card__name"
            style={{ "--dtp-name-max": nameMaxSize(player.displayName) } as CSSProperties}
          >
            {displayNameCased(player.displayName)}
          </h1>
          <p className="dtp-profile-card__meta">
            {positionLabel}
            {player.positionSecondary ? ` · ${player.positionSecondary}` : ""}
            {` | ${tierLabel} Tier`}
            {player.competition ? ` · ${player.competition}` : ""}
          </p>
        </div>

        <div className="dtp-profile-card__actions">
          <dl className="dtp-profile-card__ratings" aria-label="Core ratings">
            <div className="dtp-profile-rating dtp-profile-rating--overall">
              <dd>{player.overallRating ?? "—"}</dd>
              <dt>Overall</dt>
            </div>
            <div className="dtp-profile-rating dtp-profile-rating--attack">
              <dd>{player.offensiveRating ?? "—"}</dd>
              <dt>Attack</dt>
            </div>
            <div className="dtp-profile-rating dtp-profile-rating--defense">
              <dd>{player.defensiveRating ?? "—"}</dd>
              <dt>Defense</dt>
            </div>
          </dl>
          <div className="dtp-profile-card__share">
            <Button type="button" variant="secondary" onClick={onShare}>
              Share Profile
            </Button>
            {shareStatus && (
              <p className="profile-share-status player-profile-banner__share-status">
                {shareStatus}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="player-profile-banner__insights">
        <PlayerBioGrid facts={snapshotBioFacts} />
        <PlayerPitchGraphic
          variant="snapshot"
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
            <span className="player-profile-banner__bio-label">{fact.label}</span>
            <strong className="player-profile-banner__bio-value">{fact.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GoalkeeperScoreboardProfileSection({
  history,
}: {
  history: PublicPlayerProfile["scoreboardHistory"];
}) {
  const events = history?.events ?? [];
  const keeperEvents = events.filter((event) =>
    GOALKEEPER_SCOREBOARD_EVENT_TYPES.has(event.type)
  );
  const negativeEvents = events.filter((event) =>
    GOALKEEPER_NEGATIVE_EVENT_TYPES.has(event.type)
  );
  const saves = events.filter((event) =>
    event.type === "save" ||
    event.type === "double_save" ||
    event.type === "penalty_saved"
  ).length;
  const claimsAndCommand = events.filter((event) =>
    event.type === "goalkeeper_claim" || event.type === "goalkeeper_command"
  ).length;
  const distribution = events.filter((event) => event.type === "goalkeeper_distribution").length;
  const interventions = events.filter((event) =>
    event.type === "goalkeeper_intervention" ||
    event.type === "goal_line_clearance" ||
    event.type === "clearance"
  ).length;
  const recentKeeperEvents = [...keeperEvents, ...negativeEvents]
    .sort((a, b) => {
      const aDate = a.match.kickoffAt ? new Date(a.match.kickoffAt).getTime() : 0;
      const bDate = b.match.kickoffAt ? new Date(b.match.kickoffAt).getTime() : 0;
      return bDate - aDate || b.minute - a.minute;
    })
    .slice(0, 8);

  return (
    <section className="profile-section goalkeeper-profile">
      <div className="profile-section-heading">
        <div>
          <span className="profile-section__eyebrow">Goalkeeper profile</span>
          <h2>Shot-stopping and box control</h2>
        </div>
        <span className="profile-data-note">ScoreBoard event-backed</span>
      </div>

      <div className="goalkeeper-profile__grid">
        <article className="profile-panel goalkeeper-profile__summary">
          <h3>Keeper evidence</h3>
          <p>
            This profile prioritizes goalkeeper actions recorded in ScoreBoard timelines:
            saves, claims, command moments, distribution, interventions, and goal-line
            defending.
          </p>
          <div className="profile-facts profile-facts--wide goalkeeper-profile__facts">
            <div>
              <span>Saves</span>
              <strong>{saves}</strong>
            </div>
            <div>
              <span>Claims / command</span>
              <strong>{claimsAndCommand}</strong>
            </div>
            <div>
              <span>Distribution</span>
              <strong>{distribution}</strong>
            </div>
            <div>
              <span>Interventions</span>
              <strong>{interventions}</strong>
            </div>
          </div>
        </article>

        <article className="profile-panel scoreboard-history-panel">
          <h3>Recent keeper moments</h3>
          {recentKeeperEvents.length === 0 ? (
            <p className="muted">
              Goalkeeper-specific ScoreBoard actions will appear here once linked.
            </p>
          ) : (
            <ul className="profile-event-list goalkeeper-profile__events">
              {recentKeeperEvents.map((event) => (
                <li key={event.id}>
                  <span>{event.minute}&apos;</span>
                  <strong>{humanizeScoreboardEventType(event.type)}</strong>
                  <em>
                    {event.match.homeTeam} vs {event.match.awayTeam} -{" "}
                    {event.match.competitionName}
                    {event.detail ? ` - ${event.detail}` : ""}
                  </em>
                </li>
              ))}
            </ul>
          )}
        </article>
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
          <strong>Profile verification in progress.</strong> We&apos;re verifying this
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
          <span className="profile-data-note">Verification in progress</span>
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
  minutesPlayed,
}: {
  history: PublicPlayerProfile["scoreboardHistory"];
  minutesPlayed: number | null;
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

  return <ScoreboardHistoryDashboard history={history} minutesPlayed={minutesPlayed} />;
}

function ScoreboardHistoryDashboard({
  history,
  minutesPlayed,
}: {
  history: NonNullable<PublicPlayerProfile["scoreboardHistory"]>;
  minutesPlayed: number | null;
}) {
  const latestAppearance = history.appearances[0];
  const leadingCompetition =
    latestAppearance?.competitionName ?? history.teams[0]?.competition.name ?? "ScoreBoard";

  return <ScoreboardHistoryEventDashboard history={history} minutesPlayed={minutesPlayed} />;

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

      <div className="scoreboard-history-hero">
        <div>
          <span className="scoreboard-history-hero__eyebrow">Verified match record</span>
          <strong>{leadingCompetition}</strong>
          <p>
            Timeline mentions, squad rows, and match appearances connected to this
            player profile.
          </p>
        </div>
        <div className="scoreboard-history-hero__score">
          <span>{history.aggregates.events}</span>
          <small>events tracked</small>
        </div>
      </div>

      <div className="scoreboard-history-kpis">
        <div className="scoreboard-history-kpi">
          <span>Teams</span>
          <strong>{history.aggregates.teams}</strong>
        </div>
        <div className="scoreboard-history-kpi">
          <span>Competitions</span>
          <strong>{history.aggregates.competitions}</strong>
        </div>
        <div className="scoreboard-history-kpi">
          <span>Appearances</span>
          <strong>{history.aggregates.appearances}</strong>
        </div>
        <div className="scoreboard-history-kpi">
          <span>Goals</span>
          <strong>{history.aggregates.goals}</strong>
        </div>
        <div className="scoreboard-history-kpi">
          <span>Assists</span>
          <strong>{history.aggregates.assists}</strong>
        </div>
      </div>

      <div className="profile-integration-grid">
        <article className="profile-panel scoreboard-history-panel">
          <h3>Team links</h3>
          {history.teams.length === 0 ? (
            <p className="muted">No squad rows are linked yet.</p>
          ) : (
            <ul className="profile-card-list scoreboard-history-team-list">
              {history.teams.map((team) => (
                <li key={`${team.competition.id}-${team.teamId}`}>
                  <ScoreboardTeamLogo
                    team={{
                      name: team.teamName,
                      shortName: team.shortName,
                      logoUrl: team.logoUrl,
                    }}
                  />
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

        <article className="profile-panel scoreboard-history-panel scoreboard-history-panel--appearances">
          <h3>Recent appearances</h3>
          {history.appearances.length === 0 ? (
            <p className="muted">No event-backed appearances are linked yet.</p>
          ) : (
            <ul className="profile-card-list scoreboard-history-appearance-list">
              {history.appearances.slice(0, 6).map((match) => (
                <li key={match.matchId}>
                  <Link
                    to={matchCenterPath({ slug: match.matchSlug, id: match.matchId })}
                    className="scoreboard-history-appearance"
                  >
                    <span className="scoreboard-history-appearance__team">
                      <ScoreboardTeamLogo team={match.homeTeam} />
                      <strong>{scoreboardTeamName(match.homeTeam)}</strong>
                    </span>
                    <span className="scoreboard-history-appearance__score">
                      {match.score.home} - {match.score.away}
                    </span>
                    <span className="scoreboard-history-appearance__team scoreboard-history-appearance__team--away">
                      <ScoreboardTeamLogo team={match.awayTeam} />
                      <strong>{scoreboardTeamName(match.awayTeam)}</strong>
                    </span>
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

      <article className="profile-panel profile-benchmark scoreboard-history-panel">
        <h3>Event timeline</h3>
        {history.events.filter(showsOnProfileTimeline).length === 0 ? (
          <p className="muted">No player events are linked yet.</p>
        ) : (
          <ul className="profile-event-list scoreboard-history-event-list">
            {history.events
              .filter(showsOnProfileTimeline)
              .slice(0, 10)
              .map((event) => (
              <li key={event.id}>
                <span>{event.minute}&apos;</span>
                <strong>{scoreboardHistoryEventLabel(event)}</strong>
                <em>
                  {event.playerLabel ? `${playerDisplayName(event.playerLabel)} · ` : ""}
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

function ScoreboardHistoryEventDashboard({
  history,
  minutesPlayed,
}: {
  history: NonNullable<PublicPlayerProfile["scoreboardHistory"]>;
  minutesPlayed: number | null;
}) {
  const latestAppearance = history.appearances[0];
  const leadingCompetition =
    latestAppearance?.competitionName ?? history.teams[0]?.competition.name ?? "ScoreBoard";
  const eventsByMatch = new Map<string, typeof history.events>();

  for (const event of history.events.filter(showsOnProfileTimeline)) {
    const current = eventsByMatch.get(event.match.id) ?? [];
    current.push(event);
    eventsByMatch.set(event.match.id, current);
  }

  const appearanceGroups = history.appearances
    .map((match) => ({
      match,
      events: (eventsByMatch.get(match.matchId) ?? []).sort(
        (a, b) => a.minute - b.minute || a.id.localeCompare(b.id)
      ),
    }))
    .filter((group) => group.events.length > 0);

  return (
    <section className="profile-section">
      <div className="profile-section-heading">
        <div>
          <span className="profile-section__eyebrow">ScoreBoard history</span>
          <h2>Event-backed match record</h2>
        </div>
        <span className="profile-data-note">
          {history.aggregates.events} event{history.aggregates.events === 1 ? "" : "s"}
        </span>
      </div>

      <div className="scoreboard-history-hero">
        <div>
          <span className="scoreboard-history-hero__eyebrow">Verified match record</span>
          <strong>{leadingCompetition}</strong>
          <p>
            Match appearances are grouped with the exact timeline comments where this
            player was mentioned or linked.
          </p>
        </div>
        <div className="scoreboard-history-hero__score">
          <span>{history.aggregates.events}</span>
          <small>events tracked</small>
        </div>
      </div>

      <div className="scoreboard-history-kpis">
        <div className="scoreboard-history-kpi">
          <span>Teams</span>
          <strong>{history.aggregates.teams}</strong>
        </div>
        <div className="scoreboard-history-kpi">
          <span>Competitions</span>
          <strong>{history.aggregates.competitions}</strong>
        </div>
        <div className="scoreboard-history-kpi">
          <span>Appearances</span>
          <strong>{history.aggregates.appearances}</strong>
        </div>
        <div className="scoreboard-history-kpi">
          <span>Goals</span>
          <strong>{history.aggregates.goals}</strong>
        </div>
        <div className="scoreboard-history-kpi">
          <span>Assists</span>
          <strong>{history.aggregates.assists}</strong>
        </div>
        <div className="scoreboard-history-kpi">
          <span>Minutes played</span>
          <strong>{formatMinutesPlayed(minutesPlayed)}</strong>
        </div>
      </div>

      <article className="profile-panel profile-benchmark scoreboard-history-panel scoreboard-history-panel--events">
        <h3>Event timeline</h3>
        {appearanceGroups.length === 0 ? (
          <p className="muted">No player events are linked yet.</p>
        ) : (
          <div className="scoreboard-history-match-groups">
            {appearanceGroups.slice(0, 6).map(({ match, events }) => (
              <article key={match.matchId} className="scoreboard-history-match-group">
                <Link
                  to={matchCenterPath({ slug: match.matchSlug, id: match.matchId })}
                  className="scoreboard-history-appearance"
                >
                  <span className="scoreboard-history-appearance__team">
                    <ScoreboardTeamLogo team={match.homeTeam} />
                    <strong>{scoreboardTeamName(match.homeTeam)}</strong>
                  </span>
                  <span className="scoreboard-history-appearance__score">
                    {match.score.home} - {match.score.away}
                  </span>
                  <span className="scoreboard-history-appearance__team scoreboard-history-appearance__team--away">
                    <ScoreboardTeamLogo team={match.awayTeam} />
                    <strong>{scoreboardTeamName(match.awayTeam)}</strong>
                  </span>
                </Link>
                <p className="scoreboard-history-match-group__meta">
                  {match.competitionName} - {formatDate(match.kickoffAt)}
                  {match.goals ? ` - ${match.goals} goal${match.goals === 1 ? "" : "s"}` : ""}
                  {match.assists
                    ? ` - ${match.assists} assist${match.assists === 1 ? "" : "s"}`
                    : ""}
                </p>
                <ul className="profile-event-list scoreboard-history-event-list">
                  {events.map((event) => (
                    <li key={event.id}>
                      <span>{event.minute}&apos;</span>
                      <strong>{scoreboardHistoryEventLabel(event)}</strong>
                      <em>
                        {event.detail?.trim()
                          ? event.detail.trim()
                          : event.matchedBy === "label"
                            ? "Matched from timeline name"
                            : ""}
                      </em>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
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
  const [activeVideo, setActiveVideo] = useState<ProfilePlayableVideo | null>(null);
  const [activePhoto, setActivePhoto] = useState<ProfilePhotoPreview | null>(null);

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
          {items.map((item) => {
            const playableVideo =
              item.type === "video" ? buildPlayableVideo(item) : null;
            if (playableVideo) {
              return (
                <button
                  key={item.url}
                  type="button"
                  className="profile-media-card player-profile-media-card profile-media-card--button"
                  onClick={() => setActiveVideo(playableVideo)}
                >
                  {playableVideo.thumbnailUrl ? (
                    <img
                      src={playableVideo.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="profile-media-card__thumb"
                    />
                  ) : null}
                  <span className="profile-media-card__icon">Play</span>
                  <strong>{item.title ?? "Highlight video"}</strong>
                  {item.caption && <span>{item.caption}</span>}
                </button>
              );
            }

            if (gallery && item.url) {
              return (
                <button
                  key={item.url}
                  type="button"
                  className="profile-media-card player-profile-media-card profile-media-card--button"
                  onClick={() =>
                    setActivePhoto({
                      item,
                      imageUrl: item.url,
                    })
                  }
                >
                  <img src={item.thumbnailUrl ?? item.url} alt="" loading="lazy" />
                  <span className="profile-media-card__icon">View</span>
                  <strong>{item.title ?? "Player photo"}</strong>
                  {item.caption && <span>{item.caption}</span>}
                </button>
              );
            }

            return (
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
                  <span className="profile-media-card__icon">Open</span>
                )}
                <strong>{item.title ?? "Profile media"}</strong>
                {item.caption && <span>{item.caption}</span>}
              </a>
            );
          })}
        </div>
      )}
      {activeVideo && (
        <ProfileVideoModal video={activeVideo} onClose={() => setActiveVideo(null)} />
      )}
      {activePhoto && (
        <ProfilePhotoModal photo={activePhoto} onClose={() => setActivePhoto(null)} />
      )}
    </div>
  );
}

function ProfilePhotoModal({
  photo,
  onClose,
}: {
  photo: ProfilePhotoPreview;
  onClose: () => void;
}) {
  return (
    <div
      className="profile-video-modal profile-photo-modal"
      role="dialog"
      aria-modal="true"
      aria-label={photo.item.title ?? "Player photo"}
      onClick={onClose}
    >
      <div className="profile-video-modal__panel profile-photo-modal__panel" onClick={(event) => event.stopPropagation()}>
        <div className="profile-video-modal__head">
          <div>
            <span className="player-profile-eyebrow">Photo</span>
            <h3>{photo.item.title ?? "Player photo"}</h3>
          </div>
          <button
            type="button"
            className="profile-video-modal__close"
            onClick={onClose}
            aria-label="Close photo"
          >
            x
          </button>
        </div>
        <div className="profile-photo-modal__frame">
          <img src={photo.imageUrl} alt={photo.item.title ?? "Player photo"} />
        </div>
        {photo.item.caption && <p className="profile-video-modal__caption">{photo.item.caption}</p>}
      </div>
    </div>
  );
}

function ProfileVideoModal({
  video,
  onClose,
}: {
  video: ProfilePlayableVideo;
  onClose: () => void;
}) {
  return (
    <div
      className="profile-video-modal"
      role="dialog"
      aria-modal="true"
      aria-label={video.item.title ?? "Player video"}
      onClick={onClose}
    >
      <div className="profile-video-modal__panel" onClick={(event) => event.stopPropagation()}>
        <div className="profile-video-modal__head">
          <div>
            <span className="player-profile-eyebrow">Video</span>
            <h3>{video.item.title ?? "Highlight video"}</h3>
          </div>
          <button
            type="button"
            className="profile-video-modal__close"
            onClick={onClose}
            aria-label="Close video"
          >
            x
          </button>
        </div>
        <div className="profile-video-modal__frame">
          {video.mode === "video" ? (
            <video src={video.embedUrl} controls playsInline autoPlay />
          ) : (
            <iframe
              src={video.embedUrl}
              title={video.item.title ?? "Player video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          )}
        </div>
        {video.item.caption && <p className="profile-video-modal__caption">{video.item.caption}</p>}
      </div>
    </div>
  );
}
