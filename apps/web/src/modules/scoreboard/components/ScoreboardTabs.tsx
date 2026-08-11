import { NavLink } from "react-router-dom";

/* Figma "Scorebaord" 186:139 -> Title 191:433 > Menu 191:439.
   The section tabs are plain text labels sitting on a 5px rule, not pills:
   Inter 500 / 18.8px / lh 22.8, active #ffffff, resting #a4a4a4, 47px apart.
   The rule is #2e3034 with a #4cccf3 indicator under the active label.

   Figma also draws a fifth tab, "Fun Football", which has no route in the app
   yet — it is left out rather than shipped as a link to nowhere. */

const TABS = [
  { to: "/scoreboard", end: true, label: "Overview" },
  { to: "/scoreboard/browse", label: "Competitions" },
  { to: "/scoreboard/highlights", label: "Highlights" },
  { to: "/scoreboard/live", label: "Live Games" },
] as const;

export function ScoreboardTabs() {
  return (
    <nav className="sb-tabs" aria-label="ScoreBoard sections">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={"end" in tab ? tab.end : undefined}
          className={({ isActive }) => (isActive ? "sb-tabs__tab is-active" : "sb-tabs__tab")}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
