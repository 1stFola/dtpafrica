import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, isAbortError, type Academy } from "../../../api/client";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { usePageTitle } from "../../../hooks/usePageTitle";

type QuickFilter = "" | "ex-intl" | "lagos";

function academyInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "AC";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

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

function matchesSearch(academy: Academy, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const seedLabel = academy.seed != null ? String(academy.seed) : "";
  return (
    academy.name.toLowerCase().includes(q) ||
    (academy.city ?? "").toLowerCase().includes(q) ||
    (academy.country ?? "").toLowerCase().includes(q) ||
    academy.slug.toLowerCase().includes(q) ||
    seedLabel.includes(q)
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
  const [searchQuery, setSearchQuery] = useState("");
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
    <div className="partners-academies-page">
      <header className="partners-academies-hero">
        <p className="partners-academies-eyebrow">DTP partner network</p>
        <h1>Partner Academies</h1>
        <p className="partners-academies-lead">
          Browse development centres in the DTP network. Sign in with your club
          credentials to open your command centre dashboard.
        </p>
      </header>

      <div className="partners-academies-toolbar">
        <label className="partners-academies-search">
          <span className="sr-only">Search academies</span>
          <input
            type="search"
            placeholder="Search by club name, city, country, or seed…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
        <p className="partners-academies-count" aria-live="polite">
          {countLabel}
        </p>
      </div>

      <div
        className="partners-academies-chips"
        role="group"
        aria-label="Quick filters"
      >
        <button
          type="button"
          className={
            quickFilter === ""
              ? "partners-academies-chip partners-academies-chip--active"
              : "partners-academies-chip"
          }
          onClick={() => setQuickFilter("")}
          aria-pressed={quickFilter === ""}
        >
          All
        </button>
        <button
          type="button"
          className={
            quickFilter === "ex-intl"
              ? "partners-academies-chip partners-academies-chip--active"
              : "partners-academies-chip"
          }
          onClick={() => toggleQuickFilter("ex-intl")}
          aria-pressed={quickFilter === "ex-intl"}
        >
          Ex Internationals Cup
        </button>
        {showLagosChip && (
          <button
            type="button"
            className={
              quickFilter === "lagos"
                ? "partners-academies-chip partners-academies-chip--active"
                : "partners-academies-chip"
            }
            onClick={() => toggleQuickFilter("lagos")}
            aria-pressed={quickFilter === "lagos"}
          >
            Lagos
          </button>
        )}
      </div>

      {error && (
        <p className="partners-academies-error" role="alert">
          {error}
        </p>
      )}

      <div
        className="partners-academies-grid"
        data-count={filtered.length}
        aria-busy={loading}
      >
        {loading &&
          Array.from({ length: 6 }).map((_, idx) => (
            <article
              key={`skeleton-${idx}`}
              className="partners-academies-card partners-academies-card--skeleton"
              aria-hidden="true"
            >
              <span className="partners-academies-skeleton partners-academies-skeleton--logo" />
              <span className="partners-academies-skeleton partners-academies-skeleton--line" />
              <span className="partners-academies-skeleton partners-academies-skeleton--line partners-academies-skeleton--short" />
              <span className="partners-academies-skeleton partners-academies-skeleton--pill" />
            </article>
          ))}

        {!loading &&
          filtered.map((academy) => {
            const location = locationLabel(academy);
            const isExIntl = academy.slug.startsWith("ex-intl-");
            const badges = academy.badges ?? ["Partner Academy"];

            return (
              <article key={academy.id} className="partners-academies-card">
                <div className="partners-academies-card__top">
                  <div className="partners-academies-card__logo" aria-hidden="true">
                    {academy.logoUrl ? (
                      <img src={academy.logoUrl} alt="" />
                    ) : (
                      <span>{academyInitials(academy.name)}</span>
                    )}
                  </div>
                  {academy.seed != null && (
                    <span
                      className={
                        isExIntl
                          ? "partners-academies-card__seed partners-academies-card__seed--gold"
                          : "partners-academies-card__seed"
                      }
                      title="Tournament seed"
                    >
                      #{academy.seed}
                    </span>
                  )}
                </div>

                <h2>{academy.name}</h2>
                {location && (
                  <p className="partners-academies-card__location">{location}</p>
                )}

                <ul className="partners-academies-card__badges">
                  {badges.map((badge) => (
                    <li
                      key={badge}
                      className={
                        badge.includes("Ex Internationals")
                          ? "partners-academies-card__badge partners-academies-card__badge--gold"
                          : "partners-academies-card__badge"
                      }
                    >
                      {badge}
                    </li>
                  ))}
                </ul>

                {academy.description && (
                  <p className="partners-academies-card__desc">{academy.description}</p>
                )}

                <div className="partners-academies-card__actions">
                  <Link to={loginHref(academy)} className="partners-academies-card__cta">
                    {academy.loginUsername ? "Enter club portal" : "Sign in"}
                  </Link>
                  {academy.websiteUrl && (
                    <a
                      href={academy.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="partners-academies-card__link"
                    >
                      Website
                    </a>
                  )}
                </div>
              </article>
            );
          })}
      </div>

      {!loading && !error && filtered.length === 0 && (
        <div className="partners-academies-empty">
          <p className="partners-academies-empty__title">
            {hasFilters ? "No academies match your filters" : "No academies published yet"}
          </p>
          <p>
            {hasFilters
              ? "Try a different search term or clear the quick filters."
              : "Partner academy listings will appear here once published."}
          </p>
        </div>
      )}

      <p className="partners-academies-footer">
        Interested in partnering? <Link to="/contact">Contact us</Link>.
      </p>
    </div>
  );
}
