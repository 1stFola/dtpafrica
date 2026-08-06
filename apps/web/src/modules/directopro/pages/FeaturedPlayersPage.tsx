import { useEffect, useMemo, useState } from "react";
import { fetchFeaturedPlayers, type FeaturedPlayer, isAbortError } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { AdPlacement } from "../../../components/AdPlacement";
import { useAdSlot } from "../../../context/AdConfigContext";
import { contentValue, useStaticContent } from "../../../hooks/useStaticContent";
import { MvceCard } from "@dtp/ui";
import { resolvePositionFullLabel } from "../../../utils/positionLabels";
import { mvceCardHref, toMvceCardData } from "../utils/mvceCardData";
import { HIGH_FETCH_PRIORITY } from "../../../utils/imgPriority";

type RatingFilter = "all" | "elite" | "ready" | "developing" | "emerging";
type SortMode = "rating" | "name" | "position";

function optionList(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).sort(
    (a, b) => a.localeCompare(b)
  );
}

function ratingMatches(rating: number | null | undefined, filter: RatingFilter) {
  if (filter === "all") return true;
  const value = rating ?? 0;
  if (filter === "elite") return value >= 85;
  if (filter === "ready") return value >= 75 && value < 85;
  if (filter === "developing") return value >= 65 && value < 75;
  return value < 65;
}

export function FeaturedPlayersPage() {
  const adInterval = 8;
  const inlineAd = useAdSlot("featuredPlayersInline");
  const content = useStaticContent([
    "featured_players.hero.kicker",
    "featured_players.hero.title",
    "featured_players.hero.body",
  ]);
  usePageTitle("Featured players");

  const [players, setPlayers] = useState<FeaturedPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("all");
  const [ageGroup, setAgeGroup] = useState("all");
  const [nationality, setNationality] = useState("all");
  const [ratingBand, setRatingBand] = useState<RatingFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("rating");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    fetchFeaturedPlayers(50, controller.signal, { cache: false })
      .then((data) => {
        if (active) setPlayers(data);
      })
      .catch((e) => {
        if (active && !isAbortError(e)) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const positionOptions = useMemo(
    () =>
      optionList(players.map((player) => player.positionPrimary)).map((value) => ({
        value,
        label: resolvePositionFullLabel(value),
      })),
    [players]
  );
  const ageOptions = useMemo(() => optionList(players.map((player) => player.ageGroup)), [players]);
  const nationalityOptions = useMemo(
    () => optionList(players.map((player) => player.nationality)),
    [players]
  );

  const filteredPlayers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players
      .filter((player) => {
        const haystack = [
          player.displayName,
          player.positionPrimary,
          player.positionFull,
          player.ageGroup,
          player.nationality,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return (
          (!q || haystack.includes(q)) &&
          (position === "all" || player.positionPrimary === position) &&
          (ageGroup === "all" || player.ageGroup === ageGroup) &&
          (nationality === "all" || player.nationality === nationality) &&
          ratingMatches(player.overallRating, ratingBand)
        );
      })
      .sort((a, b) => {
        if (sortMode === "name") return a.displayName.localeCompare(b.displayName);
        if (sortMode === "position") {
          return `${a.positionPrimary}-${a.displayName}`.localeCompare(
            `${b.positionPrimary}-${b.displayName}`
          );
        }
        return (b.overallRating ?? -1) - (a.overallRating ?? -1);
      });
  }, [ageGroup, nationality, players, position, query, ratingBand, sortMode]);

  const clearFilters = () => {
    setQuery("");
    setPosition("all");
    setAgeGroup("all");
    setNationality("all");
    setRatingBand("all");
    setSortMode("rating");
  };

  return (
    <div className="dtp-page">
      {/* Hero — Figma 234:486 */}
      <section className="dtp-hero dtp-hero--left">
        <img className="dtp-hero__media" {...HIGH_FETCH_PRIORITY} decoding="async" src="/figma/hero-featured-players.webp" alt="" aria-hidden="true" />
        <div className="dtp-hero__scrim" aria-hidden="true" />
        <div className="dtp-shell dtp-hero__inner">
          <p className="dtp-eyebrow" style={{ color: "var(--dtp-paper)" }}>
            {contentValue(content, "featured_players.hero.kicker", "Verified Talent Intelligence")}
          </p>
          <h1 className="dtp-display dtp-display--hero dtp-hero__title">
            {contentValue(
              content,
              "featured_players.hero.title",
              "Featured players. Proven potential."
            )}
          </h1>

          <dl className="dtp-hero__stats" aria-label="Featured player signals">
            <div className="dtp-hero__stat">
              <dd>{loading ? "--" : players.length}</dd>
              <dt>Published profiles</dt>
            </div>
            <div className="dtp-hero__stat">
              <dd>DTP</dd>
              <dt>Verified evidence</dt>
            </div>
            <div className="dtp-hero__stat">
              <dd>{loading ? "--" : filteredPlayers.length}</dd>
              <dt>Matching filters</dt>
            </div>
          </dl>

          <p className="dtp-lead dtp-hero__lead">
            {contentValue(
              content,
              "featured_players.hero.body",
              "Explore player profiles from the DTP Africa intelligence ecosystem."
            )}
          </p>
        </div>
      </section>

      {/* Filters + card grid */}
      <section className="dtp-band dtp-band--ink">
        <div className="dtp-shell">
          <div className="dtp-filters" role="search" aria-label="Featured player filters">
            <label className="sr-only" htmlFor="fp-search">
              Search players
            </label>
            <input
              id="fp-search"
              className="dtp-filters__search"
              type="search"
              value={query}
              placeholder="Name, Nationality, Sex"
              onChange={(event) => setQuery(event.target.value)}
            />

            <label className="sr-only" htmlFor="fp-position">
              Position
            </label>
            <select
              id="fp-position"
              className="dtp-filters__select"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            >
              <option value="all">All Positions</option>
              {positionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="fp-age">
              Age group
            </label>
            <select
              id="fp-age"
              className="dtp-filters__select"
              value={ageGroup}
              onChange={(event) => setAgeGroup(event.target.value)}
            >
              <option value="all">All Age Groups</option>
              {ageOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="fp-country">
              Nationality
            </label>
            <select
              id="fp-country"
              className="dtp-filters__select"
              value={nationality}
              onChange={(event) => setNationality(event.target.value)}
            >
              <option value="all">All Countries</option>
              {nationalityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="fp-rating">
              Rating band
            </label>
            <select
              id="fp-rating"
              className="dtp-filters__select"
              value={ratingBand}
              onChange={(event) => setRatingBand(event.target.value as RatingFilter)}
            >
              <option value="all">All Ratings</option>
              <option value="elite">Elite 85+</option>
              <option value="ready">Pro-ready 75-84</option>
              <option value="developing">Developing 65-74</option>
              <option value="emerging">Emerging under 65</option>
            </select>

            <label className="sr-only" htmlFor="fp-sort">
              Sort order
            </label>
            <select
              id="fp-sort"
              className="dtp-filters__select"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
            >
              <option value="rating">Highest Ratings</option>
              <option value="name">Name A-Z</option>
              <option value="position">Position</option>
            </select>

            <button type="button" className="dtp-filters__reset" onClick={clearFilters}>
              Reset
            </button>
          </div>

          {error && (
            <p className="dtp-form__error" role="alert" style={{ marginTop: "var(--dtp-space-5)" }}>
              {error}
            </p>
          )}

          <div style={{ marginTop: "clamp(2rem, 4vw, 48px)" }}>
            {loading && (
              <div className="dtp-card-grid" aria-busy="true" aria-hidden="true">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div key={idx} className="dtp-skeleton home-talent-card-skeleton" />
                ))}
              </div>
            )}

            {!loading && players.length === 0 && !error && (
              <div style={{ textAlign: "center", color: "var(--dtp-white)" }}>
                <p className="dtp-lead">No featured players yet</p>
                <p className="dtp-row__meta">
                  Verified player profiles will appear here once published.
                </p>
              </div>
            )}

            {!loading && players.length > 0 && filteredPlayers.length === 0 && !error && (
              <div style={{ textAlign: "center", color: "var(--dtp-white)" }}>
                <p className="dtp-lead">No matching players</p>
                <p className="dtp-row__meta">Adjust the filters to broaden the talent view.</p>
              </div>
            )}

            {!loading && filteredPlayers.length > 0 && (
              <div className="dtp-card-grid">
                {filteredPlayers.flatMap((player, idx) => {
                  const items = [
                    <MvceCard
                      key={player.id}
                      player={toMvceCardData(player)}
                      to={mvceCardHref(player)}
                    />,
                  ];
                  if (inlineAd && (idx + 1) % adInterval === 0 && idx < filteredPlayers.length - 1) {
                    items.push(
                      <div key={`featured-inline-ad-${idx}`} className="player-grid-ad">
                        <AdPlacement slotKey="featuredPlayersInline" />
                      </div>
                    );
                  }
                  return items;
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
