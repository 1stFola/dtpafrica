import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@dtp/ui";
import {
  apiGet,
  isAbortError,
  type PlayerSkeletonProfile,
  type PublicPlayerProfile,
} from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { isGoalkeeper } from "../../../utils/position";
import { resolvePositionFullLabel } from "../../../utils/positionLabels";
import { BenchmarkPlaystyleComparison } from "../components/PlaystyleComparisonModal";
import {
  PlayerCategoryRadar,
  type CategoryScore,
} from "../components/playerProfile/PlayerCategoryRadar";
import { PlayerPitchGraphic } from "../components/playerProfile/PlayerPitchGraphic";

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

type ProfileTab = "overview" | "scoreboard" | "scouting" | "media";
type ProfileMediaItem = NonNullable<PublicPlayerProfile["mediaItems"]>[number] & {
  url: string;
};
type PlaystyleBadge = {
  icon: string;
  title: string;
  description: string;
  fitPercent?: number | null;
  contextLine?: string | null;
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

const ALL_ATTRIBUTE_KEYS = ATTRIBUTE_GROUPS.flatMap((group) => group.keys);

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
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

function attributeTierClass(score: number): string {
  if (score >= 80) return "player-profile-attr--elite";
  if (score >= 70) return "player-profile-attr--silver";
  if (score >= 60) return "player-profile-attr--developing";
  return "player-profile-attr--base";
}

function ratingBadgeTone(rating?: number | null): string {
  if (rating == null) return "player-profile-rating-badge--muted";
  if (rating >= 85) return "player-profile-rating-badge--elite";
  if (rating >= 75) return "player-profile-rating-badge--ready";
  return "player-profile-rating-badge--standard";
}

type BioFact = { label: string; value: string; highlight?: boolean };

function averageAttributeScores(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildCategoryScores(
  player: PublicPlayerProfile,
  attributes: ReturnType<typeof buildAttributeMap>
): CategoryScore[] {
  const overall = player.overallRating ?? 62;
  const att = clampScore(player.offensiveRating ?? overall);
  const def = clampScore(player.defensiveRating ?? overall);
  const technicalKeys = [
    "dribbling",
    "ball_control",
    "passing",
    "finishing",
    "technique",
    "first_touch",
  ] as const;
  const tec = clampScore(
    averageAttributeScores(technicalKeys.map((key) => attributes[key]))
  );
  const creativeKeys = ["vision", "passing", "decision_making", "technique"] as const;
  const cre = clampScore(
    averageAttributeScores(creativeKeys.map((key) => attributes[key]))
  );
  const tactical = player.tacticalSummary;
  const tac = tactical
    ? clampScore(
        averageAttributeScores([
          tactical.gegenpressScore,
          tactical.tikiTakaScore,
          tactical.counterAttackScore,
          tactical.wingerScore,
          tactical.totalFootballScore,
        ])
      )
    : clampScore(
        averageAttributeScores([
          attributes.positioning,
          attributes.work_rate,
          attributes.decision_making,
        ])
      );

  return [
    { key: "att", label: "ATT", score: att },
    { key: "tec", label: "TEC", score: tec },
    { key: "tac", label: "TAC", score: tac },
    { key: "def", label: "DEF", score: def },
    { key: "cre", label: "CRE", score: cre },
  ];
}

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
  }
  return facts;
}

const PHILOSOPHY_FORMATION_CONTEXT: Record<string, { formation: string; slot: string }> = {
  "Tiki-Taka": { formation: "4-3-3", slot: "cm" },
  "Tiki Taka": { formation: "4-3-3", slot: "cm" },
  Gegenpress: { formation: "4-2-3-1", slot: "lam" },
  "Counter attack": { formation: "5-3-2", slot: "st" },
  "Counter Attack": { formation: "5-3-2", slot: "st" },
  "Winger play": { formation: "4-3-3", slot: "lw" },
  "Winger Play": { formation: "4-3-3", slot: "lw" },
  "Total football": { formation: "4-3-3", slot: "rw" },
  "Total Football": { formation: "4-3-3", slot: "rw" },
};

const TACTICAL_TRAIT_CONTEXT: Record<string, { formation: string; slot: string }> = {
  Gegenpress: { formation: "4-2-3-1", slot: "lam" },
  "Tiki-taka": { formation: "4-3-3", slot: "cm" },
  "Counter attack": { formation: "5-3-2", slot: "st" },
  "Winger play": { formation: "4-3-3", slot: "lw" },
  "Total football": { formation: "4-3-3", slot: "rw" },
};

function formatFormationContext(formation: string, slot?: string | null): string {
  const normalizedSlot = slot?.trim().toLowerCase();
  return normalizedSlot ? `${formation} · ${normalizedSlot}` : formation;
}

function resolvePhilosophyContext(name: string, slotHint?: string | null): string {
  const mapped = PHILOSOPHY_FORMATION_CONTEXT[name];
  if (mapped) {
    return formatFormationContext(mapped.formation, slotHint ?? mapped.slot);
  }
  return slotHint ? formatFormationContext("4-3-3", slotHint) : "4-3-3 · cm";
}

function buildPlaystyleBadges(player: PublicPlayerProfile): PlaystyleBadge[] {
  const badges: PlaystyleBadge[] = [];
  const seen = new Set<string>();
  const push = (badge: PlaystyleBadge) => {
    const key = badge.title.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    badges.push(badge);
  };

  for (const philosophy of player.philosophies ?? []) {
    push({
      icon: "◆",
      title: philosophy.name,
      fitPercent: clampScore(philosophy.score),
      contextLine: resolvePhilosophyContext(philosophy.name, player.positionPrimary?.toLowerCase()),
      description: "Philosophy alignment from calibrated SIP scoring.",
    });
  }

  for (const fit of player.scoutingIntelligence?.philosophyFits ?? []) {
    push({
      icon: "◆",
      title: fit.philosophy,
      fitPercent: clampScore(fit.philosophyFitScore),
      contextLine: formatFormationContext(fit.formation, fit.positionSlot),
      description: "Saved philosophy-fit row from scouting intelligence.",
    });
  }

  for (const score of player.scoutingIntelligence?.topTacticalScores ?? []) {
    push({
      icon: "⚡",
      title: score.label,
      fitPercent: clampScore(score.value),
      contextLine: "System Trait",
      description: "Standout tactical score from SIP calibration.",
    });
  }

  const tactical = player.tacticalSummary;
  if (tactical) {
    const tacticalTraits = [
      { label: "Gegenpress", value: tactical.gegenpressScore },
      { label: "Tiki-taka", value: tactical.tikiTakaScore },
      { label: "Counter attack", value: tactical.counterAttackScore },
      { label: "Winger play", value: tactical.wingerScore },
      { label: "Total football", value: tactical.totalFootballScore },
    ]
      .sort((a, b) => b.value - a.value)
      .slice(0, 2);
    for (const trait of tacticalTraits) {
      if (trait.value >= 55) {
        const mapped = TACTICAL_TRAIT_CONTEXT[trait.label];
        push({
          icon: "◎",
          title: trait.label,
          fitPercent: clampScore(trait.value),
          contextLine: mapped
            ? formatFormationContext(mapped.formation, mapped.slot)
            : "System Trait",
          description: "SIP tactical index from rolling match metrics.",
        });
      }
    }
  }

  const benchmark = player.benchmarkMetadata?.nearest;
  if (benchmark && typeof benchmark === "object" && "name" in benchmark) {
    push({
      icon: "★",
      title: "Benchmark comp",
      contextLine: "System Trait",
      description: `Nearest comp: ${String(benchmark.name)}.`,
    });
  }

  if (badges.length === 0) {
    push({
      icon: "◎",
      title: "Versatile profile",
      contextLine: "4-3-3 · cm",
      description: "Playstyle badges populate once SIP tactical and philosophy data sync.",
    });
  }

  return badges.slice(0, 6);
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [player, setPlayer] = useState<PublicPlayerProfile | null>(null);
  const [skeleton, setSkeleton] = useState<PlayerSkeletonProfile | null>(null);
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
    if (!slugOrId) return;
    const controller = new AbortController();
    let cancelled = false;
    setPlayer(null);
    setSkeleton(null);
    setError(null);
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

  if (!player) {
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
  const minutesPlayed = resolveProfileMinutes(player);
  const isGk = isGkProfile(player);
  const careerStatBoxes = buildCareerStatBoxes(player, minutesPlayed, isGk);
  const playstyleBadges = buildPlaystyleBadges(player);
  const positionLabel = resolvePositionFullLabel(player.positionPrimary.trim(), null);
  const highlights = [
    `${ratingTier(player.overallRating)} ${player.positionPrimary} profile`,
    player.ageGroup ? `${player.ageGroup} pathway candidate` : "Open age-band profile",
    tactical ? "Tactical scores available" : "Awaiting tactical recalculation",
    scoreboard?.aggregates.goals
      ? `${scoreboard.aggregates.goals} ScoreBoard goal${scoreboard.aggregates.goals === 1 ? "" : "s"}`
      : "ScoreBoard history pending",
  ];

  const categoryScores = buildCategoryScores(player, attributes);
  const bioFacts = buildBioFacts(player, valuation);

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "scouting", label: "Scouting Details" },
    { id: "scoreboard", label: "ScoreBoard Metrics" },
    {
      id: "media",
      label:
        mediaItems.length > 0
          ? `Media (Video, Photos, Publications) (${mediaItems.length})`
          : "Media (Video, Photos, Publications)",
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
        <PlaystyleBadgesSection badges={playstyleBadges} />
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
            <div className="profile-section-heading">
              <div>
                <span className="player-profile-eyebrow">Rating attributes</span>
                <h2 className="player-profile-heading">18-point profile</h2>
              </div>
              <span className="profile-data-note">
                {player.ratingAttributes ? "Calibrated" : "Derived fallback"}
              </span>
            </div>

            <PlayerAttributeMicroGrid attributes={attributes} />

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
              playerAge={player.age}
              benchmark={benchmark}
              attributes={attributes}
            />
          </section>

          {tactical && (
            <section className="profile-section">
              <span className="player-profile-eyebrow">Tactical snapshot</span>
              <h2 className="player-profile-heading">System fit</h2>
              <div className="tactical-grid player-profile-tactical-grid">
                <div className="player-profile-tactical-cell">
                  <span className="label">Gegenpress</span>
                  <strong>{Math.round(tactical.gegenpressScore)}</strong>
                </div>
                <div className="player-profile-tactical-cell">
                  <span className="label">Tiki-taka</span>
                  <strong>{Math.round(tactical.tikiTakaScore)}</strong>
                </div>
                <div className="player-profile-tactical-cell">
                  <span className="label">Counter</span>
                  <strong>{Math.round(tactical.counterAttackScore)}</strong>
                </div>
                <div className="player-profile-tactical-cell">
                  <span className="label">Winger</span>
                  <strong>{Math.round(tactical.wingerScore)}</strong>
                </div>
              </div>
            </section>
          )}

          {player.positionFit && (
            <section className="profile-section">
              <span className="player-profile-eyebrow">Position intelligence</span>
              <h2 className="player-profile-heading">Role fit</h2>
              <p className="player-profile-muted">
                Primary {player.positionFit.primaryPositionFit}
                {player.positionFit.secondaryPositionFit
                  ? ` · Secondary ${player.positionFit.secondaryPositionFit}`
                  : ""}
                {player.positionFit.confidence
                  ? ` · ${Math.round(player.positionFit.confidence)}% confidence`
                  : ""}
              </p>
            </section>
          )}
        </>
      )}

      {activeTab === "scoreboard" && (
        <>
          <CareerStatBoxesSection stats={careerStatBoxes} />
          <ScoreboardHistorySection history={scoreboard} />
        </>
      )}

      {activeTab === "scouting" && (
        <>
          <ScoutingIntelligenceSection scouting={scouting} />
          <ValuationSection valuation={valuation} playerId={player.id} />
        </>
      )}

      {activeTab === "media" && (
        <CombinedMediaSection
          videoItems={videoItems}
          photoItems={photoItems}
          otherMediaItems={otherMediaItems}
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
          positionSecondary={player.positionSecondary}
          positionFitSecondary={player.positionFit?.secondaryPositionFit ?? null}
          scoutingSecondaryPositionFit={
            player.scoutingIntelligence?.positionFit?.secondaryPositionFit ?? null
          }
          ratingAttributes={player.ratingAttributes}
        />
        <PlayerCategoryRadar scores={categoryScores} />
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

function PlaystyleBadgesSection({ badges }: { badges: PlaystyleBadge[] }) {
  return (
    <div className="player-profile-playstyles">
      <span className="player-profile-eyebrow">Playstyle badges</span>
      <h3 className="player-profile-subheading">Specialties</h3>
      <ul className="player-profile-playstyles__grid grid-cols-2 grid-rows-3 gap-3">
        {badges.map((badge) => (
          <li key={badge.title} className="player-profile-playstyle">
            <span className="player-profile-playstyle__icon" aria-hidden="true">
              {badge.icon}
            </span>
            <div className="player-profile-playstyle__body">
              <div className="player-profile-playstyle__head">
                <strong className="player-profile-playstyle__title">{badge.title}</strong>
                {badge.fitPercent != null && (
                  <span className="player-profile-playstyle__fit">{badge.fitPercent}% fit</span>
                )}
              </div>
              {badge.contextLine && (
                <span className="player-profile-playstyle__context">{badge.contextLine}</span>
              )}
              <p className="player-profile-playstyle__desc">{badge.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlayerAttributeMicroGrid({
  attributes,
}: {
  attributes: ReturnType<typeof buildAttributeMap>;
}) {
  return (
    <div className="player-profile-attr-grid">
      {ALL_ATTRIBUTE_KEYS.map((key) => {
        const score = clampScore(attributes[key]);
        return (
          <article
            key={key}
            className={`player-profile-attr ${attributeTierClass(score)}`}
          >
            <div className="player-profile-attr__head">
              <span className="player-profile-attr__label">{ATTRIBUTE_LABELS[key]}</span>
              <strong className="player-profile-attr__score">{score}</strong>
            </div>
            <div className="player-profile-attr__track" aria-hidden="true">
              <span className="player-profile-attr__fill" style={{ width: `${score}%` }} />
            </div>
          </article>
        );
      })}
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

function CombinedMediaSection({
  videoItems,
  photoItems,
  otherMediaItems,
}: {
  videoItems: ProfileMediaItem[];
  photoItems: ProfileMediaItem[];
  otherMediaItems: ProfileMediaItem[];
}) {
  const hasAny =
    videoItems.length > 0 || photoItems.length > 0 || otherMediaItems.length > 0;

  if (!hasAny) {
    return (
      <section className="profile-section">
        <span className="player-profile-eyebrow">Media</span>
        <h2 className="player-profile-heading">Media (Video, Photos, Publications)</h2>
        <div className="profile-empty-state">
          <strong>No public media has been attached to this profile yet.</strong>
          <p>Public media can be added through admin profile management or calibration imports.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="profile-section player-profile-media">
      <span className="player-profile-eyebrow">Media</span>
      <h2 className="player-profile-heading">Media (Video, Photos, Publications)</h2>
      {videoItems.length > 0 && (
        <MediaSection
          title="Video"
          empty=""
          items={videoItems}
          embedded
        />
      )}
      {photoItems.length > 0 && (
        <MediaSection
          title="Photos"
          empty=""
          items={photoItems}
          gallery
          embedded
        />
      )}
      {otherMediaItems.length > 0 && (
        <MediaSection
          title="Publications"
          empty=""
          items={otherMediaItems}
          embedded
        />
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
            {scouting.aggregateMetrics.minutesPlayed > 0
              ? ` · ${formatMinutesPlayed(
                  Math.round(scouting.aggregateMetrics.minutesPlayed)
                )} min`
              : ""}
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
        {scouting.aggregateMetrics && scouting.aggregateMetrics.minutesPlayed > 0 && (
          <div>
            <span>Rolling minutes</span>
            <strong>
              {formatMinutesPlayed(Math.round(scouting.aggregateMetrics.minutesPlayed))}
            </strong>
          </div>
        )}
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
      <h3 className="player-profile-subheading">{title}</h3>
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
