import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

const PHILOSOPHY_BARS = [
  { label: "Gegenpress", pct: 82 },
  { label: "Counter Attack", pct: 74 },
  { label: "Strong XI Fit", pct: 88 },
];

const CONFIDENCE_BANDS = [
  { label: "High confidence", pct: 72, tone: "high" as const },
  { label: "Medium band", pct: 48, tone: "medium" as const },
  { label: "Readiness", pct: 91, tone: "ready" as const },
];

export function HomeIntelligenceTeasers() {
  return (
    <section
      className="home-features-block home-features-block--intel"
      aria-labelledby="home-intel-title"
    >
      <div className="home-features-block__head home-features-block__head--center">
        <span className="home-features-eyebrow">Intelligence Suite</span>
        <h2 id="home-intel-title" className="home-features-title-glow">
          Scout smarter. Value with confidence.
        </h2>
        <p className="home-features-lead">
          Tactical fit from SIP and market-value bands from MVCE — built for African grassroots talent.
        </p>
      </div>

      <div className="home-features-teasers">
        <Link to="/scouting" className="home-features-teaser home-features-teaser--scouting">
          <div className="home-features-teaser__copy">
            <span className="home-features-teaser__tag">Scouting Intelligence</span>
            <h3>Tactical fit &amp; Strong XI</h3>
            <p>
              Philosophy matching, formation-aware Strong XI picks, and position-fit confidence
              for every verified profile.
            </p>
            <span className="home-features-teaser__cta">Explore scouting →</span>
          </div>

          <div className="home-features-teaser__viz" aria-hidden="true">
            <div className="home-features-bars">
              {PHILOSOPHY_BARS.map((bar) => (
                <div key={bar.label} className="home-features-bar">
                  <div className="home-features-bar__track">
                    <div
                      className="home-features-bar__fill"
                      style={{ width: `${bar.pct}%` }}
                    />
                  </div>
                  <span className="home-features-bar__label">
                    {bar.label} <strong>{bar.pct}</strong>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Link>

        <Link to="/valuation" className="home-features-teaser home-features-teaser--valuation">
          <div className="home-features-teaser__copy">
            <span className="home-features-teaser__tag">Market Value Engine</span>
            <h3>MVCE confidence bands</h3>
            <p>
              Readiness scores, confidence labels, and value bands calibrated for emerging-market
              transfer windows.
            </p>
            <span className="home-features-teaser__cta">Run valuations →</span>
          </div>

          <div className="home-features-teaser__viz" aria-hidden="true">
            <div className="home-features-gauge">
              <div className="home-features-gauge__ring" style={{ "--pct": 78 } as CSSProperties}>
                <span className="home-features-gauge__score">78</span>
              </div>
              <p className="home-features-gauge__caption">Valuation readiness</p>
            </div>
            <div className="home-features-bands">
              {CONFIDENCE_BANDS.map((band) => (
                <div key={band.label} className={`home-features-band home-features-band--${band.tone}`}>
                  <span className="home-features-band__label">{band.label}</span>
                  <div className="home-features-band__track">
                    <div
                      className="home-features-band__fill"
                      style={{ width: `${band.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}
