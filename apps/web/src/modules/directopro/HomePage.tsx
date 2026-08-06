import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MvceCard } from "@dtp/ui";
import { apiGet, fetchFeaturedPlayers, isAbortError, type FeaturedPlayer } from "../../api/client";
import { usePageTitle } from "../../hooks/usePageTitle";
import { HomePlayerHighlights } from "./components/home/HomePlayerHighlights";
import { HomeIntelligenceTeasers } from "./components/home/HomeIntelligenceTeasers";
import { HomeLiveMatchCenter } from "./components/home/HomeLiveMatchCenter";
import { mvceCardHref, toMvceCardData } from "./utils/mvceCardData";
import { HIGH_FETCH_PRIORITY } from "../../utils/imgPriority";

/* Figma "DTP" -> Homepage 3:189.
   Band order mirrors the frame: black hero -> marquee -> blue mission band ->
   lime FEATURED TALENT wedge (MVCE card grid) -> marquee -> red Intelligence
   Suite -> blue PLAYER HIGHLIGHTS. */

type WinsWallLogo = {
  name?: string;
  imageUrl?: string;
  href?: string;
};

const HOME_CONTENT_KEYS = [
  "home.eyebrow",
  "home.headline",
  "home.headlineAccent",
  "home.lead",
  "home.primaryCta",
  "home.secondaryCta",
  "home.announcement.enabled",
  "home.announcement.title",
  "home.announcement.body",
  "home.announcement.ctaLabel",
  "home.announcement.ctaHref",
  "home.event.enabled",
  "home.event.title",
  "home.event.date",
  "home.event.venue",
  "home.event.body",
  "home.event.ctaLabel",
  "home.event.ctaHref",
  "home.featuredVideo.enabled",
  "home.featuredVideo.title",
  "home.featuredVideo.url",
  "home.featuredVideo.caption",
  "home.winsWall.enabled",
  "home.winsWall.title",
  "home.winsWall.logos",
];

const MARQUEE_PHRASE = "from local roots to global reach";

/** Words highlighted in electric blue when the CMS gives no explicit accent. */
const HEADLINE_ACCENT_WORDS = 2;

/**
 * Splits the hero headline into a plain lead and a blue-accented tail.
 *
 * The headline is CMS-editable, so the accent cannot be hard-coded. Editors can
 * set `home.headlineAccent` to any trailing substring; otherwise the last two
 * words are accented, which yields "LOCAL TALENT" for the default copy.
 */
function splitHeadline(headline: string, accent?: string) {
  const text = headline.trim();

  if (accent?.trim()) {
    const needle = accent.trim();
    const at = text.toLowerCase().lastIndexOf(needle.toLowerCase());
    if (at !== -1) {
      return { lead: text.slice(0, at), highlight: text.slice(at, at + needle.length) };
    }
  }

  const words = text.split(/\s+/);
  if (words.length <= HEADLINE_ACCENT_WORDS) return { lead: "", highlight: text };

  const tail = words.slice(-HEADLINE_ACCENT_WORDS).join(" ");
  return { lead: text.slice(0, text.length - tail.length), highlight: tail };
}

function isEnabled(value?: string) {
  return value?.trim().toLowerCase() === "true";
}

function parseWinsWallLogos(value?: string): WinsWallLogo[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function HomeCta({ href, label }: { href?: string; label?: string }) {
  if (!href || !label) return null;
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="text-link">
        {label}
      </a>
    );
  }
  return (
    <Link to={href} className="text-link">
      {label}
    </Link>
  );
}

/** "From local roots to global reach" ticker.
 *  An even item count is required: the keyframe translates -50%, so the second
 *  half must be a pixel-identical copy of the first for the loop to be seamless. */
const MARQUEE_REPEATS = 12;

function Marquee({ tone = "ink" }: { tone?: "ink" | "lime" | "blue" }) {
  const items = Array.from({ length: MARQUEE_REPEATS }, (_, index) => (
    <span className="dtp-marquee__item" key={index}>
      {MARQUEE_PHRASE} <span aria-hidden="true">/</span>
    </span>
  ));

  return (
    <div className={`dtp-marquee dtp-marquee--${tone}`} aria-hidden="true">
      <div className="dtp-marquee__track">{items}</div>
    </div>
  );
}

export function HomePage() {
  usePageTitle();
  const [content, setContent] = useState<Record<string, string>>({});
  const [talent, setTalent] = useState<FeaturedPlayer[]>([]);

  useEffect(() => {
    apiGet<Record<string, string>>(`/home/content?keys=${HOME_CONTENT_KEYS.join(",")}`)
      .then(setContent)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetchFeaturedPlayers(8, controller.signal)
      .then((data) => {
        if (active) setTalent(data);
      })
      .catch((error) => {
        if (!isAbortError(error)) setTalent([]);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  // Figma 3:189 sets the headline on four lines: "Global / Stage for / Local / Talent".
  const headline = splitHeadline(
    content["home.headline"] ?? "Global\nStage for\nLocal\nTalent",
    content["home.headlineAccent"] ?? "Local\nTalent"
  );
  const winsWallLogos = parseWinsWallLogos(content["home.winsWall.logos"]);
  const hasManagedCards =
    isEnabled(content["home.announcement.enabled"]) ||
    isEnabled(content["home.event.enabled"]) ||
    isEnabled(content["home.featuredVideo.enabled"]);

  return (
    <>
      {/* ---- Hero: Figma 3:189 layered backdrop + copy on the black ---- */}
      <section className="dtp-hero dtp-hero--tall dtp-hero--split">
        {/* Full-bleed, so sizes="100vw": a 1440 laptop pulls the 1440 variant,
            a 5K display the 2880. This is the LCP element.

            Phones get the figure on its own, with alpha. A 50%-wide column is
            far narrower than the photo half's 712:834, so filling it with the
            photo crops ~53% of his width away and blows up what remains. The
            cutout can instead be fitted whole at true proportions, and having
            no sky means no rectangle edge against the black. */}
        <picture className="dtp-hero__picture">
          <source
            media="(max-width: 600px)"
            srcSet="/figma/hero-player-figure-420.webp 420w, /figma/hero-player-figure-840.webp 840w"
            sizes="58vw"
          />
          <img
            className="dtp-hero__layer dtp-hero__layer--photo"
            src="/figma/hero-photo-panel-1920.webp"
            srcSet="/figma/hero-photo-panel-1440.webp 1440w, /figma/hero-photo-panel-1920.webp 1920w, /figma/hero-photo-panel-2880.webp 2880w"
            sizes="100vw"
            alt=""
            aria-hidden="true"
            {...HIGH_FETCH_PRIORITY}
            decoding="async"
          />
        </picture>
        <span className="dtp-hero__dot dtp-hero__dot--ring" aria-hidden="true" />
        <span className="dtp-hero__dot dtp-hero__dot--solid" aria-hidden="true" />

        <div className="dtp-shell dtp-hero__inner">
          <div className="dtp-hero__copy">
            <p className="dtp-eyebrow dtp-eyebrow--gradient">
              {content["home.eyebrow"] ?? "From the Streets to the Stadium"}
            </p>
            <h1 className="dtp-display dtp-display--hero dtp-hero__title">
              {headline.lead}
              <span className="dtp-hl">{headline.highlight}</span>
            </h1>
            {/* Figma 3:189 carries no supporting paragraph and a single
                outlined CTA in the hero — the copy block ends here. */}
            <div className="dtp-hero__actions">
              <Link to="/featured-players" className="dtp-btn dtp-btn--ghost">
                {content["home.secondaryCta"] ?? "See Featured Players"}
              </Link>
            </div>
          </div>
        </div>

        {/* Figma z45: the player cutout that crosses in front of the nav pill.
            Same 1440x834 export frame as the photo panel, so identical sizing
            keeps the two registered. `pointer-events: none` keeps the nav
            underneath fully clickable. */}
        <img
          className="dtp-hero__layer dtp-hero__layer--arm"
          src="/figma/hero-player-arm-1920.webp"
          srcSet="/figma/hero-player-arm-1440.webp 1440w, /figma/hero-player-arm-1920.webp 1920w, /figma/hero-player-arm-2880.webp 2880w"
          sizes="100vw"
          alt=""
          aria-hidden="true"
          decoding="async"
        />
      </section>

      {/* Figma stacks two tickers under the hero: Group 19525 (y834,
          lime plate, dark green type) and Group 19524 (y950, blue plate,
          white type). */}
      <Marquee tone="lime" />
      <Marquee tone="blue" />

      {/* ---- Mission band ------------------------------------------- */}
      <section className="dtp-band dtp-band--blue">
        <div className="dtp-shell dtp-band__head">
          <p className="dtp-lead" style={{ maxWidth: "62ch", color: "var(--dtp-white)" }}>
            DTP Africa is building the intelligence and data infrastructure to turn overlooked
            African football talent into verifiable, discoverable opportunity.
          </p>
          <div className="dtp-band__actions" style={{ marginTop: "var(--dtp-space-5)" }}>
            <Link to="/about" className="dtp-btn dtp-btn--ghost">
              Watch Reel
            </Link>
          </div>
        </div>
        <div className="dtp-shell">
          <HomeLiveMatchCenter />
        </div>
      </section>

      {/* ---- Featured talent: MVCE card grid ------------------------- */}
      <section className="dtp-band dtp-band--lime dtp-band--wedge">
        <div className="dtp-shell">
          <div className="dtp-band__head">
            <p className="dtp-eyebrow" style={{ color: "var(--dtp-green)" }}>
              Featured Talent
            </p>
            <h2 className="dtp-display">Discover verified prospects</h2>
            <p className="dtp-body">
              Scout-rated profiles with position fit, ratings, and match-verified career stats.
            </p>
          </div>

          {talent.length > 0 ? (
            <div className="dtp-card-grid">
              {talent.map((player) => (
                <MvceCard
                  key={player.id}
                  player={toMvceCardData(player)}
                  to={mvceCardHref(player)}
                />
              ))}
            </div>
          ) : (
            <p className="dtp-body" style={{ textAlign: "center" }}>
              Verified profiles are being published — check back shortly.
            </p>
          )}

          <div className="dtp-band__actions">
            <Link to="/featured-players" className="dtp-btn dtp-btn--ink dtp-btn--lg">
              View All Talents
            </Link>
          </div>
        </div>
      </section>

      <Marquee tone="ink" />

      {/* ---- Intelligence Suite ------------------------------------- */}
      {/* HomeIntelligenceTeasers owns its own heading (and the aria-labelledby
          that points at it), so the band only supplies the Figma styling. */}
      <section className="dtp-band dtp-band--red dtp-band--start">
        <div className="dtp-shell">
          <HomeIntelligenceTeasers />
          <div className="dtp-band__actions" style={{ justifyContent: "flex-start" }}>
            <Link to="/scouting" className="dtp-btn dtp-btn--ink">
              Explore Scouting
            </Link>
          </div>
        </div>
      </section>

      {/* ---- Player highlights -------------------------------------- */}
      <section className="dtp-band dtp-band--blue">
        <div className="dtp-shell">
          <HomePlayerHighlights />
        </div>
      </section>

      {/* ---- CMS-managed cards (announcement / event / video) -------- */}
      {hasManagedCards && (
        <section className="dtp-band dtp-band--paper">
          <div className="dtp-shell home-managed-grid">
            {isEnabled(content["home.announcement.enabled"]) && (
              <article className="home-managed-card">
                <p className="eyebrow">Announcement</p>
                <h2>{content["home.announcement.title"] ?? "Latest update"}</h2>
                <p>{content["home.announcement.body"]}</p>
                <HomeCta
                  href={content["home.announcement.ctaHref"]}
                  label={content["home.announcement.ctaLabel"]}
                />
              </article>
            )}

            {isEnabled(content["home.event.enabled"]) && (
              <article className="home-managed-card">
                <p className="eyebrow">Event</p>
                <h2>{content["home.event.title"] ?? "Upcoming event"}</h2>
                <p className="muted">
                  {[content["home.event.date"], content["home.event.venue"]]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p>{content["home.event.body"]}</p>
                <HomeCta
                  href={content["home.event.ctaHref"]}
                  label={content["home.event.ctaLabel"]}
                />
              </article>
            )}

            {isEnabled(content["home.featuredVideo.enabled"]) && (
              <article className="home-managed-card">
                <p className="eyebrow">Featured video</p>
                <h2>{content["home.featuredVideo.title"] ?? "Featured video"}</h2>
                {content["home.featuredVideo.caption"] && (
                  <p>{content["home.featuredVideo.caption"]}</p>
                )}
                <HomeCta href={content["home.featuredVideo.url"]} label="Watch video" />
              </article>
            )}
          </div>
        </section>
      )}

      {isEnabled(content["home.winsWall.enabled"]) && winsWallLogos.length > 0 && (
        <section className="dtp-band dtp-band--paper home-wins-wall">
          <div className="dtp-shell">
            <div className="dtp-band__head">
              <h2 className="dtp-display">{content["home.winsWall.title"] ?? "Wins wall"}</h2>
            </div>
            <div className="home-wins-wall__grid">
              {winsWallLogos.map((logo, index) => {
                const body = logo.imageUrl ? (
                  <img src={logo.imageUrl} alt={logo.name ?? "Partner logo"} />
                ) : (
                  <strong>{logo.name ?? "Partner"}</strong>
                );
                return logo.href ? (
                  <a
                    key={`${logo.name ?? "logo"}-${index}`}
                    href={logo.href}
                    target={/^https?:\/\//i.test(logo.href) ? "_blank" : undefined}
                    rel={/^https?:\/\//i.test(logo.href) ? "noreferrer" : undefined}
                    className="home-wins-wall__item"
                  >
                    {body}
                  </a>
                ) : (
                  <div key={`${logo.name ?? "logo"}-${index}`} className="home-wins-wall__item">
                    {body}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
