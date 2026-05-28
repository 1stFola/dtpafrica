import { Link } from "react-router-dom";
import { usePageTitle } from "../../../../hooks/usePageTitle";

const cards: Array<{
  to: string;
  title: string;
  desc: string;
  tag: string;
  external?: boolean;
}> = [
  {
    to: "/admin/scoreboard/entities",
    title: "Master records",
    desc: "Competitions, teams, players, CSV seeders, and squad export for calibration.",
    tag: "Directory",
  },
  {
    to: "/admin/scoreboard/roster",
    title: "Matchday roster",
    desc: "Submit XI + bench per team. Links to player profiles on save.",
    tag: "Pre-match",
  },
  {
    to: "/admin/scoreboard/match-center",
    title: "Match center",
    desc: "Live timeline, full-time processing, standings refresh, and SIP ingest.",
    tag: "Live ops",
  },
  {
    to: "/admin/scoreboard/highlights",
    title: "Highlights",
    desc: "Upload clips with timeline minute metadata tied to matches.",
    tag: "Content",
  },
  {
    to: "/spotter-tablet",
    title: "Stadium spotter",
    desc: "Tablet-first pitch tagging. Lock lineups before live events.",
    tag: "Field",
    external: true,
  },
];

export function AdminScoreboardHubPage() {
  usePageTitle("Admin — ScoreBoard");

  return (
    <section className="admin-sb-section">
      <p className="admin-sb-lead muted">
        Competition lifecycle: roster → lock lineups → live events → full time → standings
        and career stats.
      </p>
      <div className="admin-sb-hub-grid">
        {cards.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className={`admin-sb-hub-card sip-card ${c.external ? "admin-sb-hub-card--external" : ""}`}
          >
            <span className="admin-sb-hub-card__tag">{c.tag}</span>
            <h3>{c.title}</h3>
            <p>{c.desc}</p>
            {c.external && <span className="admin-sb-hub-card__arrow">Open ↗</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}
