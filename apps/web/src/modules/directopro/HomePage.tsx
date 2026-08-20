import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, fetchFeaturedPlayers, isAbortError, type FeaturedPlayer } from "../../api/client";
import { usePageTitle } from "../../hooks/usePageTitle";
import { HomePlayerHighlights } from "./components/home/HomePlayerHighlights";
import { HomeIntelligenceTeasers } from "./components/home/HomeIntelligenceTeasers";
import { HIGH_FETCH_PRIORITY } from "../../utils/imgPriority";
import { videoEmbedUrl, youtubeThumbnail } from "../../utils/media-url";
import { FeaturedTalentCard, FeaturedTalentLegend } from "./components/featured/FeaturedTalentCard";

/* Figma "DTP" -> Homepage 3:189.
   Band order mirrors the frame: black hero -> marquee -> blue mission band ->
   lime FEATURED TALENT wedge (MVCE card grid) -> marquee -> red Intelligence
   Suite -> blue PLAYER HIGHLIGHTS. */

const HOME_CONTENT_KEYS = [
  "home.eyebrow",
  "home.headline",
  "home.headlineAccent",
  "home.secondaryCta",
  "home.marquee.phrase",
  "home.reel.url",
  "home.reel.body",
  "home.reel.cta",
  "home.featured.kicker",
  "home.featured.title",
  "home.featured.body",
  "home.featured.cta",
  "home.intel.kicker",
  "home.intel.title",
  "home.intel.body",
  "home.intel.cardTitle",
  "home.intel.cardBody",
  "home.intel.cardCta",
  "home.footage.kicker",
  "home.footage.title",
  "home.footage.body",
] as const;

const DEFAULT_HOME_REEL_URL = "https://youtu.be/uIgqg7m9EDA";

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

function reelAutoplayUrl(youtubeUrl: string): string | null {
  const base = videoEmbedUrl(youtubeUrl);
  if (!base) return null;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}autoplay=1&rel=0&modestbranding=1`;
}

function HomeReelModal({ youtubeUrl, onClose }: { youtubeUrl: string; onClose: () => void }) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const embedSrc = reelAutoplayUrl(youtubeUrl);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="home-reel-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="home-reel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="home-reel-modal__close"
          onClick={onClose}
          aria-label="Close DTP Africa reel"
        >
          <span aria-hidden="true">&times;</span>
        </button>
        <h2 id={titleId} className="sr-only">
          DTP Africa reel
        </h2>
        {embedSrc ? (
          <div className="home-reel-modal__frame">
            <iframe
              src={embedSrc}
              title="DTP Africa reel"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        ) : (
          <p className="home-reel-modal__fallback">The reel is not available right now.</p>
        )}
      </div>
    </div>
  );
}

function HomeReelSection({
  youtubeUrl,
  body,
  ctaLabel,
  onPlay,
}: {
  youtubeUrl: string;
  body: string;
  ctaLabel: string;
  onPlay: () => void;
}) {
  const thumbnail = youtubeThumbnail(youtubeUrl);

  return (
    <section className="home-reel-section" aria-labelledby="home-reel-heading">
      <div className="dtp-shell home-reel-section__inner">
        <button
          type="button"
          className="home-reel-section__media"
          onClick={onPlay}
          aria-label="Watch DTP Africa reel"
        >
          {thumbnail ? (
            <img src={thumbnail} alt="" loading="lazy" />
          ) : (
            <span className="home-reel-section__thumb-fallback" aria-hidden="true" />
          )}
          <span className="home-reel-section__play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="42" height="42" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>

        <div className="home-reel-section__copy">
          <p id="home-reel-heading">{body}</p>
          <button type="button" className="home-reel-section__button" onClick={onPlay}>
            {ctaLabel}
          </button>
        </div>
      </div>
    </section>
  );
}

/** "From local roots to global reach" ticker.
 *  An even item count is required: the keyframe translates -50%, so the second
 *  half must be a pixel-identical copy of the first for the loop to be seamless. */
const MARQUEE_REPEATS = 12;

function Marquee({
  phrase,
  tone = "ink",
  reverse = false,
}: {
  phrase: string;
  tone?: "ink" | "lime" | "blue" | "orange";
  reverse?: boolean;
}) {
  const items = Array.from({ length: MARQUEE_REPEATS }, (_, index) => (
    <span className="dtp-marquee__item" key={index}>
      {phrase} <span aria-hidden="true">|</span>
    </span>
  ));

  const classes = ["dtp-marquee", `dtp-marquee--${tone}`];
  if (reverse) classes.push("dtp-marquee--reverse");

  return (
    <div className={classes.join(" ")} aria-hidden="true">
      <div className="dtp-marquee__track">{items}</div>
    </div>
  );
}

export function HomePage() {
  usePageTitle();
  const [content, setContent] = useState<Record<string, string>>({});
  const [talent, setTalent] = useState<FeaturedPlayer[]>([]);
  const [isReelOpen, setIsReelOpen] = useState(false);

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
  const marqueePhrase = content["home.marquee.phrase"] ?? "from local roots to global reach";
  const reelUrl = content["home.reel.url"] ?? DEFAULT_HOME_REEL_URL;

  return (
    <>
      {/* ---- Hero: Figma 3:189 layered backdrop + copy on the black ---- */}
      <section className="dtp-hero dtp-hero--tall dtp-hero--split">
        {/* Full-bleed, so sizes="100vw": a 1440 laptop pulls the 1440 variant,
            a 5K display the 2880. This is the LCP element.

            Phones now keep the same split-panel art direction as landscape,
            so the copy and player still share the frame rather than switching
            to a floating cutout. */}
        <picture className="dtp-hero__picture">
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
      <Marquee phrase={marqueePhrase} tone="lime" />
      <Marquee phrase={marqueePhrase} tone="blue" reverse />

      <HomeReelSection
        youtubeUrl={reelUrl}
        body={
          content["home.reel.body"] ??
          "DTP Africa is building the intelligence and data infrastructure, to turn the overlooked African football talent into verifiable and discoverable opportunity."
        }
        ctaLabel={content["home.reel.cta"] ?? "Watch Reel"}
        onPlay={() => setIsReelOpen(true)}
      />

      {/* ---- Featured talent: MVCE card grid ------------------------- */}
      <section className="dtp-band dtp-band--lime dtp-band--featured">
        <div className="dtp-shell">
          <div className="dtp-band__head">
            {/* Colour comes from `.dtp-band--featured .dtp-eyebrow`; an inline
                style here outranked the stylesheet and pinned it to green. */}
            <p className="dtp-eyebrow">{content["home.featured.kicker"] ?? "Featured Talent"}</p>
            <h2 className="dtp-display">
              {content["home.featured.title"] ?? "Discover verified prospects"}
            </h2>
            <p className="dtp-body">
              {content["home.featured.body"] ??
                "Scout-rated profiles with position fit, ratings, and match-verified career stats."}
            </p>
          </div>
          <FeaturedTalentLegend />

          {talent.length > 0 ? (
            <div className="featured-talent-grid">
              {talent.map((player) => (
                <FeaturedTalentCard key={player.id} player={player} />
              ))}
            </div>
          ) : (
            <p className="dtp-body" style={{ textAlign: "center" }}>
              Verified profiles are being published — check back shortly.
            </p>
          )}

          <div className="dtp-band__actions">
            <Link to="/featured-players" className="dtp-btn dtp-btn--primary">
              {content["home.featured.cta"] ?? "View All Talents"}
            </Link>
          </div>
        </div>
      </section>

      <Marquee phrase={marqueePhrase} tone="orange" />

      <HomeIntelligenceTeasers content={content} />

      {/* ---- Player highlights: final homepage section before footer -- */}
      <section className="home-footage-band">
        <div className="dtp-shell">
          <HomePlayerHighlights content={content} />
        </div>
      </section>
      {isReelOpen && <HomeReelModal youtubeUrl={reelUrl} onClose={() => setIsReelOpen(false)} />}
    </>
  );
}
