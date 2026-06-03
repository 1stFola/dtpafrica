import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../api/client";
import { usePageTitle } from "../../hooks/usePageTitle";
import { HomeFeaturesSection } from "./components/home/HomeFeaturesSection";

type WinsWallLogo = {
  name?: string;
  imageUrl?: string;
  href?: string;
};

const HOME_CONTENT_KEYS = [
  "home.eyebrow",
  "home.headline",
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

export function HomePage() {
  usePageTitle();
  const [content, setContent] = useState<Record<string, string>>({});

  useEffect(() => {
    apiGet<Record<string, string>>(`/home/content?keys=${HOME_CONTENT_KEYS.join(",")}`)
      .then(setContent)
      .catch(() => {});
  }, []);

  const winsWallLogos = parseWinsWallLogos(content["home.winsWall.logos"]);

  const primaryHref = "/register";
  const secondaryHref = "/featured-players";

  return (
    <>
    <section className="home-hero hero">
      <div className="home-hero__bg" aria-hidden="true" />
      <div className="home-hero__overlay" aria-hidden="true" />
      <div className="home-hero__content">
        <p className="eyebrow home-hero__eyebrow">
          {content["home.eyebrow"] ?? "From the Streets to the Stadium"}
        </p>
        <h1 className="hero-glow home-hero__title">
          {content["home.headline"] ?? "Global stage for local talent"}
        </h1>
        <p className="lead home-hero__lead">
          {content["home.lead"] ??
            "DirectToPro Africa connects grassroots football talent to scouts, academies, and clubs through verified data, tactical intelligence, and market-value insight."}
        </p>
        <div className="hero-actions home-hero__actions">
          <Link to={primaryHref} className="home-hero__btn home-hero__btn--primary">
            {content["home.primaryCta"] ?? "Register talent"}
          </Link>
          <Link to={secondaryHref} className="home-hero__btn home-hero__btn--secondary">
            {content["home.secondaryCta"] ?? "Featured players"}
          </Link>
        </div>
      </div>
    </section>

    {(isEnabled(content["home.announcement.enabled"]) ||
        isEnabled(content["home.event.enabled"]) ||
        isEnabled(content["home.featuredVideo.enabled"])) && (
        <div className="home-managed-grid">
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
      )}

      <HomeFeaturesSection />

      {isEnabled(content["home.winsWall.enabled"]) && winsWallLogos.length > 0 && (
        <section className="home-wins-wall">
          <div className="section-heading">
            <h2>{content["home.winsWall.title"] ?? "Wins wall"}</h2>
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
        </section>
      )}
    </>
  );
}
