import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, type AdminStats } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { AdminPageHeader } from "../components/AdminPageHeader";

const cards: Array<{ to: string; title: string; desc: string; tag: string }> = [
  {
    to: "/admin/inbox",
    title: "Inbox",
    desc: "Read, archive, and delete contact submissions",
    tag: "Messages",
  },
  {
    to: "/admin/players",
    title: "Manage players",
    desc: "Approve registrations, feature talent, publish profiles",
    tag: "Directory",
  },
  {
    to: "/admin/homepage",
    title: "Homepage",
    desc: "Announcements, events, videos, and wins wall copy",
    tag: "Marketing",
  },
  {
    to: "/admin/ads",
    title: "Ad placements",
    desc: "Enable slots, sponsor URLs, and fallback creatives",
    tag: "Monetization",
  },
  {
    to: "/admin/academies",
    title: "Academies",
    desc: "Create and publish partner academy listings",
    tag: "Partners",
  },
  {
    to: "/admin/blog",
    title: "Blog posts",
    desc: "Create and publish news",
    tag: "Content",
  },
  {
    to: "/admin/content",
    title: "Static content",
    desc: "Edit reusable marketing copy",
    tag: "CMS",
  },
  {
    to: "/admin/database",
    title: "Database seed",
    desc: "Pull bundled seed data into the live database",
    tag: "Ops",
  },
  {
    to: "/admin/scoreboard",
    title: "ScoreBoard ops",
    desc: "Entities, rosters, highlights, match center, spotter tablet",
    tag: "Live ops",
  },
];

export function AdminDashboardPage() {
  usePageTitle("Admin");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .stats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Dashboard"
        description="Publish players, manage homepage content, and triage contact messages."
        crumbs={[{ label: "Overview" }]}
      />

      {loading ? (
        <div className="admin-sb-hub-stats" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="admin-sb-hub-stat">
              <span className="admin-sb-skeleton admin-sb-skeleton--stat" />
              <span className="admin-sb-skeleton admin-sb-skeleton--stat-label" />
            </div>
          ))}
        </div>
      ) : stats ? (
        <div className="admin-sb-hub-stats" aria-label="CMS entity counts">
          <div className="admin-sb-hub-stat">
            <strong>{stats.players}</strong>
            <span>Players</span>
          </div>
          <div className="admin-sb-hub-stat">
            <strong>{stats.pendingRegistrations}</strong>
            <span>Pending registration</span>
          </div>
          <div className="admin-sb-hub-stat">
            <strong>{stats.featuredPlayers}</strong>
            <span>Featured</span>
          </div>
          <div className="admin-sb-hub-stat">
            <strong>{stats.publicProfiles}</strong>
            <span>Public profiles</span>
          </div>
          <div className="admin-sb-hub-stat">
            <strong>{stats.blogPublished}</strong>
            <span>Blog published</span>
          </div>
          <div className="admin-sb-hub-stat">
            <strong>{stats.blogDrafts}</strong>
            <span>Blog drafts</span>
          </div>
          <div className="admin-sb-hub-stat admin-sb-hub-stat--live">
            <strong>{stats.contactUnread}</strong>
            <span>Unread inbox</span>
          </div>
          <div className="admin-sb-hub-stat">
            <strong>{stats.academyPublished}</strong>
            <span>Academies live</span>
          </div>
        </div>
      ) : null}

      <div className="admin-sb-hub-grid">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className="admin-sb-hub-card sip-card">
            <span className="admin-sb-hub-card__tag">{c.tag}</span>
            <h3>{c.title}</h3>
            <p>{c.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
