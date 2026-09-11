import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, isAbortError, type Academy, type ClubCompetitionEntry } from "../../../api/client";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { HIGH_FETCH_PRIORITY } from "../../../utils/imgPriority";
import { clubInitials } from "../../../utils/identity";
import { ClubShowcaseModal } from "../components/ClubShowcaseModal";

type QuickFilter = "" | "ex-intl" | "lagos";

function locationLabel(academy: Academy) {
  return [academy.city, academy.country].filter(Boolean).join(", ");
}

function loginHint(academy: Academy) {
  return academy.loginUsername ?? academy.teamSlug ?? academy.slug;
}

function loginHref(academy: Academy) {
  const redirect = `/academy/${academy.slug}/dashboard`;
  const hint = loginHint(academy);
  return `/academy/login?redirect=${encodeURIComponent(redirect)}&slug=${encodeURIComponent(hint)}`;
}

function competitionTitle(entry: ClubCompetitionEntry) {
  const year = entry.season.match(/\d{4}/)?.[0] ?? "";
  return !year || entry.competitionName.includes(year)
    ? entry.competitionName
    : `${entry.competitionName} ${year}`;
}

function matchesSearch(academy: Academy, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const seedLabel = academy.seed != null ? String(academy.seed) : "";
  return (
    academy.name.toLowerCase().includes(q) ||
    (academy.city ?? "").toLowerCase().includes(q) ||
    (academy.country ?? "").toLowerCase().includes(q) ||
    academy.slug.toLowerCase().includes(q) ||
    seedLabel.includes(q) ||
    (academy.competitions ?? []).some((entry) =>
      entry.competitionName.toLowerCase().includes(q)
    )
  );
}

function matchesQuickFilter(academy: Academy, filter: QuickFilter): boolean {
  if (filter === "ex-intl") return academy.slug.startsWith("ex-intl-");
  if (filter === "lagos") {
    const city = (academy.city ?? "").toLowerCase();
    const country = (academy.country ?? "").toLowerCase();
    return city.includes("lagos") || country.includes("lagos");
  }
  return true;
}

function hasLagosAcademies(academies: Academy[]) {
  return academies.some((academy) => matchesQuickFilter(academy, "lagos"));
}

export function AcademyPage() {
  usePageTitle("Partner Academies");
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  // ?club=<slug> opens that club's modal, so a team page can link straight to it.
  const clubParam = searchParams.get("club");
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("");
  const debouncedSearch = useDebouncedValue(searchQuery, 200);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    apiGet<Academy[]>("/home/academies", controller.signal)
      .then((rows) => {
        if (!cancelled) setAcademies(rows);
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
  }, []);

  const selectedClub = useMemo(
    () => (clubParam ? academies.find((academy) => academy.slug === clubParam) ?? null : null),
    [academies, clubParam]
  );

  const openClub = useCallback(
    (academy: Academy) => {
      const next = new URLSearchParams(searchParams);
      next.set("club", academy.slug);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const closeClub = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("club");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const filtered = useMemo(() => {
    return academies.filter((academy) => {
      if (!matchesQuickFilter(academy, quickFilter)) return false;
      return matchesSearch(academy, debouncedSearch);
    });
  }, [academies, debouncedSearch, quickFilter]);

  const hasFilters = Boolean(debouncedSearch.trim() || quickFilter);
  const showLagosChip = hasLagosAcademies(academies);

  const toggleQuickFilter = (chip: QuickFilter) => {
    setQuickFilter((prev) => (prev === chip ? "" : chip));
  };

  const countLabel = loading
    ? "Loading…"
    : filtered.length === academies.length
      ? `${academies.length} academ${academies.length === 1 ? "y" : "ies"}`
      : `${filtered.length} of ${academies.length} matching`;

  return (
    <div className="dtp-page">
      {/* Hero — Figma 115:615 */}
      <section className="dtp-hero">
        <img className="dtp-hero__media" {...HIGH_FETCH_PRIORITY} decoding="async" src="/figma/hero-clubs.webp" alt="" aria-hidden="true" />
        <div className="dtp-hero__scrim" aria-hidden="true" />
        <div className="dtp-shell dtp-hero__inner">
          <p className="dtp-eyebrow" style={{ color: "var(--dtp-lime)" }}>
            DTP Partner Network
          </p>
          <h1 className="dtp-display dtp-display--hero dtp-hero__title">Partner Academies</h1>
          <p className="dtp-lead dtp-hero__lead">
            Browse development centres in the DTP network. Sign in with your club credentials to
            open your command centre dashboard.
          </p>

          <label className="dtp-search" style={{ marginTop: "var(--dtp-space-6)" }}>
            <span className="sr-only">Search academies</span>
            <input
              className="dtp-search__input"
              type="search"
              placeholder="Search by club name, city, country, or seed..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
            />
          </label>

          <div className="dtp-chips" role="group" aria-label="Quick filters">
            <button
              type="button"
              className="dtp-chip"
              onClick={() => setQuickFilter("")}
              aria-pressed={quickFilter === ""}
            >
              All
            </button>
            <button
              type="button"
              className="dtp-chip"
              onClick={() => toggleQuickFilter("ex-intl")}
              aria-pressed={quickFilter === "ex-intl"}
            >
              Ex International Cup
            </button>
            {showLagosChip && (
              <button
                type="button"
                className="dtp-chip"
                onClick={() => toggleQuickFilter("lagos")}
                aria-pressed={quickFilter === "lagos"}
              >
                Lagos
              </button>
            )}
          </div>

          <p className="dtp-row__meta" aria-live="polite" style={{ marginTop: "var(--dtp-space-4)" }}>
            {countLabel}
          </p>
        </div>
      </section>

      {/* Directory rows */}
      <section className="dtp-band dtp-band--ink">
        <div className="dtp-shell">
          {error && (
            <p className="dtp-form__error" role="alert">
              {error}
            </p>
          )}

          <div className="dtp-rows" aria-busy={loading}>
            {loading &&
              Array.from({ length: 4 }).map((_, idx) => (
                <article key={`skeleton-${idx}`} className="dtp-row" aria-hidden="true">
                  <div className="dtp-row__media" />
                  <div>
                    <p className="dtp-row__kicker">Loading</p>
                    <h2 className="dtp-row__title">&nbsp;</h2>
                  </div>
                  <span />
                </article>
              ))}

            {!loading &&
              filtered.map((academy) => {
                const location = locationLabel(academy);
                const badges = academy.badges ?? ["Partner Academy"];
                const competitions = academy.competitions ?? [];

                return (
                  <article key={academy.id} className="dtp-row">
                    <div className="dtp-row__media">
                      {academy.logoUrl ? (
                        <img src={academy.logoUrl} alt="" loading="lazy" />
                      ) : (
                        <span
                          aria-hidden="true"
                          style={{
                            display: "grid",
                            placeItems: "center",
                            width: "100%",
                            height: "100%",
                            fontFamily: "var(--dtp-font-display)",
                            fontSize: "2.5rem",
                            color: "var(--dtp-lime)",
                          }}
                        >
                          {clubInitials(academy.name)}
                        </span>
                      )}
                    </div>

                    <div>
                      <p className="dtp-row__kicker">{badges[0] ?? "Partner Academy"}</p>
                      <h2 className="dtp-row__title">{academy.name}</h2>
                      {location && <p className="dtp-row__meta">{location}</p>}
                      {academy.description && (
                        <p className="dtp-row__meta" style={{ marginTop: "var(--dtp-space-2)" }}>
                          {academy.description}
                        </p>
                      )}
                      {academy.seed != null && (
                        <p className="dtp-row__kicker" style={{ marginTop: "var(--dtp-space-2)" }}>
                          Seed #{academy.seed}
                        </p>
                      )}
                      {competitions.length > 0 && (
                        <div className="dtp-club-competitions">
                          <p className="dtp-row__kicker">
                            {competitions.length === 1
                              ? "1 competition"
                              : `${competitions.length} competitions`}
                          </p>
                          <ul>
                            {competitions.map((entry) => (
                              <li key={entry.competitionId}>
                                <Link to={`/scoreboard/team/${entry.teamId}`}>
                                  {competitionTitle(entry)}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="dtp-club-actions">
                      {/* Only partners have a login; every club can be viewed. */}
                      {academy.loginUsername && (
                        <Link to={loginHref(academy)} className="dtp-btn dtp-btn--secondary">
                          Partner login
                        </Link>
                      )}
                      <button
                        type="button"
                        className="dtp-btn"
                        onClick={() => openClub(academy)}
                        aria-haspopup="dialog"
                      >
                        View club
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>

          {selectedClub && (
            <ClubShowcaseModal
              club={selectedClub}
              partnerLoginHref={selectedClub.loginUsername ? loginHref(selectedClub) : null}
              onClose={closeClub}
            />
          )}

          {!loading && !error && filtered.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--dtp-white)" }}>
              <p className="dtp-lead">
                {hasFilters ? "No academies match your filters" : "No academies published yet"}
              </p>
              <p className="dtp-row__meta">
                {hasFilters
                  ? "Try a different search term or clear the quick filters."
                  : "Partner academy listings will appear here once published."}
              </p>
            </div>
          )}

          <div className="dtp-band__actions" style={{ flexDirection: "column", gap: "var(--dtp-space-4)" }}>
            <p style={{ margin: 0, fontSize: "1.25rem", fontWeight: 500, color: "var(--dtp-white)" }}>
              Interested in partnering?
            </p>
            <Link to="/contact" className="dtp-btn dtp-btn--ghost">
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
