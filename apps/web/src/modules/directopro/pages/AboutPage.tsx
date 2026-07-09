import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { contentParagraphs, contentValue, useStaticContent, type StaticContentMap } from "../../../hooks/useStaticContent";

const processSteps = [
  {
    label: "Capture",
    copy:
      "We document relevant football activity through match events, competition records, player information, performance tracking, video, and other available sources.",
  },
  {
    label: "Verify",
    copy:
      "We work to improve the integrity and context of player information so that profiles are built on stronger evidence rather than unsupported claims.",
  },
  {
    label: "Interpret",
    copy:
      "Raw numbers alone do not tell the full story. We organize performance information into clearer football intelligence that can support understanding of a player's physical output, technical tendencies, tactical context, development profile, and potential trajectory.",
  },
  {
    label: "Showcase",
    copy:
      "Players and clubs need more than a name on a list. DTP Africa helps build structured digital profiles that can preserve relevant performance history and present talent more professionally.",
  },
  {
    label: "Connect",
    copy:
      "Our long-term objective is to reduce the distance between credible African talent and the clubs, academies, scouts, recruiters, competitions, and football stakeholders searching for potential.",
  },
] as const;

const ecosystemSlides = [
  {
    label: "Performance intelligence",
    copy:
      "Physical, technical, and match-related information that helps create a deeper understanding of player performance.",
  },
  {
    label: "Verified player profiles",
    copy:
      "Structured digital identities designed to preserve relevant football history, performance evidence, and development context over time.",
  },
  {
    label: "Scouting intelligence",
    copy:
      "Tools and information designed to support more structured player discovery and evaluation.",
  },
  {
    label: "ScoreBoard & match intelligence",
    copy:
      "Digital match coverage that captures the moments, events, players, and stories that would otherwise disappear after the game.",
  },
  {
    label: "Valuation intelligence",
    copy:
      "Contextual analysis designed to support a more informed understanding of player trajectory, development signals, and potential market positioning.",
  },
  {
    label: "Club & academy infrastructure",
    copy:
      "Tools that help grassroots football organizations organize players, strengthen their digital presence, and present talent more professionally.",
  },
] as const;

const audiences = [
  {
    label: "For Players",
    copy:
      "A stronger digital football identity. A more structured record of development. A better way for performance to live beyond a single match, trial, or highlight clip.",
  },
  {
    label: "For Clubs & Academies",
    copy:
      "Professional tools to document players, organize football information, build institutional credibility, and strengthen the presentation of talent.",
  },
  {
    label: "For Scouts & Recruitment Teams",
    copy:
      "More structured context around emerging players, helping support earlier discovery and more informed follow-up.",
  },
  {
    label: "For Competitions & Organizers",
    copy:
      "A digital layer for tournaments and matches-turning events into lasting football intelligence, searchable histories, player stories, and visibility opportunities.",
  },
] as const;

const principles = [
  ["Talent deserves evidence.", "Potential should not disappear simply because nobody documented it."],
  ["Data needs context.", "Numbers become valuable when they are interpreted through football reality."],
  [
    "Technology should strengthen human judgment.",
    "The future of scouting is not human versus machine. It is better-informed football decision-making.",
  ],
  [
    "Visibility should preserve dignity.",
    "Young footballers are people, not products. Their stories, identities, and development journeys should be represented responsibly.",
  ],
  [
    "African football should build its own intelligence infrastructure.",
    "The continent should not only export talent. It should build stronger systems to identify, document, understand, develop, and represent that talent.",
  ],
] as const;

const stack = [
  ["Observe", "Start with the reality of the match."],
  ["Capture", "Preserve relevant events, actions, and performance signals."],
  ["Structure", "Turn fragmented information into usable football records."],
  ["Interpret", "Add context so numbers can support better questions."],
  ["Present", "Make evidence easier for the right people to understand."],
] as const;

const progressLinks = [
  ["Belief", "about-belief"],
  ["Problem", "about-problem"],
  ["System", "about-system"],
  ["Ecosystem", "about-ecosystem"],
  ["Human", "about-human"],
  ["Story", "about-story"],
  ["Founder", "about-founder"],
  ["Principles", "about-principles"],
] as const;

const aboutContentKeys = [
  "about.hero.kicker",
  "about.hero.position",
  "about.hero.title_line1",
  "about.hero.title_line2",
  "about.hero.body",
  "about.hero.change_line",
  "about.hero.belief",
  "about.problem.kicker",
  "about.problem.title_line1",
  "about.problem.title_line2",
  "about.problem.intro1",
  "about.problem.intro2",
  "about.problem.close_lead",
  "about.problem.close_body",
  "about.manifesto.title",
  "about.manifesto.body",
  "about.manifesto.emphasis",
  "about.founder.kicker",
  "about.founder.name",
  "about.founder.role",
  "about.founder.body",
  "about.founder.quote",
  "about.mission",
  "about.vision",
  "about.final.kicker",
  "about.final.title",
  "about.final.body1",
  "about.final.body2",
  "about.final.emphasis",
] as const;

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="about2-eyebrow">{children}</p>;
}

function CarouselControls({
  label,
  index,
  count,
  onPrev,
  onNext,
}: {
  label: string;
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="about2-controls" aria-label={label}>
      <button type="button" onClick={onPrev} aria-label="Previous item">
        Prev
      </button>
      <span>
        {String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
      </span>
      <button type="button" onClick={onNext} aria-label="Next item">
        Next
      </button>
    </div>
  );
}

function useCarouselGestures(onPrev: () => void, onNext: () => void) {
  const pointerStart = useRef<number | null>(null);

  return {
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrev();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
      }
    },
    onPointerDown: (event: React.PointerEvent) => {
      pointerStart.current = event.clientX;
    },
    onPointerUp: (event: React.PointerEvent) => {
      if (pointerStart.current === null) return;
      const delta = event.clientX - pointerStart.current;
      pointerStart.current = null;
      if (Math.abs(delta) < 44) return;
      if (delta > 0) onPrev();
      else onNext();
    },
    onPointerCancel: () => {
      pointerStart.current = null;
    },
  };
}

function MediaFrame({
  className = "",
  image,
  label,
}: {
  className?: string;
  image: string;
  label: string;
}) {
  return (
    <figure className={`about2-media ${className}`} style={{ "--about-image": `url("${image}")` } as React.CSSProperties}>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function SectionProgress() {
  const [active, setActive] = useState<string>(progressLinks[0][1]);

  useEffect(() => {
    const targets = progressLinks
      .map(([, id]) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!targets.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-25% 0px -55% 0px", threshold: [0.12, 0.32, 0.56] }
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="about2-progress" aria-label="About page sections">
      {progressLinks.map(([label, id]) => (
        <a
          key={id}
          href={`#${id}`}
          className={active === id ? "is-active" : undefined}
          aria-current={active === id ? "true" : undefined}
          onClick={() => setActive(id)}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function AboutHero({ content }: { content: StaticContentMap }) {
  return (
    <section className="about2-hero" id="about-belief">
      <div className="about2-hero__image" aria-hidden="true" />
      <div className="about2-hero__data" aria-hidden="true">
        <span style={{ left: "17%", top: "31%" }}>ID 09.verified</span>
        <span style={{ left: "63%", top: "26%" }}>pace signal</span>
        <span style={{ left: "49%", top: "63%" }}>match event 72'</span>
        <i style={{ left: "28%", top: "46%" }} />
        <i style={{ left: "72%", top: "54%" }} />
      </div>
      <div className="about2-hero__copy">
        <SectionEyebrow>{contentValue(content, "about.hero.kicker", "About DTP Africa")}</SectionEyebrow>
        <p className="about2-hero__position">
          {contentValue(
            content,
            "about.hero.position",
            "African football intelligence, visibility, and evidence infrastructure."
          )}
        </p>
        <h1>
          <span>{contentValue(content, "about.hero.title_line1", "Talent is everywhere.")}</span>
          <span>{contentValue(content, "about.hero.title_line2", "Evidence is not.")}</span>
        </h1>
        <p>
          {contentValue(
            content,
            "about.hero.body",
            "Across Africa, exceptional footballers compete every day on community pitches, academy grounds, school fields, and local stadiums. Many have ability. Far fewer have access to the consistent documentation, credible performance evidence, structured visibility, and professional context that help football decision-makers evaluate potential with confidence."
          )}
        </p>
        <strong>{contentValue(content, "about.hero.change_line", "DTP Africa exists to change that.")}</strong>
        <p className="about2-hero__belief">
          {contentValue(content, "about.hero.belief", "Make Talent Visible. Make Potential Verifiable.")}
        </p>
        <div className="about2-actions">
          <a href="#about-ecosystem" className="button button-primary">
            Explore the DTP Ecosystem
          </a>
          <a href="#about-system" className="button button-secondary">
            See How It Works
          </a>
        </div>
      </div>
      <a className="about2-scroll" href="#about-problem">
        Scroll
      </a>
    </section>
  );
}

function ProblemStory({ content }: { content: StaticContentMap }) {
  const problems = [
    "A player may perform brilliantly in a local competition but leave behind little structured evidence.",
    "A club may develop an exceptional prospect without the digital infrastructure to present that player professionally.",
    "A scout may hear about a promising footballer but lack enough verified context to make an informed next decision.",
    "A tournament may generate outstanding performances that disappear when the final whistle blows.",
  ];
  const [active, setActive] = useState(0);

  return (
    <section className="about2-section about2-problem" id="about-problem">
      <MediaFrame image="/images/about/about-problem.webp" label="Grassroots football reality, structured into evidence." />
      <div className="about2-problem__copy">
        <SectionEyebrow>{contentValue(content, "about.problem.kicker", "The information gap")}</SectionEyebrow>
        <h2>
          <span>{contentValue(content, "about.problem.title_line1", "The talent is not missing.")}</span>
          <span>{contentValue(content, "about.problem.title_line2", "The visibility is.")}</span>
        </h2>
        <p>{contentValue(content, "about.problem.intro1", "Africa has never had a shortage of football talent.")}</p>
        <p>
          {contentValue(
            content,
            "about.problem.intro2",
            "The deeper challenge is that too much potential remains difficult to evaluate beyond the moment in which it is seen."
          )}
        </p>
        <div
          className="about2-problem__steps"
          style={{ "--about-active-step": active } as React.CSSProperties}
        >
          <div className="about2-problem__progress" aria-hidden="true">
            <i />
          </div>
          {problems.map((problem, index) => (
            <button
              key={problem}
              type="button"
              className={active === index ? "is-active" : undefined}
              onClick={() => setActive(index)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {problem}
            </button>
          ))}
        </div>
        <p className="about2-problem__close">
          <strong>
            {contentValue(
              content,
              "about.problem.close_lead",
              "The result is an information gap between potential and opportunity."
            )}
          </strong>
          <span>{contentValue(content, "about.problem.close_body", "DTP Africa is working to close that gap.")}</span>
        </p>
      </div>
    </section>
  );
}

function ManifestoSection({ content }: { content: StaticContentMap }) {
  return (
    <section className="about2-manifesto" aria-labelledby="about-manifesto-heading">
      <h2 id="about-manifesto-heading">
        {contentValue(
          content,
          "about.manifesto.title",
          "We are building the infrastructure between grassroots football and professional decision-making."
        )}
      </h2>
      <p>
        {contentValue(
          content,
          "about.manifesto.body",
          "DTP Africa brings together football data, performance intelligence, match documentation, player profiling, digital visibility, and scouting context within a growing ecosystem."
        )}
      </p>
      <strong>
        {contentValue(
          content,
          "about.manifesto.emphasis",
          "Potential becomes more actionable when it is supported by better evidence."
        )}
      </strong>
    </section>
  );
}

function IntelligencePathway() {
  const [active, setActive] = useState(0);
  const current = processSteps[active];
  return (
    <section className="about2-section about2-pathway" id="about-system">
      <div>
        <SectionEyebrow>From potential to proof</SectionEyebrow>
        <h2>From the pitch to a decision-maker</h2>
        <p>
          A connected intelligence pathway designed to turn fragmented football activity into
          clearer, more useful evidence.
        </p>
        <div className="about2-pathway__nav" role="tablist" aria-label="Intelligence pathway steps">
          {processSteps.map((step, index) => (
            <button
              key={step.label}
              type="button"
              role="tab"
              aria-selected={active === index}
              className={active === index ? "is-active" : undefined}
              onClick={() => setActive(index)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {step.label}
            </button>
          ))}
        </div>
      </div>
      <article className="about2-pathway__stage" tabIndex={0} aria-live="polite">
        <span>{String(active + 1).padStart(2, "0")}</span>
        <h3>{current.label}</h3>
        <p>{current.copy}</p>
        <div
          className="about2-pathway__line"
          style={{ "--about-pathway-progress": `${((active + 1) / processSteps.length) * 100}%` } as React.CSSProperties}
          aria-hidden="true"
        >
          {processSteps.map((step, index) => (
            <i key={step.label} className={index <= active ? "is-lit" : undefined} />
          ))}
        </div>
        <div className="about2-intel-card" aria-hidden="true">
          <b>match.event</b>
          <i />
          <b>identity.record</b>
          <i />
          <b>profile.output</b>
        </div>
      </article>
    </section>
  );
}

function EcosystemCarousel() {
  const [active, setActive] = useState(0);
  const current = ecosystemSlides[active];
  const previous = ecosystemSlides[(active - 1 + ecosystemSlides.length) % ecosystemSlides.length];
  const next = ecosystemSlides[(active + 1) % ecosystemSlides.length];
  const setWrapped = (next: number) =>
    setActive((next + ecosystemSlides.length) % ecosystemSlides.length);
  const showPrev = () => setWrapped(active - 1);
  const showNext = () => setWrapped(active + 1);
  const gestures = useCarouselGestures(showPrev, showNext);

  return (
    <section className="about2-section about2-ecosystem" id="about-ecosystem">
      <div className="about2-section__heading">
        <SectionEyebrow>Connected football infrastructure</SectionEyebrow>
        <h2>More than a scouting platform</h2>
        <p>
          DTP Africa is not built around the belief that one trial, one highlight video, or one
          statistic can define a footballer. We are developing an ecosystem that brings multiple
          layers of evidence together.
        </p>
      </div>
      <div
        className="about2-carousel"
        aria-live="polite"
        tabIndex={0}
        aria-label="DTP Africa ecosystem carousel. Use left and right arrows to change slides."
        {...gestures}
      >
        <button
          type="button"
          className="about2-carousel__peek about2-carousel__peek--prev"
          onClick={showPrev}
          aria-label={`Show ${previous.label}`}
        >
          <span>Previous</span>
          {previous.label}
        </button>
        <article className="about2-carousel__active">
          <span>{String(active + 1).padStart(2, "0")}</span>
          <h3>{current.label}</h3>
          <p>{current.copy}</p>
          <div className="about2-mini-ui" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </article>
        <button
          type="button"
          className="about2-carousel__peek about2-carousel__peek--next"
          onClick={showNext}
          aria-label={`Show ${next.label}`}
        >
          <span>Next</span>
          {next.label}
        </button>
        <div className="about2-carousel__rail" aria-label="Ecosystem slides">
          {ecosystemSlides.map((slide, index) => (
            <button
              key={slide.label}
              type="button"
              className={active === index ? "is-active" : undefined}
              onClick={() => setActive(index)}
            >
              {slide.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="about2-carousel__progress"
        style={{ "--about-carousel-progress": `${((active + 1) / ecosystemSlides.length) * 100}%` } as React.CSSProperties}
        aria-hidden="true"
      />
      <CarouselControls
        label="Ecosystem carousel controls"
        index={active}
        count={ecosystemSlides.length}
        onPrev={() => setWrapped(active - 1)}
        onNext={() => setWrapped(active + 1)}
      />
    </section>
  );
}

function TechnologyStory() {
  const [active, setActive] = useState(0);
  return (
    <section className="about2-tech">
      <div className="about2-tech__copy">
        <SectionEyebrow>Technology with football judgment</SectionEyebrow>
        <h2>Football intelligence should strengthen judgment, not replace it.</h2>
        <p>Raw numbers alone do not tell the full story.</p>
        <p>
          DTP Africa is designed around the belief that technology should improve the information
          available to players, clubs, coaches, scouts, and decision-makers.
        </p>
      </div>
      <MediaFrame
        image="/images/about/about-technology.webp"
        label="Illustrative football intelligence interface."
        className="about2-media--tech"
      />
      <div className="about2-stack" role="tablist" aria-label="Intelligence stack">
        {stack.map(([label, copy], index) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={active === index}
            className={active === index ? "is-active" : undefined}
            onClick={() => setActive(index)}
          >
            {label}
            <span>{copy}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AudiencePathway() {
  const [active, setActive] = useState(0);
  const current = audiences[active];
  return (
    <section className="about2-section about2-audience">
      <div className="about2-section__heading">
        <SectionEyebrow>Who the system serves</SectionEyebrow>
        <h2>Built for the entire talent pathway</h2>
      </div>
      <div className="about2-audience__grid">
        <div className="about2-audience__tabs" role="tablist" aria-label="Audience groups">
          {audiences.map((audience, index) => (
            <button
              key={audience.label}
              type="button"
              role="tab"
              aria-selected={active === index}
              className={active === index ? "is-active" : undefined}
              onClick={() => setActive(index)}
            >
              {audience.label}
            </button>
          ))}
        </div>
        <article className="about2-audience__panel">
          <span>{String(active + 1).padStart(2, "0")}</span>
          <h3>{current.label}</h3>
          <p>{current.copy}</p>
        </article>
      </div>
    </section>
  );
}

function HumanPrinciple() {
  return (
    <section className="about2-section about2-human" id="about-human">
      <MediaFrame image="/images/about/about-human.webp" label="Human football judgment remains central." />
      <div>
        <SectionEyebrow>Human principle</SectionEyebrow>
        <h2>
          <span>We do not manufacture hype.</span>
          <span>We improve the evidence.</span>
        </h2>
        <p>Football will always require human judgment.</p>
        <div className="about2-human__sequence">
          <p>A dataset cannot fully measure courage.</p>
          <p>A metric cannot completely explain creativity.</p>
          <p>An algorithm cannot replace the trained eye of an experienced scout.</p>
        </div>
        <p>
          DTP Africa does not believe technology should replace football judgment. We believe it
          should strengthen the information available around that judgment.
        </p>
        <ul>
          {["Better context.", "Better documentation.", "Better visibility.", "Better questions.", "Better-informed decisions."].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <strong className="about2-human__anchor">Evidence should serve football people.</strong>
      </div>
    </section>
  );
}

function OurStory() {
  return (
    <section className="about2-story" id="about-story">
      <div className="about2-story__quote">
        <SectionEyebrow>Our Story</SectionEyebrow>
        <blockquote>Too much talent disappears without leaving enough evidence behind.</blockquote>
      </div>
      <div className="about2-story__body">
        <p>DTP Africa began with a frustration shared across African grassroots football:</p>
        <p>
          Exceptional players can spend years developing outside the view of the people positioned
          to create their next opportunity.
        </p>
        <p>
          Clubs and academies do important development work but may lack the technology,
          documentation systems, or global visibility required to present that work at a
          professional standard.
        </p>
        <p>
          At the same time, scouts and football decision-makers face their own challenge:
          identifying genuine potential within an enormous and fragmented talent landscape.
        </p>
        <p>We saw an opportunity to build infrastructure between these worlds.</p>
        <div className="about2-story__reject">
          <span>Not another promise of guaranteed professional contracts.</span>
          <span>Not another platform built purely around highlight videos.</span>
          <span>Not another system that reduces a footballer to a single score.</span>
        </div>
        <p>
          But a growing African football intelligence ecosystem built around visibility, evidence,
          context, and opportunity.
        </p>
        <strong className="about2-story__final">That is DTP Africa.</strong>
      </div>
    </section>
  );
}

function FounderSection({ content }: { content: StaticContentMap }) {
  const founderParagraphs = contentParagraphs(content, "about.founder.body", [
    "Growing up in Nigeria and remaining deeply connected to its football culture, I saw a recurring problem that talent alone could not solve.",
    "Across Africa, thousands of gifted young footballers compete, develop, and dedicate themselves to the game, yet too many remain outside the view of professional scouts, clubs, and academies. Not because the talent is absent, but because the evidence around that talent is often fragmented, inconsistent, or difficult to trust.",
    "As a software and data engineer, I came to understand that the challenge was bigger than exposure.",
    "It was also a problem of credibility.",
    "Scouts and football decision-makers need more than potential. They need context, reliable performance information, structured player histories, and evidence they can evaluate with confidence.",
    "That realization became the foundation for DTP Africa.",
    "I set out to help build infrastructure that gives grassroots players and local clubs a stronger, more credible digital presence-one capable of turning match activity, performance data, player records, and development history into a more verifiable football identity.",
    "For me, this work is deeply personal.",
    "Football can represent far more than competition. For many young players and their families, it can become a pathway to economic mobility, professional opportunity, education, travel, and a different future.",
    "What drives me is the belief that geography, limited visibility, or the absence of the right connection should not be the reason genuine potential goes unseen.",
    "Through DTP Africa, I am applying my background in software, data, and systems thinking to a human challenge: building better infrastructure around grassroots football so that talent can be documented more clearly, evaluated more fairly, and discovered with greater confidence.",
  ]);

  return (
    <section className="about2-founder" id="about-founder">
      <div className="about2-founder__media">
        <img src="/images/about/fola-sanni-ceo.webp" alt="Fola Sanni, Founder and CEO of DTP Africa" loading="lazy" />
      </div>
      <div className="about2-founder__copy">
        <SectionEyebrow>{contentValue(content, "about.founder.kicker", "The Founder / CEO")}</SectionEyebrow>
        <h2>{contentValue(content, "about.founder.name", "Fola Sanni")}</h2>
        <p className="about2-founder__role">
          {contentValue(content, "about.founder.role", "Founder and CEO, DTP Africa")}
        </p>
        <div className="about2-founder__body">
          {founderParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <blockquote>
          {contentValue(
            content,
            "about.founder.quote",
            "To help ensure that a player's future is shaped more by their ability, evidence, character, and drive-and less by how far they are from opportunity."
          )}
        </blockquote>
      </div>
    </section>
  );
}

function MissionVision({ content }: { content: StaticContentMap }) {
  return (
    <section className="about2-mission" aria-label="DTP Africa mission and vision">
      <article>
        <span>Mission</span>
        <p>
          {contentValue(
            content,
            "about.mission",
            "To make African grassroots football talent more visible, verifiable, and accessible through better data, documentation, intelligence, and digital infrastructure."
          )}
        </p>
      </article>
      <article>
        <span>Vision</span>
        <p>
          {contentValue(
            content,
            "about.vision",
            "To build one of Africa's most trusted football talent intelligence ecosystems-where credible player evidence can travel further than geography, and where potential can be evaluated with greater context, continuity, and confidence."
          )}
        </p>
      </article>
    </section>
  );
}

function BeliefsCarousel() {
  const [active, setActive] = useState(0);
  const current = principles[active];
  const setWrapped = (next: number) => setActive((next + principles.length) % principles.length);
  const showPrev = () => setWrapped(active - 1);
  const showNext = () => setWrapped(active + 1);
  const gestures = useCarouselGestures(showPrev, showNext);
  return (
    <section className="about2-section about2-beliefs" id="about-principles">
      <div className="about2-section__heading">
        <SectionEyebrow>Operating principles</SectionEyebrow>
        <h2>What We Believe</h2>
      </div>
      <article
        className="about2-beliefs__panel"
        aria-live="polite"
        tabIndex={0}
        aria-label="DTP Africa principles carousel. Use left and right arrows to change principles."
        {...gestures}
      >
        <span>{String(active + 1).padStart(2, "0")}</span>
        <h3>{current[0]}</h3>
        <p>{current[1]}</p>
      </article>
      <div className="about2-beliefs__dots" role="tablist" aria-label="Principles">
        {principles.map(([title], index) => (
          <button
            key={title}
            type="button"
            role="tab"
            aria-selected={active === index}
            className={active === index ? "is-active" : undefined}
            onClick={() => setActive(index)}
          >
            {String(index + 1).padStart(2, "0")}
          </button>
        ))}
      </div>
      <CarouselControls
        label="Principles carousel controls"
        index={active}
        count={principles.length}
        onPrev={showPrev}
        onNext={showNext}
      />
    </section>
  );
}

function AboutFinalCTA({ content }: { content: StaticContentMap }) {
  return (
    <section className="about2-final">
      <SectionEyebrow>{contentValue(content, "about.final.kicker", "From Potential to Proof")}</SectionEyebrow>
      <h2>{contentValue(content, "about.final.title", "From Potential to Proof.")}</h2>
      <p>{contentValue(content, "about.final.body1", "The next exceptional player may already be playing.")}</p>
      <p>
        {contentValue(
          content,
          "about.final.body2",
          "The question is whether the football world will have enough evidence to recognize the opportunity."
        )}
      </p>
      <strong>{contentValue(content, "about.final.emphasis", "DTP Africa is building for that moment.")}</strong>
      <div className="about2-actions">
        <Link to="/featured-players" className="button button-primary">
          Explore Players
        </Link>
        <Link to="/partners/academies" className="button button-secondary">
          For Clubs & Academies
        </Link>
      </div>
      <div className="about2-final__links">
        <Link to="/scoreboard">Explore ScoreBoard</Link>
        <Link to="/contact">Partner With DTP Africa</Link>
      </div>
    </section>
  );
}

export function AboutPage() {
  usePageTitle("About");
  const content = useStaticContent(aboutContentKeys);
  const jsonLd = useMemo(
    () =>
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "DTP Africa",
        url: "https://www.dtp.africa/about",
        slogan: "Make Talent Visible. Make Potential Verifiable.",
        description:
          "DTP Africa builds football intelligence and visibility infrastructure for African grassroots talent, verified player profiles, scouting intelligence, ScoreBoard match coverage, and club infrastructure.",
      }),
    []
  );

  return (
    <div className="about2-page">
      <script type="application/ld+json">{jsonLd}</script>
      <SectionProgress />
      <AboutHero content={content} />
      <ProblemStory content={content} />
      <ManifestoSection content={content} />
      <IntelligencePathway />
      <EcosystemCarousel />
      <TechnologyStory />
      <AudiencePathway />
      <HumanPrinciple />
      <OurStory />
      <FounderSection content={content} />
      <MissionVision content={content} />
      <BeliefsCarousel />
      <AboutFinalCTA content={content} />
    </div>
  );
}
