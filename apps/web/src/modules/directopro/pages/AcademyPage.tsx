import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, type Academy } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function AcademyPage() {
  usePageTitle("Academies");
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Academy[]>("/home/academies")
      .then(setAcademies)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="home-page">
      <header className="page-header">
        <h1>Partner academies</h1>
        <p className="muted">Development centres in the DTP network.</p>
      </header>
      {error && <p className="form-error">{error}</p>}
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
          </article>
        ))}
      </div>
      <p className="muted">
        Interested in partnering? <Link to="/contact">Contact us</Link>.
      </p>
    </div>
  );
}
