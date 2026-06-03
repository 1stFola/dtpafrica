import { NavLink, Outlet } from "react-router-dom";
import { PRODUCT_MODULES } from "@dtp/domain";
import { BrandLogo } from "../components/BrandLogo";

export function AppShell() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-header">
        <NavLink to="/" className="brand">
          <BrandLogo variant="white-horizontal" size="header" />
        </NavLink>
        <nav className="app-nav" aria-label="Main">
          {PRODUCT_MODULES.map((mod) => (
            <NavLink
              key={mod.id}
              to={mod.path}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {mod.navLabel}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="app-body app-body--no-rail">
        <main className="app-main" id="main-content">
          <Outlet />
        </main>
      </div>
      <footer className="app-footer">
        <NavLink to="/" className="app-footer__brand">
          <BrandLogo variant="white-horizontal" size="footer" />
        </NavLink>
        <nav className="footer-nav" aria-label="Footer">
          <NavLink to="/about">About</NavLink>
          <NavLink to="/blog">Blog</NavLink>
          <NavLink to="/academy">Academies</NavLink>
          <NavLink to="/contact">Contact</NavLink>
          <NavLink to="/register">Register</NavLink>
        </nav>
        <p>© {new Date().getFullYear()} DirectToPro Africa</p>
      </footer>
    </div>
  );
}
