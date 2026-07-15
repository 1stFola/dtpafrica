import { useEffect, useMemo, useState } from "react";
import { fetchFeaturedPlayers, type FeaturedPlayer, isAbortError } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { AdPlacement } from "../../../components/AdPlacement";
import { useAdSlot } from "../../../context/AdConfigContext";
import { contentValue, useStaticContent } from "../../../hooks/useStaticContent";
import { HomeFeaturedTalentCard } from "../components/home/HomeFeaturedTalentCard";
import { resolvePositionFullLabel } from "../../../utils/positionLabels";

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
    <div className="home-page evidence-page evidence-page--players">
      <header className="evidence-hero featured-players-hero">
        <span className="about-kicker">
          {contentValue(content, "featured_players.hero.kicker", "Verified talent intelligence")}
        </span>
        <h1>
          {contentValue(
            content,
            "featured_players.hero.title",
            "Featured players with proof behind the promise."
          )}
        </h1>
        <p>
          {contentValue(
            content,
            "featured_players.hero.body",
            "Explore player profiles shaped by ratings, tactical summaries, performance history, and scouting context from the DTP Africa intelligence ecosystem."
          )}
        </p>
        <div className="evidence-hero__metrics" aria-label="Featured player signals">
          <article>
            <strong>{loading ? "--" : players.length}</strong>
            <span>Published profiles</span>
          </article>
          <article>
            <strong>{loading ? "--" : filteredPlayers.length}</strong>
            <span>Matching filters</span>
          </article>
          <article>
            <strong>DTP</strong>
            <span>Verified evidence</span>
          </article>
        </div>
      </header>

      <section className="featured-players-filterbar" aria-label="Featured player filters">
        <label className="featured-players-filterbar__search">
          <span>Search</span>
          <input
            type="search"
            value={query}
            placeholder="Name, role, nationality"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Position</span>
          <select value={position} onChange={(event) => setPosition(event.target.value)}>
            <option value="all">All positions</option>
            {positionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Age group</span>
          <select value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)}>
            <option value="all">All age groups</option>
            {ageOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Nationality</span>
          <select value={nationality} onChange={(event) => setNationality(event.target.value)}>
            <option value="all">All countries</option>
            {nationalityOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Rating</span>
          <select
            value={ratingBand}
            onChange={(event) => setRatingBand(event.target.value as RatingFilter)}
          >
            <option value="all">All ratings</option>
            <option value="elite">Elite 85+</option>
            <option value="ready">Pro-ready 75-84</option>
            <option value="developing">Developing 65-74</option>
            <option value="emerging">Emerging under 65</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="rating">Highest rating</option>
            <option value="name">Name A-Z</option>
            <option value="position">Position</option>
          </select>
        </label>
        <button type="button" className="featured-players-filterbar__clear" onClick={clearFilters}>
          Reset
        </button>
      </section>

      {error && (
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <div className="home-features-talent-grid" aria-busy="true" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="dtp-skeleton home-talent-card-skeleton" />
          ))}
        </div>
      )}
      {!loading && players.length === 0 && !error && (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No featured players yet</p>
          <p>Verified player profiles will appear here once published.</p>
        </div>
      )}
      {!loading && players.length > 0 && filteredPlayers.length === 0 && !error && (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No matching players</p>
          <p>Adjust the filters to broaden the talent view.</p>
        </div>
      )}
      {!loading && filteredPlayers.length > 0 && (
        <div className="home-features-talent-grid featured-players-grid">
          {filteredPlayers.flatMap((player, idx) => {
            const items = [<HomeFeaturedTalentCard key={player.id} player={player} />];
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
  );
}
