import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchAcademyDirectory,
  type AcademyDirectoryEntry,
} from "../../../api/academy-auth";
import { isAbortError } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAcademyAuth } from "../AcademyAuthContext";

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

function matchesQuery(entry: AcademyDirectoryEntry, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const seedLabel = entry.seed != null ? String(entry.seed) : "";
  return (
    entry.name.toLowerCase().includes(q) ||
    entry.city.toLowerCase().includes(q) ||
    entry.slug.toLowerCase().includes(q) ||
    seedLabel.includes(q)
  );
}

export function AcademyClubDirectoryPage() {
  usePageTitle("Club directory");
  const { logout, academy } = useAcademyAuth();
  const [rows, setRows] = useState<AcademyDirectoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchAcademyDirectory(controller.signal)
      .then(setRows)
      .catch((e) => {
        if (!isAbortError(e)) setError(String(e));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const filtered = useMemo(
    () => rows.filter((row) => matchesQuery(row, query)),
    [rows, query]
  );

  return (
    <div className="academy-dir-page">
      <header className="academy-dir-header">
        <div>
          <p className="academy-dir-eyebrow">Ex Internationals ecosystem</p>
          <h1>Club directory</h1>
          <p className="academy-dir-lead">
            Browse participant academies, compare seeds, and open any command centre.
          </p>
        </div>
        <div className="academy-dir-header__actions">
          {academy && (
            <span className="academy-dir-session muted">
              Signed in as <strong>{academy.loginUsername ?? academy.slug}</strong>
            </span>
          )}
          <button type="button" className="academy-dir-logout" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <div className="academy-dir-toolbar">
        <label className="academy-dir-search">
          <span className="sr-only">Search clubs</span>
          <input
            type="search"
            placeholder="Search by club name, city, or seed…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
        <p className="academy-dir-count muted" aria-live="polite">
          {loading ? "Loading…" : `${filtered.length} of ${rows.length} clubs`}
        </p>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div
        className="academy-dir-grid"
        data-count={filtered.length}
        aria-busy={loading}
      >
        {filtered.map((club) => (
          <article key={club.id} className="academy-dir-card">
            <div className="academy-dir-card__top">
              <div className="academy-dir-card__logo" aria-hidden="true">
                {club.logoUrl ? (
                  <img src={club.logoUrl} alt="" />
                ) : (
                  <span>{academyInitials(club.name)}</span>
                )}
              </div>
              {club.seed != null && (
                <span className="academy-dir-card__seed" title="Tournament seed">
                  #{club.seed}
                </span>
              )}
            </div>
            <h2>{club.name}</h2>
            <p className="academy-dir-card__city">{club.city}</p>
            <ul className="academy-dir-card__badges">
              {club.badges.map((badge) => (
                <li key={badge}>{badge}</li>
              ))}
            </ul>
            <Link
              to={`/academy/${club.slug}/dashboard`}
              className="academy-dir-card__cta"
            >
              Open dashboard
            </Link>
          </article>
        ))}
      </div>

      {!loading && filtered.length === 0 && !error && (
        <p className="academy-dir-empty muted">No clubs match your search.</p>
      )}
    </div>
  );
}
