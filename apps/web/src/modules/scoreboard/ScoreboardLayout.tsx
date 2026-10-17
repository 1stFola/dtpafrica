import { useEffect, useState, type TransitionEvent } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { LiveScoreRibbon } from "./components/LiveScoreRibbon";
import { MatchTicker } from "./components/MatchTicker";
import { ScoreboardTabs } from "./components/ScoreboardTabs";
import { heroShownFor } from "./hero-visibility";
import { AdBanner } from "../../components/AdBanner";
import { ModuleAdRails } from "../../components/ModuleAdRails";
import { creativeSizeLabel } from "../../config/adFormatSpecs";
import { useAdSlot } from "../../context/AdConfigContext";
import { HIGH_FETCH_PRIORITY } from "../../utils/imgPriority";

/** Header mobile banner only; desktop top uses `scoreboardTop` in ModuleAdRails */

/*
 * The hero's fold has three states, not two, because of the photo bleed: on Overview
 * and Competitions the photo runs on some 300px behind the ticker and tabs, which an
 * `overflow: hidden` wrapper would cut off. So the wrapper only clips while the fold is
 * closed or still opening, and lets the bleed through once the opening transition has
 * ended. Closing clips at once, which is what a fold should do.
 */
type HeroFoldState = "open" | "opening" | "closed";

/** Matches the grid-template-rows transition on `.sb-hero-fold` in dtp-figma.css. */
const HERO_FOLD_MS = 480;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ScoreboardLayout() {
  const mobileAd = useAdSlot("scoreboardLeaderboardMobile");
  const { pathname } = useLocation();
  /* The hub renders the tabs itself, inside the Match Centre header where the
     frame draws them. Sub-routes have no such section, so the layout supplies
     the same component beneath the hero to keep the module navigable. */
  const isHub = pathname === "/scoreboard" || pathname === "/scoreboard/";

  /* The banner shows on the Overview and Competitions roots and folds away on
     every other ScoreBoard page -- a fixture, a competition, Highlights, Live. */
  const heroShown = heroShownFor(pathname);
  const [heroFold, setHeroFold] = useState<HeroFoldState>(heroShown ? "open" : "closed");
  useEffect(() => {
    if (!heroShown) {
      setHeroFold("closed");
      return;
    }
    /* With no transition there is no transitionend to wait for. */
    if (prefersReducedMotion()) {
      setHeroFold("open");
      return;
    }
    setHeroFold((current) => (current === "open" ? "open" : "opening"));
    /* transitionend settles the opening; the timer covers a browser that never fires it
       (a tab in the background does not run transitions), so the bleed is never left clipped. */
    const timer = window.setTimeout(() => setHeroFold("open"), HERO_FOLD_MS + 120);
    return () => window.clearTimeout(timer);
  }, [heroShown]);
  const onHeroFoldTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows") return;
    setHeroFold((current) => (current === "opening" ? "open" : current));
  };

  return (
    <div className="scoreboard-module dtp-page">
      {/* Figma "DTP" -> Scoreboard 186:139: black hero, cyan eyebrow,
          Gasoek 90px display, live ribbon and subnav beneath. The fold keeps
          the hero mounted (its photo stays loaded) and animates it shut. */}
      <div
        className="sb-hero-fold"
        data-state={heroFold}
        aria-hidden={heroShown ? undefined : true}
        onTransitionEnd={onHeroFoldTransitionEnd}
      >
        <div className="sb-hero-fold__inner">
          <section className="dtp-hero dtp-hero--stack dtp-hero--bleed">
            <img className="dtp-hero__media" {...HIGH_FETCH_PRIORITY} decoding="async" src="/figma/hero-scoreboard.webp" alt="" aria-hidden="true" />
            <div className="dtp-hero__scrim" aria-hidden="true" />
            <div className="dtp-shell dtp-hero__inner">
              <p className="dtp-eyebrow">Nigeria Grassroots Football</p>
              {/* Two lines, as Figma sets it; .dtp-hero__title is pre-line. */}
              <h1 className="dtp-display dtp-display--hero dtp-hero__title">{"Score\nboard"}</h1>
              {/* Figma 186:139 carries a lead under the title that was never built.
                  The frame spells it "mach stats" — kept as "match" here. */}
              <p className="dtp-lead dtp-hero__lead">
                Explore premium match stats, video highlights and historical player profiles from
                Nigeria Grassroots Football
              </p>

              {/* Figma "Group 1000001925" (312x38 at x564 y633): two pills on a
                  #091df4 @8% wash, 119 and 173 wide with a 20px gap, sitting between
                  the lead and the stat row. I removed these in an earlier pass by
                  mistake — they are in the frame. */}
              <div className="sb-hero-actions">
                <Link to="/scoreboard/live" className="sb-hero-actions__btn">
                  Watch Live 🔴
                </Link>
                <Link to="/scoreboard/browse" className="sb-hero-actions__btn">
                  Browse Competitions
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* On every tab except Overview the match ticker takes the slot the stat
          cards occupy on Overview — directly under the hero, above the tabs. */}
      {!isHub && (
        <div className="sb-ticker-slot">
          <MatchTicker />
        </div>
      )}

      <header className="scoreboard-header">
        <LiveScoreRibbon />
        {mobileAd && (
          <div className="ad-placement ad-placement--scoreboard ad-placement--scoreboard-header-mobile">
            <AdBanner
              {...mobileAd}
              sizeHint={
                import.meta.env.DEV
                  ? `Recommended creative: ${creativeSizeLabel(mobileAd.format)}`
                  : undefined
              }
            />
          </div>
        )}
        {!isHub && <ScoreboardTabs />}
      </header>
      <ModuleAdRails
        topSlot="scoreboardTop"
        leftSlot="scoreboardLeft"
        rightSlot="scoreboardRight"
      >
        <Outlet />
      </ModuleAdRails>
    </div>
  );
}
