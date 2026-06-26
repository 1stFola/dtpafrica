import { Link } from "react-router-dom";

export function ScoutingHubPage() {
  return (
    <div className="scouting-grid">
      <Link to="/scouting/strong-xi" className="sip-card">
        <h3>Strong XI</h3>
        <p>Auto-pick best XI by formation and playing philosophy</p>
      </Link>
      <Link to="/scouting/compare" className="sip-card">
        <h3>Player comparison</h3>
        <p>Compare 2–4 players with radar charts, ratings, and scouting metrics</p>
      </Link>
      <Link to="/scouting/generate" className="sip-card">
        <h3>Generate valuation</h3>
        <p>Run a market valuation for a player using scouting metrics when available</p>
      </Link>
    </div>
  );
}
