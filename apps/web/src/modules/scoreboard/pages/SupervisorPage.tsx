import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@dtp/ui";
import {
  fetchSupervisorLive,
  ingestMatchSip,
  patchMatch,
  postMatchEvent,
  EVENT_LABELS,
  type SbMatchListItem,
} from "../../../api/scoreboard";
import { AdminApiKeyGate } from "../../admin/components/AdminApiKeyGate";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function SupervisorPage() {
  usePageTitle("Supervisor");
  const [live, setLive] = useState<SbMatchListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchSupervisorLive()
      .then((rows) => {
        setLive(rows);
        if (rows.length && !selectedId) setSelectedId(rows[0].id);
      })
      .catch(() => {});
  }, [selectedId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  const selected = live.find((m) => m.id === selectedId);

  const onAddEvent = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selected) return;
    const fd = new FormData(e.currentTarget);
    const type = String(fd.get("type") || "goal");
    const teamId = String(fd.get("teamId"));
    const playerLabel = String(fd.get("playerLabel") || "");
    const assistLabel = String(fd.get("assistLabel") || "");
    const detail = String(fd.get("detail") || "");
    const minute = Number(fd.get("minute"));
    try {
      await postMatchEvent(selected.id, {
        type,
        minute,
        teamId,
        playerLabel: playerLabel || undefined,
        assistLabel: assistLabel || undefined,
        detail: detail || undefined,
      });
      setMessage(`${EVENT_LABELS[type] ?? "Event"} recorded`);
      refresh();
      e.currentTarget.reset();
    } catch (err) {
      setMessage(String(err));
    }
  };

  const setStatus = async (status: string) => {
    if (!selected) return;
    try {
      await patchMatch(selected.id, { status });
      setMessage(`Status → ${status}`);
      refresh();
    } catch (err) {
      setMessage(String(err));
    }
  };

  const ingestSip = async () => {
    if (!selected) return;
    try {
      const result = await ingestMatchSip(selected.id);
      setMessage(
        `SIP ingest ${result.status}: ${result.playersIngested} players updated, ${result.playersSkipped} skipped`
      );
      refresh();
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <AdminApiKeyGate title="Supervisor monitor">
    <div className="sb-page">
      <header className="page-header">
        <h1>Supervisor monitor</h1>
        <p className="muted">
          Operator view for live matches. Requires the admin key in this browser session.
        </p>
      </header>

      {live.length === 0 ? (
        <p className="muted">No live matches to supervise.</p>
      ) : (
        <div className="sb-supervisor">
          <ul className="sb-supervisor-list">
            {live.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={
                    m.id === selectedId
                      ? "sb-supervisor-pick active"
                      : "sb-supervisor-pick"
                  }
                  onClick={() => setSelectedId(m.id)}
                >
                  {m.homeTeam.shortName ?? m.homeTeam.name} {m.homeScore}–
                  {m.awayScore} {m.awayTeam.shortName ?? m.awayTeam.name}
                  <span className="sb-live-badge">{m.minute}&apos;</span>
                  <span className="muted">SIP {m.sipIngestStatus}</span>
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <div className="sb-supervisor-panel">
              <h2>
                {selected.homeTeam.name} vs {selected.awayTeam.name}
              </h2>
              <Link to={`/scoreboard/match/${selected.id}`} className="text-link">
                Open match center
              </Link>
              <p className="muted">
                SIP ingest: {selected.sipIngestStatus}
                {selected.sipIngestedAt
                  ? ` at ${new Date(selected.sipIngestedAt).toLocaleString()}`
                  : ""}
              </p>

              <div className="sb-supervisor-actions">
                <Button type="button" variant="secondary" onClick={() => setStatus("halftime")}>
                  Halftime
                </Button>
                <Button type="button" variant="secondary" onClick={() => setStatus("finished")}>
                  Full time
                </Button>
                <Button type="button" variant="secondary" onClick={ingestSip}>
                  Ingest SIP
                </Button>
              </div>

              <form className="home-form" onSubmit={onAddEvent}>
                <h3>Record event</h3>
                <label>
                  Event
                  <select name="type" required defaultValue="goal">
                    {Object.entries(EVENT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Team
                  <select name="teamId" required defaultValue={selected.homeTeam.id}>
                    <option value={selected.homeTeam.id}>{selected.homeTeam.name}</option>
                    <option value={selected.awayTeam.id}>{selected.awayTeam.name}</option>
                  </select>
                </label>
                <label>
                  Player
                  <input name="playerLabel" placeholder="Player name" />
                </label>
                <label>
                  Assist / secondary player
                  <input name="assistLabel" placeholder="Optional" />
                </label>
                <label>
                  Detail
                  <input name="detail" placeholder="Optional note" />
                </label>
                <label>
                  Minute
                  <input
                    name="minute"
                    type="number"
                    min={0}
                    max={120}
                    defaultValue={selected.minute ?? 0}
                    required
                  />
                </label>
                <Button type="submit">Add goal</Button>
              </form>
            </div>
          )}
        </div>
      )}

      {message && <p className="muted">{message}</p>}
    </div>
    </AdminApiKeyGate>
  );
}
