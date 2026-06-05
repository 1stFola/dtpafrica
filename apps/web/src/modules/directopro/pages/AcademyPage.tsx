import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, isAbortError, type Academy } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function AcademyPage() {
  usePageTitle("Academies");
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
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

  return (
    <div className="home-page">
      <header className="page-header">
        <h1>Partner academies</h1>
        <p className="muted">Development centres in the DTP network.</p>
      </header>
      {error && (
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <div className="academy-grid" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, idx) => (
            <article key={idx} className="academy-card">
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "60%" }} />
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "40%" }} />
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "90%" }} />
            </article>
          ))}
        </div>
      )}
      {!loading && !error && academies.length === 0 && (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No academies published yet</p>
          <p>Partner academy listings will appear here once published.</p>
        </div>
      )}
      <div className="academy-grid">
        {academies.map((a) => (
          <article key={a.id} className="academy-card">
            <h3>{a.name}</h3>
            <p className="muted">
              {[a.city, a.country].filter(Boolean).join(", ")}
            </p>
            {a.description && <p>{a.description}</p>}
            {a.websiteUrl && (
              <a href={a.websiteUrl} target="_blank" rel="noreferrer" className="text-link">
                Visit website
              </a>
            )}
            <br />
            <Link to={`/academy/${a.slug}/dashboard`} className="text-link">
              Open academy dashboard
            </Link>
          </article>
        ))}
      </div>
      <p className="muted">
        Interested in partnering? <Link to="/contact">Contact us</Link>.
      </p>
    </div>
  );
}
