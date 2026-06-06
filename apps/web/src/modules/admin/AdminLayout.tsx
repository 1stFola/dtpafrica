import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { BrandLogo } from "../../components/BrandLogo";
import { useAdminAuth } from "./AdminAuthContext";

const links = [
  { to: "/admin", end: true, label: "Dashboard", icon: "◆" },
  { to: "/admin/inbox", label: "Inbox", icon: "✉" },
  { to: "/admin/players", label: "Players", icon: "⚽" },
  { to: "/admin/calibration", label: "Calibration", icon: "◎" },
  { to: "/admin/homepage", label: "Homepage", icon: "⌂" },
  { to: "/admin/ads", label: "Ads", icon: "▣" },
  { to: "/admin/academies", label: "Academies", icon: "▦" },
  { to: "/admin/content", label: "Content", icon: "⎘" },
  { to: "/admin/database", label: "Database", icon: "⛁" },
  { to: "/admin/blog", label: "Blog", icon: "✎" },
  { to: "/admin/scoreboard", label: "ScoreBoard", icon: "⏱" },
];

export function AdminLayout() {
  const { logout } = useAdminAuth();
  const location = useLocation();
  const isScoreboard = location.pathname.startsWith("/admin/scoreboard");

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar__brand">
          <Link to="/admin" className="admin-topbar__brand-link">
            <BrandLogo variant="white-horizontal" size="admin" />
          </Link>
          <span className="admin-badge">CMS</span>
        </div>
        <div className="admin-topbar__actions">
          <Link to="/" className="text-link">
            View site
          </Link>
          <button type="button" className="admin-logout" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <div className={`admin-cms-shell ${isScoreboard ? "admin-cms-shell--full" : ""}`}>
        {!isScoreboard && (
          <aside className="admin-sb-sidebar admin-cms-sidebar" aria-label="Admin sections">
            <nav className="admin-sb-sidebar-nav">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    isActive ? "admin-sb-sidebar-link active" : "admin-sb-sidebar-link"
                  }
                >
                  <span className="admin-sb-sidebar-link__icon" aria-hidden="true">
                    {l.icon}
                  </span>
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </aside>
        )}

        <main className="admin-cms-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
