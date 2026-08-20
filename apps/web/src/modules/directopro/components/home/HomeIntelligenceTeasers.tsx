import { Link } from "react-router-dom";

const PHILOSOPHY_BARS = [
  { label: "Gegenpress", pct: 82 },
  { label: "Counter Attack", pct: 74 },
  { label: "Strong XI Fit", pct: 74 },
];

type HomeIntelligenceTeasersProps = {
  content: Record<string, string>;
};

export function HomeIntelligenceTeasers({ content }: HomeIntelligenceTeasersProps) {
  return (
    <section className="home-intel-suite" aria-labelledby="home-intel-title">
      <div className="home-intel-suite__content">
        <span className="home-intel-suite__eyebrow">
          {content["home.intel.kicker"] ?? "Intelligence Suite"}
        </span>
        <h2 id="home-intel-title" className="home-intel-suite__title">
          {content["home.intel.title"] ?? "Scout smarter. Value with confidence"}
        </h2>
        <p className="home-intel-suite__lead">
          {content["home.intel.body"] ??
            "Tactical fit from SIP and market-value bands from MVCE - built for African grassroots talent."}
        </p>

        <Link to="/scouting" className="home-intel-suite__card">
          <div className="home-intel-suite__card-copy">
            <h3>
              {content["home.intel.cardTitle"] ?? "Scouting Hub | Tactical fit & Strong XI"}
            </h3>
            <p>
              {content["home.intel.cardBody"] ??
                "Philosophy matching, formation-aware Strong XI picks, and position-fit confidence for every verified profile."}
            </p>
            <span>{content["home.intel.cardCta"] ?? "Explore Scouting"}</span>
          </div>

          <div className="home-intel-suite__viz" aria-hidden="true">
            {PHILOSOPHY_BARS.map((bar) => (
              <div key={bar.label} className="home-intel-suite__bar">
                <div className="home-intel-suite__track">
                  <div style={{ width: `${bar.pct}%` }} />
                </div>
                <div className="home-intel-suite__bar-label">
                  <span>{bar.label}</span>
                  <strong>{bar.pct}%</strong>
                </div>
              </div>
            ))}
          </div>
        </Link>

        <div className="home-intel-suite__pager" aria-hidden="true">
          <span />
          <span />
        </div>
      </div>

      <div className="home-intel-suite__art" aria-hidden="true">
        <img className="home-intel-suite__ribbon" src="/figma/home-intelligence-ribbon.png" alt="" />
        <img className="home-intel-suite__ball" src="/figma/home-intelligence-ball.png" alt="" />
      </div>
    </section>
  );
}
