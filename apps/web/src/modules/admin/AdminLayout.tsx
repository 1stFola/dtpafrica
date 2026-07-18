import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { BrandLogo } from "../../components/BrandLogo";
import { adminApi, type SupportSummary } from "../../api/admin";
import { useAdminAuth } from "./AdminAuthContext";
import { ADMIN_NAV_PERMISSIONS, canAccessNav } from "./admin-permissions";

const links = [
  { to: "/admin", end: true, label: "Dashboard", icon: "◆" },
  {
    to: "/admin/player-stats-extractor",
    label: "Tracker Stats Extractor",
    icon: "CSV",
    variant: "outline",
  },
  { to: "/admin/inbox", label: "Inbox", icon: "✉" },
  { to: "/admin/players", label: "Players", icon: "⚽" },
  { to: "/admin/calibration", label: "Calibration", icon: "◎" },
  { to: "/admin/homepage", label: "Homepage", icon: "⌂" },
  { to: "/admin/ads", label: "Ads", icon: "▣" },
  { to: "/admin/academies", label: "Academies", icon: "▦" },
  { to: "/admin/content", label: "Content", icon: "⎘" },
  { to: "/admin/database", label: "Database", icon: "⛁" },
  { to: "/admin/ops-support", label: "Ops Support", icon: "AI" },
  { to: "/admin/blog", label: "Blog", icon: "✎" },
  { to: "/admin/scoreboard", label: "ScoreBoard", icon: "⏱" },
];

const settingsLinks = [
  { to: "/admin/settings/roles", label: "Roles", icon: "⚿", permission: "admin.roles.manage" },
  { to: "/admin/settings/users", label: "Users", icon: "👤", permission: "admin.users.manage" },
];

export function AdminLayout() {
  const { logout, session } = useAdminAuth();
  const location = useLocation();
  const isScoreboard = location.pathname.startsWith("/admin/scoreboard");
  const [supportSummary, setSupportSummary] = useState<SupportSummary | null>(null);

  const visibleLinks = links.filter((l) =>
    canAccessNav(
      session?.permissions ?? [],
      session?.method ?? "jwt",
      ADMIN_NAV_PERMISSIONS[l.to]
    )
  );

  const visibleSettings = settingsLinks.filter((l) =>
    session?.method === "api_key" || session?.permissions.includes(l.permission)
  );

  useEffect(() => {
    const canReadSupport =
      session?.method === "api_key" || session?.permissions.includes("ops.support.read");
    if (!canReadSupport) {
      setSupportSummary(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      adminApi
        .supportSummary()
        .then((summary) => {
          if (!cancelled) setSupportSummary(summary);
        })
        .catch(() => {
          if (!cancelled) setSupportSummary(null);
        });
    };
    load();
    const interval = window.setInterval(load, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [session?.method, session?.permissions]);

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar__brand">
          <Link to="/admin" className="admin-topbar__brand-link">
            <BrandLogo variant="white-horizontal" size="admin" />
          </Link>
          <span className="admin-badge">CMS</span>
          {session?.roleName && (
            <span className="admin-topbar__role muted">{session.roleName}</span>
          )}
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
              {visibleLinks.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    [
                      "admin-sb-sidebar-link",
                      l.variant === "outline" ? "admin-sb-sidebar-link--outline" : "",
                      isActive ? "active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")
                  }
                >
                  <span className="admin-sb-sidebar-link__icon" aria-hidden="true">
                    {l.icon}
                  </span>
                  {l.label}
                  {l.to === "/admin/ops-support" && supportSummary && (
                    <span
                      className={[
                        "admin-support-nav-badge",
                        supportSummary.critical > 0 ? "is-critical" : "",
                        !supportSummary.ready ? "is-setup" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      title={
                        supportSummary.ready
                          ? `${supportSummary.open} open support report(s)`
                          : supportSummary.setupRequired
                      }
                    >
                      {supportSummary.ready
                        ? supportSummary.critical > 0
                          ? `${supportSummary.critical}!`
                          : supportSummary.open
                        : "!"}
                    </span>
                  )}
                </NavLink>
              ))}
              {visibleSettings.length > 0 && (
                <>
                  <div className="admin-sb-sidebar-divider" aria-hidden="true" />
                  <p className="admin-sb-sidebar-label muted">Settings</p>
                  {visibleSettings.map((l) => (
                    <NavLink
                      key={l.to}
                      to={l.to}
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
                </>
              )}
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
