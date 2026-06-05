import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, type AdminStats } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function AdminDashboardPage() {
  usePageTitle("Admin");
  const [stats, setStats] = useState<AdminStats | null>(null);

  useEffect(() => {
    adminApi.stats().then(setStats).catch(() => {});
  }, []);

  return (
    <div className="admin-page">
      <h1>Dashboard</h1>
      <p className="muted">
        Publish players, manage homepage content, and triage contact messages.
      </p>
      {!stats && (
        <div className="admin-stat-grid" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="admin-stat">
              <span className="dtp-skeleton" style={{ width: "3rem", height: "1.75rem" }} />
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "60%", marginBottom: 0 }} />
            </div>
          ))}
        </div>
      )}
      {stats && (
        <div className="admin-stat-grid">
          <div className="admin-stat">
            <strong>{stats.players}</strong>
            <span>Players</span>
          </div>
          <div className="admin-stat">
            <strong>{stats.pendingRegistrations}</strong>
            <span>Pending registration</span>
          </div>
          <div className="admin-stat">
            <strong>{stats.featuredPlayers}</strong>
            <span>Featured</span>
          </div>
          <div className="admin-stat">
            <strong>{stats.publicProfiles}</strong>
            <span>Public profiles</span>
          </div>
          <div className="admin-stat">
            <strong>{stats.blogPublished}</strong>
            <span>Blog published</span>
          </div>
          <div className="admin-stat">
            <strong>{stats.blogDrafts}</strong>
            <span>Blog drafts</span>
          </div>
          <div className="admin-stat">
            <strong>{stats.contactUnread}</strong>
            <span>Unread inbox</span>
          </div>
          <div className="admin-stat">
            <strong>{stats.academyPublished}</strong>
            <span>Academies live</span>
          </div>
        </div>
      )}
      <div className="sb-quick-links">
        <Link to="/admin/inbox" className="sip-card">
          <h3>Inbox</h3>
          <p>Read, archive, and delete contact submissions</p>
        </Link>
        <Link to="/admin/players" className="sip-card">
          <h3>Manage players</h3>
          <p>Approve registrations, feature talent, publish profiles</p>
        </Link>
        <Link to="/admin/homepage" className="sip-card">
          <h3>Homepage</h3>
          <p>Announcements, events, videos, and wins wall copy</p>
        </Link>
        <Link to="/admin/ads" className="sip-card">
          <h3>Ad placements</h3>
          <p>Enable slots, sponsor URLs, and fallback creatives</p>
        </Link>
        <Link to="/admin/academies" className="sip-card">
          <h3>Academies</h3>
          <p>Create and publish partner academy listings</p>
        </Link>
        <Link to="/admin/blog" className="sip-card">
          <h3>Blog posts</h3>
          <p>Create and publish news</p>
        </Link>
        <Link to="/admin/content" className="sip-card">
          <h3>Static content</h3>
          <p>Edit reusable marketing copy</p>
        </Link>
        <Link to="/admin/scoreboard" className="sip-card">
          <h3>ScoreBoard ops</h3>
          <p>Entities, rosters, highlights, match center, spotter tablet</p>
        </Link>
      </div>
    </div>
  );
}
