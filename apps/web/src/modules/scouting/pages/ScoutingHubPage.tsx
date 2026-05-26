import { Link } from "react-router-dom";

export function ScoutingHubPage() {
  return (
    <div className="scouting-grid">
      <Link to="/scouting/strong-xi" className="sip-card">
        <h3>Strong XI</h3>
        <p>Auto-pick best XI by formation and playing philosophy</p>
      </Link>
      <Link to="/scouting/philosophy" className="sip-card">
        <h3>Philosophy fit</h3>
        <p>Rank squad players for gegenpress, tiki-taka, and more</p>
      </Link>
      <Link to="/scouting/search" className="sip-card">
        <h3>Tactical search</h3>
        <p>Filter by position, age group, tactical scores</p>
      </Link>
      <Link to="/scouting/compare" className="sip-card">
        <h3>Player comparison</h3>
        <p>Compare up to four players side by side</p>
      </Link>
    </div>
  );
}
