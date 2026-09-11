import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchCompetitionTallies,
  fetchCompetitions,
  searchScoreboard,
  type SbCompetition,
  type SbSearchResult,
} from "../../../api/scoreboard";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { isAbortError } from "../../../api/client";
import { MatchCard } from "../components/MatchCard";
import { CompetitionCrest, competitionHue } from "../components/CompetitionCrest";
import { SplitFlapCounter } from "../components/SplitFlapCounter";

/** How often the card counters re-read teams and goals while the tab is visible. */
const TALLY_POLL_MS = 20_000;

type Tally = { teams: number; goals: number };

/* Said once for the whole grid rather than repeated on every card, which kept
   the cards tall for a line that never changed. */
const COMPETITIONS_INTRO =
  "Open any competition for its hub: standings, fixtures, results, leaders, totals and team-by-team navigation.";

type CompetitionTag = "COMPETITION" | "LIVE TABLE" | "UPCOMING" | "ARCHIVED" | "FEATURED";

type FeaturedCard = {
  key: string;
  name: string;
  geo: string;
  tags: CompetitionTag[];
  /** Present when the competition exists in the DB and is clickable. */
  slug: string | null;
  placeholder: boolean;
  id?: string;
  logoUrl?: string | null;
};

/**
 * Curated reference set from the design spec. Any entry whose name does not
 * match a published DB competition is rendered as a clearly-marked placeholder
 * so the grid always feels content-rich.
 */
const CURATED_COMPETITIONS: {
  name: string;
  geo: string;
  tag: Extract<CompetitionTag, "UPCOMING" | "ARCHIVED">;
}[] = [
  { name: "Jagaban Cup", geo: "Tournament · Lagos, Nigeria", tag: "UPCOMING" },
  { name: "1XCup", geo: "Tournament · Lagos, Nigeria", tag: "UPCOMING" },
  { name: "Creative Championship", geo: "League · Nigeria", tag: "ARCHIVED" },
  { name: "Lagos FA Cup", geo: "Tournament · Lagos, Nigeria", tag: "UPCOMING" },
  { name: "Nationwide League One (NLO)", geo: "League · Nigeria", tag: "ARCHIVED" },
];

const CURATED_KEYS = CURATED_COMPETITIONS.map((c) => normalizeKey(c.name));

/** True when a real competition name corresponds to a curated reference entry. */
function isCuratedName(name: string): boolean {
  const key = normalizeKey(name);
  return CURATED_KEYS.some((c) => key === c || key.includes(c) || c.includes(key));
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Substring-aware match so a curated reference name (e.g. "Jagaban Cup")
 * counts as present when the DB stores a seasoned variant ("Jagaban Cup 2026"),
 * preventing a duplicate placeholder alongside the real competition.
 */
function curatedMatchesReal(curatedName: string, realKeys: Set<string>): boolean {
  const c = normalizeKey(curatedName);
  for (const r of realKeys) {
    if (r === c || r.includes(c) || c.includes(r)) return true;
  }
  return false;
}

/** "Tournament · Country" sub-headline derived from a real competition. */
function competitionGeo(competition: SbCompetition): string {
  const kind = /cup|tournament|knockout/i.test(competition.type)
    ? "Tournament"
    : "League";
  const country = competition.country?.trim() || "Nigeria";
  return `${kind} · ${country}`;
}

function competitionToCard(competition: SbCompetition): FeaturedCard {
  const tags: CompetitionTag[] = ["COMPETITION"];
  if ((competition._count?.matches ?? 0) > 0) tags.push("LIVE TABLE");
  if (isCuratedName(competition.name)) tags.push("FEATURED");
  return {
    key: competition.id,
    id: competition.id,
    name: competition.name,
    geo: competitionGeo(competition),
    tags,
    slug: competition.slug,
    placeholder: false,
    logoUrl: competition.logoUrl ?? null,
  };
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2a7 7 0 0 0-7 7c0 4.7 6.1 12.2 6.36 12.51a.83.83 0 0 0 1.28 0C12.9 21.2 19 13.7 19 9a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"
      />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18 4h-1V3a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1H6a2 2 0 0 0-2 2v2a4 4 0 0 0 3.55 3.97A5 5 0 0 0 11 14.9V17H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.1a5 5 0 0 0 3.45-2.93A4 4 0 0 0 20 8V6a2 2 0 0 0-2-2ZM6 8V6h1v3.83A2 2 0 0 1 6 8Zm12 0a2 2 0 0 1-1 1.73V6h1v2Z"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"
      />
    </svg>
  );
}

function CompetitionGridCard({ card, tally }: { card: FeaturedCard; tally?: Tally }) {
  // The counters take the competition's crest hue, so each board matches its card.
  const style = card.id
    ? ({ "--sb-comp-hue": String(competitionHue(card.id)) } as CSSProperties)
    : undefined;
  const inner = (
    <>
      {/* Crest leads the card so competitions are identifiable before reading. */}
      <div className="dbx-comp-card__head">
        <CompetitionCrest
          competition={{ id: card.id, name: card.name, logoUrl: card.logoUrl }}
          size="lg"
        />
        <div className="dbx-comp-card__ident">
          <h3 className="dbx-comp-card__title">{card.name}</h3>
          <p className="dbx-comp-card__geo">{card.geo}</p>
        </div>
      </div>
      <div className="dbx-comp-card__tags">
        {card.tags.map((tag) => (
          <span
            key={tag}
            className={`dbx-tag dbx-tag--${tag.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {tag}
          </span>
        ))}
      </div>
      <div className={`dbx-comp-card__foot${tally ? " dbx-comp-card__foot--board" : ""}`}>
        <div className="dbx-comp-card__markers">
          <span className="dbx-foot-marker">
            <PinIcon />
            {card.geo.split("·")[1]?.trim() ?? card.geo}
          </span>
          <span className="dbx-foot-marker">
            <TrophyIcon />
            {card.geo.split("·")[0]?.trim() ?? "Competition"}
          </span>
        </div>
        {tally && (
          <div className="dbx-comp-card__board">
            <SplitFlapCounter value={tally.teams} label="Teams" />
            <SplitFlapCounter value={tally.goals} label="Goals" minDigits={3} />
          </div>
        )}
      </div>
    </>
  );

  if (card.slug) {
    return (
      <Link to={`/scoreboard/competition/${card.slug}`} className="dbx-comp-card" style={style}>
        {inner}
      </Link>
    );
  }
  return (
    <div className="dbx-comp-card dbx-comp-card--placeholder" aria-disabled="true">
      {inner}
    </div>
  );
}

export function BrowsePage() {
  usePageTitle("Deep Browse Experience");
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<SbSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [competitions, setCompetitions] = useState<SbCompetition[]>([]);
  const [competitionsLoading, setCompetitionsLoading] = useState(true);
  const [competitionsError, setCompetitionsError] = useState<string | null>(null);
  // Teams and goals per competition id, for the card counters.
  const [tallies, setTallies] = useState<Record<string, Tally>>({});

  const debouncedQuery = useDebouncedValue(query, 350);

  // Legacy ?tab=teams|players URLs fall back to the competitions browse view.
  useEffect(() => {
    if (!searchParams.has("tab")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time load of published competitions for the Featured grid. The
  // aggregate-stats request that used to sit here only fed the hero's EXPLORE
  // ITEMS counter, so it went with the hero.
  useEffect(() => {
    setCompetitionsLoading(true);
    fetchCompetitions()
      .then((data) => {
        setCompetitions(data);
        setCompetitionsError(null);
        setTallies((prev) => {
          const next = { ...prev };
          for (const c of data) next[c.id] = { teams: c._count?.teams ?? 0, goals: c.goals ?? 0 };
          return next;
        });
      })
      .catch((e) => {
        if (!isAbortError(e)) setCompetitionsError(String(e));
      })
      .finally(() => setCompetitionsLoading(false));
  }, []);

  // Keep the counters current: poll while the tab is visible, and catch up the
  // moment it becomes visible again. A failed poll keeps the last counts.
  useEffect(() => {
    let controller: AbortController | null = null;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      fetchCompetitionTallies(controller.signal)
        .then((rows) =>
          setTallies((prev) => {
            const changed = rows.some(
              (row) =>
                prev[row.competitionId]?.teams !== row.teams ||
                prev[row.competitionId]?.goals !== row.goals
            );
            if (!changed) return prev;
            const next = { ...prev };
            for (const row of rows) next[row.competitionId] = { teams: row.teams, goals: row.goals };
            return next;
          })
        )
        .catch(() => undefined);
    };
    const timer = window.setInterval(refresh, TALLY_POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      controller?.abort();
    };
  }, []);

  // Debounced search that keeps the URL query (q) in sync.
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    const next: Record<string, string> = {};
    if (trimmed) next.q = trimmed;
    setSearchParams(next, { replace: true });

    if (trimmed.length < 2) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    searchScoreboard(trimmed)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((e) => {
        if (active) {
          setResult(null);
          setError(String(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  // Featured cards: real competitions first, curated placeholders for any
  // named reference competition not yet present in the DB.
  const featuredCards = useMemo<FeaturedCard[]>(() => {
    const realCards = competitions.map(competitionToCard);
    const presentKeys = new Set(competitions.map((c) => normalizeKey(c.name)));
    const placeholders: FeaturedCard[] = CURATED_COMPETITIONS.filter(
      (c) => !curatedMatchesReal(c.name, presentKeys)
    ).map((c) => ({
      key: `placeholder-${normalizeKey(c.name)}`,
      name: c.name,
      geo: c.geo,
      tags: [c.tag, "COMPETITION"],
      slug: null,
      placeholder: true,
    }));
    return [...realCards, ...placeholders];
  }, [competitions]);

  const searchedCompetitionCards = useMemo<FeaturedCard[]>(
    () => (result ? result.competitions.map(competitionToCard) : []),
    [result]
  );

  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length >= 2;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  const renderCompetitions = () => {
    if (hasQuery) {
      if (loading && !result) return <CompetitionSkeleton />;
      if (searchedCompetitionCards.length === 0) {
        return (
          <div className="dtp-empty-state">
            <p className="dtp-empty-state__title">No competitions match “{trimmedQuery}”</p>
            <p>Try a different name, season, or clear the search to browse featured competitions.</p>
          </div>
        );
      }
      return (
        <div className="dbx-comp-grid">
          {searchedCompetitionCards.map((card) => (
            <CompetitionGridCard key={card.key} card={card} tally={card.id ? tallies[card.id] : undefined} />
          ))}
        </div>
      );
    }

    if (competitionsLoading) return <CompetitionSkeleton />;
    if (competitionsError) {
      return (
        <p className="dtp-error-banner" role="alert">
          {competitionsError}
        </p>
      );
    }
    if (featuredCards.length === 0) {
      return (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No competitions published yet</p>
          <p>Featured competitions will appear here as soon as they go live.</p>
        </div>
      );
    }
    return (
      <div className="dbx-comp-grid">
        {featuredCards.map((card) => (
          <CompetitionGridCard key={card.key} card={card} tally={card.id ? tallies[card.id] : undefined} />
        ))}
      </div>
    );
  };

  return (
    <div className="sb-page dbx-page">

      {/* The page's own hero was removed: ScoreboardLayout already renders the
          Figma hero (186:139) above every scoreboard route, so this was a second
          title block stacked under it. The search form is now the entry point. */}
      <form className="dbx-search" onSubmit={onSubmit} role="search">
        <span className="dbx-search__icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          className="dbx-search__input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search competitions, teams, players, matches…"
          aria-label="Search competitions, teams, matches, and players"
        />
        <button type="submit" className="dbx-search__btn" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
      )}

      <section className="dbx-section">
        <div className="dbx-section__head">
          <h2 className="dbx-section-title">Featured Competitions</h2>
          {!hasQuery && featuredCards.length > 0 && (
            <span className="dbx-section__count">{featuredCards.length} curated</span>
          )}
        </div>
        <p className="dbx-section__lead">{COMPETITIONS_INTRO}</p>
        {renderCompetitions()}
      </section>

      {hasQuery && result && result.matches.length > 0 && (
        <section className="dbx-section">
          <h2 className="dbx-section-title">Related Matches</h2>
          <div className="sb-match-grid">
            {result.matches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CompetitionSkeleton() {
  return (
    <div className="dbx-comp-grid" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="dbx-comp-card dbx-comp-card--skeleton">
          {/* Mirrors the real card so nothing shifts when data lands. */}
          <div className="dbx-comp-card__head">
            <span className="dtp-skeleton dbx-comp-card__crest-skeleton" />
            <div className="dbx-comp-card__ident">
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "70%" }} />
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "45%" }} />
            </div>
          </div>
          <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "40%" }} />
          <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "90%" }} />
          <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "55%" }} />
        </div>
      ))}
    </div>
  );
}
