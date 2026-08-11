import { Link } from "react-router-dom";

/* Figma "DTP" -> Scouting Hubs 118:1711, the three 389x148 gradient tiles. */

const TILES = [
  {
    to: "/scouting/strong-xi",
    tone: "",
    title: "Strong XI",
    body: "Auto-pick best XI by formation and playing philosophy",
  },
  {
    to: "/scouting/compare",
    tone: "dtp-tile--green",
    title: "Play Comparison",
    body: "Compare 2–4 players with radar charts, ratings, and scouting metrics",
  },
  {
    to: "/scouting/generate",
    tone: "dtp-tile--orange",
    title: "Generate Valuation",
    body: "Run a market valuation for a player using scouting metrics when available",
  },
] as const;

export function ScoutingHubPage() {
  return (
    <>
      <div className="dtp-tiles">
        {TILES.map((tile) => (
          <Link key={tile.to} to={tile.to} className={`dtp-tile ${tile.tone}`.trim()}>
            <h3>{tile.title}</h3>
            <p>{tile.body}</p>
          </Link>
        ))}
      </div>

      {/* Figma: "Interested in partnering?" Sofia Pro 500, 20px / lh 20, white,
          centred above a 148x45 Contact Us button. Styling lives in the
          stylesheet — inline styles here would outrank it. */}
      <div className="scouting-partner">
        <p className="scouting-partner__label">Interested in partnering?</p>
        <Link to="/contact" className="dtp-btn">
          Contact Us
        </Link>
      </div>
    </>
  );
}
