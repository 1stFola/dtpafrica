import { Link } from "react-router-dom";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { useAdminScoreboardContext } from "../AdminScoreboardLayout";

const cards: Array<{
  to: string;
  title: string;
  desc: string;
  tag: string;
  external?: boolean;
  publicPreview?: string;
}> = [
  {
    to: "/admin/scoreboard/highlights-manager",
    title: "Latest highlights",
    desc: "Publish landing-page video cards — title, YouTube URL, MM:SS duration, competition tag.",
    tag: "Content",
    publicPreview: "/scoreboard/highlights",
  },
  {
    to: "/admin/scoreboard/entities",
    title: "Master records",
    desc: "Competitions, teams, player directory, CSV seeders, and squad export.",
    tag: "Directory",
  },
  {
    to: "/admin/scoreboard/roster",
    title: "Matchday roster",
    desc: "Build XI + bench per team. GK clean sheets logged here only. Lock lineups on spotter.",
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
    title: "Match clips",
    desc: "Attach YouTube clips with timeline minutes to specific fixtures.",
    tag: "Match media",
  },
  {
    to: "/spotter-tablet",
    title: "Stadium spotter",
    desc: "Tablet-first pitch tagging after admin rosters are saved and locked.",
    tag: "Field",
    external: true,
  },
];

export function AdminScoreboardHubPage() {
  usePageTitle("Admin — ScoreBoard");
  const { stats } = useAdminScoreboardContext();
  const statsLoading = !stats;

  return (
    <section className="admin-sb-section">
      <AdminSbPageHeader
        title="Operations dashboard"
        description="Competition lifecycle: roster → lock lineups → live events → full time → standings, career stats, and published highlights."
        crumbs={[{ label: "Overview" }]}
      />

      {statsLoading ? (
        <div className="admin-sb-hub-stats" aria-busy="true" aria-label="Loading entity counts">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="admin-sb-hub-stat">
              <span className="admin-sb-skeleton admin-sb-skeleton--stat" />
              <span className="admin-sb-skeleton admin-sb-skeleton--stat-label" />
            </div>
          ))}
        </div>
      ) : stats ? (
        <div className="admin-sb-hub-stats" aria-label="ScoreBoard entity counts">
          <div className="admin-sb-hub-stat">
            <strong>{stats.competitions}</strong>
            <span>Competitions</span>
          </div>
          <div className="admin-sb-hub-stat">
            <strong>{stats.teams}</strong>
            <span>Teams</span>
          </div>
          <div className="admin-sb-hub-stat">
            <strong>{stats.matches}</strong>
            <span>Matches</span>
          </div>
          <div className="admin-sb-hub-stat">
            <strong>{stats.highlights}</strong>
            <span>Highlights</span>
          </div>
          <div className="admin-sb-hub-stat admin-sb-hub-stat--live">
            <strong>{stats.liveMatches}</strong>
            <span>Live now</span>
          </div>
        </div>
      ) : null}

      <div className="admin-sb-hub-grid">
        {cards.map((c) => (
          <div
            key={c.to}
            className={`admin-sb-hub-card sip-card ${c.external ? "admin-sb-hub-card--external" : ""}`}
          >
            {c.external ? (
              <a href={c.to} className="admin-sb-hub-card__link">
                <span className="admin-sb-hub-card__tag">{c.tag}</span>
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
                <span className="admin-sb-hub-card__arrow">Open ↗</span>
              </a>
            ) : (
              <Link to={c.to} className="admin-sb-hub-card__link">
                <span className="admin-sb-hub-card__tag">{c.tag}</span>
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
              </Link>
            )}
            {c.publicPreview && (
              <a
                href={c.publicPreview}
                target="_blank"
                rel="noreferrer"
                className="admin-sb-hub-card__preview text-link"
              >
                View public tab ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
