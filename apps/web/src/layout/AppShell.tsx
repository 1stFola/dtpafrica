import { useEffect, useId, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { DtpLogoLockup } from "../components/DtpLogoLockup";
import { SupportReportButton } from "../components/SupportReportButton";

/* Figma "DTP" — the nav pill (1314x92) and footer (1440x627) are shared
   chrome across every public frame: Homepage 3:189, Contact 113:4,
   Clubs 115:615, Scouting Hubs 118:1711, Scoreboard 186:139,
   Featured Players 234:486, Players Profile 239:2425. */

const NAV_LINKS = [
  { to: "/scoreboard", label: "Scoreboard" },
  { to: "/scouting", label: "Scouting Hub" },
  { to: "/partners/academies", label: "Clubs" },
  { to: "/contact", label: "Contact" },
] as const;

/* Footer information architecture from the Figma footer frame. Labels whose
   routes do not exist yet (API Docs, Careers, Terms, Privacy) are omitted
   rather than pointed at dead paths — add them here as those pages land. */
const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      { to: "/scoreboard", label: "Scoreboard" },
      { to: "/scouting", label: "Scouting Hub" },
      { to: "/featured-players", label: "Featured Players" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { to: "/blog", label: "Blog" },
      { to: "/partners/academies", label: "Partnerships Base" },
      { to: "/register", label: "Register Talent" },
    ],
  },
  {
    heading: "Company",
    links: [
      { to: "/about", label: "About Us" },
      { to: "/contact", label: "Contact Us" },
    ],
  },
] as const;

const FOOTER_SOCIAL_LINKS = [
  {
    href: "https://www.instagram.com/dtp.africa/",
    label: "Instagram",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"
        />
      </svg>
    ),
  },
  {
    href: "https://www.youtube.com/@DTP.Africa",
    label: "YouTube",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
        />
      </svg>
    ),
  },
  {
    href: "https://wa.me/19452756104?text=Hello%20DirectToPro%20Africa,%20I'm%20interested%20in%20learning%20more%20about%20your%20scouting%20and%20talent%20profiling%20platform.%20How%20can%20we%20get%20started?",
    label: "WhatsApp",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
        />
      </svg>
    ),
  },
] as const;

function SiteHeader() {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Collapse the mobile disclosure whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="dtp-nav-wrap">
      <nav className="dtp-nav" aria-label="Main">
        <NavLink to="/" className="dtp-nav__brand" aria-label="DirectToPro Africa — home">
          <DtpLogoLockup className="dtp-nav__logo" />
        </NavLink>

        <button
          type="button"
          className="dtp-nav__toggle"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            {open ? (
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                d="M6 6l12 12M18 6L6 18"
              />
            ) : (
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                d="M4 7h16M4 12h16M4 17h16"
              />
            )}
          </svg>
        </button>

        <div className="dtp-nav__links" id={menuId} hidden={!open}>
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                isActive ? "dtp-nav__link is-active" : "dtp-nav__link"
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <Link to="/register" className="dtp-btn dtp-nav__cta">
          Register Talent
        </Link>
      </nav>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="dtp-footer">
      <div className="dtp-shell">
        <div className="dtp-footer__cols">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className="dtp-footer__heading">{column.heading}</h2>
              <ul className="dtp-footer__list">
                {column.links.map((link) => (
                  <li key={link.to + link.label}>
                    <NavLink to={link.to} className="dtp-footer__link">
                      {link.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h2 className="dtp-footer__heading">Socials</h2>
            <ul className="dtp-footer__list">
              {FOOTER_SOCIAL_LINKS.map((link) => (
                <li key={link.label}>
                  <a
                    className="dtp-footer__link dtp-channels__link"
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.icon}
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <hr className="dtp-footer__rule" />

        <div className="dtp-footer__base">
          <NavLink to="/" className="dtp-footer__brand" aria-label="DirectToPro Africa — home">
            <BrandLogo variant="white-horizontal" size="footer" />
          </NavLink>
          <p className="dtp-footer__copy">© {new Date().getFullYear()} DirectToPro Africa</p>
        </div>
      </div>
    </footer>
  );
}

export function AppShell() {
  return (
    <div className="app-shell dtp-page">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader />
      <div className="app-body app-body--no-rail">
        <main className="app-main" id="main-content">
          <Outlet />
        </main>
      </div>
      <SiteFooter />
      <SupportReportButton />
    </div>
  );
}
