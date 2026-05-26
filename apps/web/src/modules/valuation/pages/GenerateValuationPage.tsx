import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@dtp/ui";
import { apiGet } from "../../../api/client";
import { generateValuation } from "../../../api/mvce";
import { usePageTitle } from "../../../hooks/usePageTitle";

type PlayerOption = { id: string; displayName: string; positionPrimary: string };

const SEED_ID = "00000000-0000-4000-8000-000000000001";

export function GenerateValuationPage() {
  usePageTitle("Generate valuation");
  const navigate = useNavigate();
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet<PlayerOption[]>("/home/featured-players")
      .then((rows) =>
        setPlayers(
          rows.map((r) => ({
            id: r.id,
            displayName: r.displayName,
            positionPrimary: r.positionPrimary,
          }))
        )
      )
      .catch(() => setPlayers([{ id: SEED_ID, displayName: "ALLI O. SANNI", positionPrimary: "AM" }]));
  }, []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const playerId = String(fd.get("playerId"));
    try {
      const report = await generateValuation({
        playerId,
        competitionTier: Number(fd.get("competitionTier") || 3),
        verifiedFootage: fd.get("verifiedFootage") === "on",
        scoutReports: fd.get("scoutReports") === "on",
        tournamentExposure: fd.get("tournamentExposure") === "on",
        youthNationalTeam: fd.get("youthNationalTeam") === "on",
        clubInterestRumors: fd.get("clubInterestRumors") === "on",
        marketDemand: String(fd.get("marketDemand") || "none"),
        verificationLevel: String(fd.get("verificationLevel") || "video_only"),
      });
      navigate(`/valuation/player/${report.player.id}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sb-page">
      <header className="page-header">
        <h1>Generate valuation</h1>
        <p className="muted">
          Pulls player age, position, SIP ratings, and match counts when available.
          Requires the admin key in this browser session.
        </p>
      </header>

      <form className="home-form mvce-form" onSubmit={onSubmit}>
        <label>
          Player
          <select name="playerId" required defaultValue={SEED_ID}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} ({p.positionPrimary})
              </option>
            ))}
          </select>
        </label>

        <label>
          Competition tier (1 grassroots – 5 elite)
          <input name="competitionTier" type="number" min={1} max={5} defaultValue={3} />
        </label>

        <label>
          Verification level
          <select name="verificationLevel" defaultValue="video_match_sheets">
            <option value="none">None</option>
            <option value="video_only">Video only</option>
            <option value="video_match_sheets">Video + match sheets</option>
            <option value="full_verified">Full verified</option>
            <option value="national_team">National team proof</option>
          </select>
        </label>

        <label>
          Market demand
          <select name="marketDemand" defaultValue="npfl">
            <option value="none">None</option>
            <option value="local_club">Local club interest</option>
            <option value="npfl">NPFL</option>
            <option value="african_club">African club</option>
            <option value="european_club">European club</option>
            <option value="elite_european">Elite European</option>
          </select>
        </label>

        <fieldset className="guardian-fieldset">
          <legend>Signals</legend>
          <label className="checkbox-label">
            <input name="verifiedFootage" type="checkbox" defaultChecked />
            Verified footage
          </label>
          <label className="checkbox-label">
            <input name="scoutReports" type="checkbox" defaultChecked />
            Scout reports
          </label>
          <label className="checkbox-label">
            <input name="tournamentExposure" type="checkbox" />
            Tournament exposure
          </label>
          <label className="checkbox-label">
            <input name="youthNationalTeam" type="checkbox" />
            Youth national team
          </label>
          <label className="checkbox-label">
            <input name="clubInterestRumors" type="checkbox" defaultChecked />
            Club interest / rumors
          </label>
        </fieldset>

        {error && <p className="form-error">{error}</p>}

        <Button type="submit" disabled={loading}>
          {loading ? "Calculating…" : "Generate valuation"}
        </Button>
      </form>

      <p className="muted">
        Or view existing:{" "}
        <Link to={`/valuation/player/${SEED_ID}`}>seed player report</Link>
      </p>
    </div>
  );
}
