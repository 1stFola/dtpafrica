import { NavLink, Outlet } from "react-router-dom";
import { Link } from "react-router-dom";
import { useAdminAuth } from "./AdminAuthContext";

const links = [
  { to: "/admin", end: true, label: "Dashboard" },
  { to: "/admin/inbox", label: "Inbox" },
  { to: "/admin/players", label: "Players" },
  { to: "/admin/calibration", label: "Calibration" },
  { to: "/admin/homepage", label: "Homepage" },
  { to: "/admin/academies", label: "Academies" },
  { to: "/admin/content", label: "Content" },
  { to: "/admin/blog", label: "Blog" },
];

export function AdminLayout() {
  const { logout } = useAdminAuth();

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar__brand">
          <Link to="/admin">DTP Admin</Link>
          <span className="admin-badge">CMS</span>
        </div>
        <nav className="admin-nav" aria-label="Admin">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                isActive ? "admin-nav-link active" : "admin-nav-link"
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-topbar__actions">
          <Link to="/" className="text-link">
            View site
          </Link>
          <button type="button" className="admin-logout" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
