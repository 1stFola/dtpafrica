import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, isAbortError, type Academy } from "../../../api/client";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { HIGH_FETCH_PRIORITY } from "../../../utils/imgPriority";
import { clubInitials, stableHue } from "../../../utils/identity";
import { ClubShowcaseModal } from "../components/ClubShowcaseModal";

type QuickFilter = "" | "ex-intl" | "lagos";

/** Four rows of three, as the Figma grid lays out one page. */
const PAGE_SIZE = 12;

function loginHint(academy: Academy) {
  return academy.loginUsername ?? academy.teamSlug ?? academy.slug;
}

function loginHref(academy: Academy) {
  const redirect = `/academy/${academy.slug}/dashboard`;
  const hint = loginHint(academy);
  return `/academy/login?redirect=${encodeURIComponent(redirect)}&slug=${encodeURIComponent(hint)}`;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
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

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 12h14m-6-6 6 6-6 6"
      />
    </svg>
  );
}

/** The round flag on the card image. Nigeria is drawn; elsewhere shows its initials. */
function CountryFlag({ country }: { country: string | null }) {
  const name = country?.trim();
  if (!name) return null;
  const nigeria = /nigeria/i.test(name);
  return (
    <span
      className={`dtp-academy-card__flag${nigeria ? " dtp-academy-card__flag--ng" : ""}`}
      role="img"
      aria-label={name}
      title={name}
    >
      {nigeria ? null : name.slice(0, 2).toUpperCase()}
    </span>
  );
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
  const [page, setPage] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => setPage(0), [debouncedSearch, quickFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Scroll back to the top of the grid once the new page has rendered; doing
  // it on click aimed at where the grid sat before a shorter page shrank it.
  const scrollOnPageChange = useRef(false);
  useEffect(() => {
    if (!scrollOnPageChange.current) return;
    scrollOnPageChange.current = false;
    gridRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }, [currentPage]);

  const goToPage = (index: number) => {
    if (index === currentPage) return;
    scrollOnPageChange.current = true;
    setPage(index);
  };

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
    <div className="dtp-page dtp-academies">
      {/* Hero — Figma 115:615 */}
      <section className="dtp-hero">
        <img className="dtp-hero__media" {...HIGH_FETCH_PRIORITY} decoding="async" src="/figma/hero-clubs.webp" alt="" aria-hidden="true" />
        <div className="dtp-hero__scrim" aria-hidden="true" />
        <div className="dtp-shell dtp-hero__inner">
          <p className="dtp-eyebrow" style={{ color: "var(--dtp-lime)" }}>
            DTP Partner Network
          </p>
          {/* Two lines, as Figma sets it; .dtp-hero__title is pre-line. */}
          <h1 className="dtp-display dtp-display--hero dtp-hero__title">{"Partner\nAcademies"}</h1>
          <p className="dtp-lead dtp-hero__lead">
            Browse development centres in the DTP network. Sign in with your club credentials to
            open your command centre dashboard.
          </p>

          <label className="dtp-search">
            <span className="dtp-search__icon">
              <SearchIcon />
            </span>
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

          <p className="sr-only" aria-live="polite">
            {countLabel}
          </p>
        </div>
      </section>

      {/* Club cards — Figma: three across, twelve to a page */}
      <section className="dtp-band dtp-band--ink">
        <div className="dtp-shell">
          {error && (
            <p className="dtp-form__error" role="alert">
              {error}
            </p>
          )}

          <div ref={gridRef} className="dtp-academy-grid" aria-busy={loading}>
            {loading &&
              Array.from({ length: 6 }).map((_, idx) => (
                <article
                  key={`skeleton-${idx}`}
                  className="dtp-academy-card dtp-academy-card--skeleton"
                  aria-hidden="true"
                >
                  <div className="dtp-academy-card__top">
                    <div className="dtp-academy-card__media" />
                  </div>
                  <div className="dtp-academy-card__body">
                    <span className="dtp-academy-card__line" />
                    <span className="dtp-academy-card__line dtp-academy-card__line--wide" />
                  </div>
                </article>
              ))}

            {!loading &&
              pageItems.map((academy) => {
                const isPartner = Boolean(academy.loginUsername);
                const kicker = academy.badges?.[0] ?? (isPartner ? "Partner Academy" : "Club");
                const hue = { "--club-hue": String(stableHue(academy.slug)) } as CSSProperties;

                return (
                  <article key={academy.id} className="dtp-academy-card" style={hue}>
                    <div className="dtp-academy-card__top">
                      <button
                        type="button"
                        className="dtp-academy-card__media"
                        onClick={() => openClub(academy)}
                        aria-haspopup="dialog"
                        aria-label={`View ${academy.name}`}
                      >
                        {academy.logoUrl ? (
                          <>
                            {/* A blurred copy fills the banner behind the crest. */}
                            <img
                              className="dtp-academy-card__backdrop"
                              src={academy.logoUrl}
                              alt=""
                              aria-hidden="true"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                            <img
                              className="dtp-academy-card__logo"
                              src={academy.logoUrl}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          </>
                        ) : (
                          <span className="dtp-academy-card__initials" aria-hidden="true">
                            {clubInitials(academy.name)}
                          </span>
                        )}
                        <CountryFlag country={academy.country} />
                      </button>
                      <h2 className="dtp-academy-card__name" title={academy.name}>
                        {academy.name}
                      </h2>
                    </div>

                    <div className="dtp-academy-card__body">
                      <div className="dtp-academy-card__meta">
                        <span>
                          {kicker}
                          {academy.city ? ` · ${academy.city}` : ""}
                        </span>
                        {/* Partners' main action is their portal; the club view stays one click away. */}
                        {isPartner && (
                          <button
                            type="button"
                            className="dtp-academy-card__view"
                            onClick={() => openClub(academy)}
                            aria-haspopup="dialog"
                          >
                            View club
                          </button>
                        )}
                      </div>

                      {isPartner ? (
                        <Link to={loginHref(academy)} className="dtp-academy-card__cta">
                          Enter Club Portal
                          <span className="dtp-academy-card__arrow">
                            <ArrowIcon />
                          </span>
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="dtp-academy-card__cta"
                          onClick={() => openClub(academy)}
                          aria-haspopup="dialog"
                        >
                          View Club
                          <span className="dtp-academy-card__arrow">
                            <ArrowIcon />
                          </span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
          </div>

          {!loading && pageCount > 1 && (
            <nav className="dtp-academy-pager" aria-label="Academy pages">
              {Array.from({ length: pageCount }).map((_, index) => (
                <button
                  key={index}
                  type="button"
                  className="dtp-academy-pager__bar"
                  aria-label={`Page ${index + 1} of ${pageCount}`}
                  aria-current={index === currentPage ? "page" : undefined}
                  onClick={() => goToPage(index)}
                />
              ))}
            </nav>
          )}

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

          <div className="dtp-band__actions dtp-academy-partner">
            <p className="dtp-academy-partner__title">Interested In Partnering?</p>
            <Link to="/contact" className="dtp-btn dtp-btn--ghost">
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
