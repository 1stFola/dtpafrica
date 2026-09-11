import { useLayoutEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";

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

/** The indicator's box: offset from the bar's left edge, and width. */
type Indicator = { x: number; w: number };

/* Overview renders the bar inside its Match Centre section and every other tab
   renders it under the hero, so switching tabs can mount a new bar. The last
   position is kept here so the new bar's indicator starts where the old one
   stood and slides across, instead of appearing already in place. */
let lastIndicator: Indicator | null = null;

/** Each side of the label the indicator reaches, as the frame draws it. */
const INDICATOR_BLEED = 24;

function measure(nav: HTMLElement): Indicator | null {
  const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
  if (!active) return null;
  // Never past the bar's left end, where the first tab's bleed would be
  // clipped on narrow screens; the frame draws Overview's starting there too.
  const left = Math.max(0, active.offsetLeft - INDICATOR_BLEED);
  const right = active.offsetLeft + active.offsetWidth + INDICATOR_BLEED;
  return { x: left, w: right - left };
}

function place(el: HTMLElement, at: Indicator | null) {
  el.hidden = !at;
  if (!at) return;
  el.style.setProperty("--sb-tab-x", `${at.x}px`);
  el.style.setProperty("--sb-tab-w", `${at.w}px`);
}

export function ScoreboardTabs() {
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const { pathname } = useLocation();

  /* Positioned straight on the element, not through state: the start position
     has to be applied and flushed before the target is set, in one pass, or
     the browser never sees a change to transition. Waiting a frame instead
     stalls whenever frames stop, as they do in a background tab. */
  useLayoutEffect(() => {
    const nav = navRef.current;
    const el = indicatorRef.current;
    if (!nav || !el) return;
    const target = measure(nav);
    const from = lastIndicator;
    if (target) lastIndicator = target;

    if (target && from && (from.x !== target.x || from.w !== target.w)) {
      el.classList.remove("is-animated");
      place(el, from);
      void el.offsetWidth; // commit the start position
      el.classList.add("is-animated");
    }
    place(el, target);
  }, [pathname]);

  // Labels change width as the web font loads and as the bar reflows.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const el = indicatorRef.current;
    if (!nav || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = measure(nav);
      // Observing reports once straight away; with nothing moved, leave a
      // slide that has just started to finish.
      if (!next || (lastIndicator && lastIndicator.x === next.x && lastIndicator.w === next.w)) return;
      lastIndicator = next;
      el.classList.remove("is-animated");
      place(el, next);
    });
    observer.observe(nav);
    nav.querySelectorAll("a").forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, []);

  return (
    <nav ref={navRef} className="sb-tabs" aria-label="ScoreBoard sections">
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
      <span ref={indicatorRef} className="sb-tabs__indicator" aria-hidden="true" hidden />
    </nav>
  );
}
