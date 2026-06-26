import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function AboutPage() {
  usePageTitle("About");
  const [content, setContent] = useState<Record<string, string>>({});

  useEffect(() => {
    apiGet<Record<string, string>>(
      "/home/content?keys=about.mission,about.vision"
    ).then(setContent);
  }, []);

  return (
    <div className="home-page">
      <header className="page-header">
        <h1>About DirectToPro Africa</h1>
        <p className="lead">
          From the streets to the stadium — verified data for African talent.
        </p>
      </header>
      <section className="about-block">
        <h2>Our mission</h2>
        <p>{content["about.mission"] ?? "Loading…"}</p>
      </section>
      <section className="about-block">
        <h2>Our vision</h2>
        <p>{content["about.vision"] ?? "Loading…"}</p>
      </section>
      <section className="about-block">
        <h2>Platform modules</h2>
        <ul className="about-modules">
          <li>
            <Link to="/featured-players">Featured players</Link> — public talent profiles
          </li>
          <li>
            <Link to="/scouting">Scouting Hub</Link> — tactical fit, Strong XI &amp; valuation
          </li>
          <li>
            <Link to="/scoreboard">ScoreBoard</Link> — live match operations
          </li>
          <li>
            <Link to="/scouting/generate">Market Value Engine</Link> — valuation confidence
          </li>
        </ul>
      </section>
    </div>
  );
}
