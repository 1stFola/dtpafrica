import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

const ABOUT_CONTENT_KEYS = [
  "about.hero.kicker",
  "about.hero.title",
  "about.hero.body",
  "about.story.kicker",
  "about.story.title",
  "about.story.body1",
  "about.story.body2",
  "about.framework.kicker",
  "about.framework.title",
  "about.framework.body",
  "about.founder.kicker",
  "about.founder.name",
  "about.founder.role",
  "about.founder.body1",
  "about.founder.body2",
] as const;

const ABOUT_DEFAULTS: Record<(typeof ABOUT_CONTENT_KEYS)[number], string> = {
  "about.hero.kicker": "DirectToPro Africa",
  "about.hero.title": "Bridging African football talent with verified global opportunity.",
  "about.hero.body":
    "We digitally identify and connect African football talents to professional clubs worldwide using technology, objective data, AI-driven analysis, and shareable player profiles built for scouts.",
  "about.story.kicker": "About us",
  "about.story.title": "We do not just find players. We build futures.",
  "about.story.body1":
    "DirectToPro Africa operates at the intersection of traditional scouting and cutting-edge technology, identifying and nurturing the next generation of superstars from grassroots academies to professional leagues abroad.",
  "about.story.body2":
    "Our mission is clear: provide a data-driven pathway for local talents to achieve their global dreams through unbiased evaluation, professional player profiling, and strategic guidance.",
  "about.framework.kicker": "Player identification and rating",
  "about.framework.title": "A 1-99 framework for measurable football development.",
  "about.framework.body":
    "Our framework combines traditional scouting, video review, modern data analytics, and AI-supported performance insight to evaluate players at every development stage.",
  "about.founder.kicker": "Meet our founder",
  "about.founder.name": "Fola Sanni",
  "about.founder.role": "Founder and CEO, DirectToPro Africa",
  "about.founder.body1":
    "Fola Sanni is a visionary entrepreneur, strategist, and football innovation advocate dedicated to transforming how African talents are discovered and developed.",
  "about.founder.body2":
    "Through DirectToPro Africa, Fola leads a mission to make football scouting transparent, data-based, and globally accessible by integrating AI-powered video analysis and structured player profiling with trusted international representation.",
};

const ratingLevels = [
  {
    band: "1-20",
    title: "Beginner",
    focus: "Building fundamentals through technical drills and small-sided games",
  },
  {
    band: "21-40",
    title: "Developing",
    focus: "Skill application and consistency in structured match observation",
  },
  {
    band: "41-60",
    title: "Competent",
    focus: "Tactical IQ and decision-making in full-game analysis",
  },
  {
    band: "61-80",
    title: "Advanced",
    focus: "Excellence under pressure in elite competitions",
  },
  {
    band: "81-99",
    title: "Elite",
    focus: "World-class dominance with advanced performance analytics",
  },
];

const frameworkDetails = [
  {
    title: "Beginner (1-20)",
    activities: [
      "Unopposed passing, receiving, shooting, and ball mastery drills",
      "1v1, 2v2, and 3v3 games to assess coordination and basic understanding",
      "Coach observation focused on learning attitude and fundamentals",
    ],
  },
  {
    title: "Developing (21-40)",
    activities: [
      "Structured match observation in youth league and academy environments",
      "Video review of key moments in real game situations",
      "Skill application tests under repeatable conditions",
    ],
  },
  {
    title: "Competent (41-60)",
    activities: [
      "Full-game analysis across multiple matches",
      "Physical and technical testing for speed, endurance, strength, and ball control",
      "Tactical IQ assessment across different match scenarios",
    ],
  },
  {
    title: "Advanced (61-80)",
    activities: [
      "Elite competition footage from national leagues and youth tournaments",
      "GPS, heatmaps, pass completion, and advanced tracking data",
      "Professional scout reports and club trial feedback",
    ],
  },
  {
    title: "Elite (81-99)",
    activities: [
      "Professional league and international competition performance",
      "AI-driven analysis and predictive performance modelling",
      "Global scout network visibility and multi-club tracking",
    ],
  },
];

export function AboutPage() {
  usePageTitle("About");
  const [showFramework, setShowFramework] = useState(false);
  const [content, setContent] =
    useState<Record<(typeof ABOUT_CONTENT_KEYS)[number], string>>(ABOUT_DEFAULTS);

  useEffect(() => {
    const controller = new AbortController();
    apiGet<Record<string, string>>(
      `/home/content?keys=${ABOUT_CONTENT_KEYS.join(",")}`,
      controller.signal
    )
      .then((rows) => {
        setContent((current) => ({ ...current, ...rows }));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <main className="home-page about-premium">
      <section className="about-hero">
        <div className="about-hero__copy">
          <span className="about-kicker">{content["about.hero.kicker"]}</span>
          <h1>{content["about.hero.title"]}</h1>
          <p>{content["about.hero.body"]}</p>
          <div className="about-hero__actions">
            <Link to="/featured-players" className="button button-primary">
              Explore players
            </Link>
            <Link to="/contact" className="button button-secondary">
              Work with us
            </Link>
          </div>
        </div>
        <div className="about-hero__panel" aria-label="DirectToPro Africa impact model">
          {[
            ["Data-driven", "Objective metrics and AI analysis reduce bias"],
            ["Global access", "Talent profiles built for scouts and clubs worldwide"],
            ["Professional path", "A clearer route from grassroots to pro leagues"],
          ].map(([title, body]) => (
            <article key={title}>
              <strong>{title}</strong>
              <span>{body}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="about-story">
        <div>
          <span className="about-kicker">{content["about.story.kicker"]}</span>
          <h2>{content["about.story.title"]}</h2>
        </div>
        <div className="about-story__body">
          <p>{content["about.story.body1"]}</p>
          <p>{content["about.story.body2"]}</p>
        </div>
      </section>

      <section className="about-values">
        {[
          ["Transparency", "Clear, objective data and fair evaluation processes"],
          ["Opportunity", "Creating pathways for every talented player to succeed"],
          ["Innovation", "Using AI and technology to identify talent objectively"],
        ].map(([title, body]) => (
          <article key={title}>
            <span>{title.slice(0, 1)}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="about-framework">
        <div className="about-framework__intro">
          <span className="about-kicker">{content["about.framework.kicker"]}</span>
          <h2>{content["about.framework.title"]}</h2>
          <p>{content["about.framework.body"]}</p>
          <button type="button" className="button button-secondary" onClick={() => setShowFramework(true)}>
            Read the framework
          </button>
        </div>
        <div className="about-rating-grid">
          {ratingLevels.map((level) => (
            <article key={level.band}>
              <span>{level.band}</span>
              <h3>{level.title}</h3>
              <p>{level.focus}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="about-founder">
        <div className="about-founder__image">
          <img src="/images/Fola Sanni.png" alt="Fola Sanni, Founder and CEO of DirectToPro Africa" />
        </div>
        <div className="about-founder__copy">
          <span className="about-kicker">{content["about.founder.kicker"]}</span>
          <h2>{content["about.founder.name"]}</h2>
          <p className="about-founder__role">{content["about.founder.role"]}</p>
          <p>{content["about.founder.body1"]}</p>
          <p>{content["about.founder.body2"]}</p>
        </div>
      </section>

      {showFramework && (
        <div className="about-modal" role="dialog" aria-modal="true" aria-label="Player rating framework">
          <div className="about-modal__panel">
            <button type="button" className="about-modal__close" onClick={() => setShowFramework(false)}>
              Close
            </button>
            <span className="about-kicker">Player identification and rating framework</span>
            <h2>How the 1-99 scale is assessed</h2>
            <div className="about-modal__grid">
              {frameworkDetails.map((level) => (
                <article key={level.title}>
                  <h3>{level.title}</h3>
                  <ul>
                    {level.activities.map((activity) => (
                      <li key={activity}>{activity}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <p className="about-modal__note">
              This framework combines traditional scouting methods with modern data analytics to
              provide objective, comprehensive player assessment at every level of development.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
