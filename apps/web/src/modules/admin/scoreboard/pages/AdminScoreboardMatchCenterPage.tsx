import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchSupervisorLive,
  ingestMatchSip,
  patchMatch,
  postMatchEvent,
  EVENT_LABELS,
  type SbMatchListItem,
} from "../../../../api/scoreboard";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import { formatAdminScoreboardError } from "../admin-scoreboard-utils";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { RosterReadinessBar } from "../components/RosterReadinessBar";

type TimelineEvent = Awaited<
  ReturnType<typeof adminScoreboardApi.listMatchEvents>
>[number];

export function AdminScoreboardMatchCenterPage() {
  usePageTitle("Admin — ScoreBoard match center");
  const toast = useAdminToast();
  const [live, setLive] = useState<SbMatchListItem[]>([]);
  const [all, setAll] = useState<SbMatchListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [readiness, setReadiness] = useState<
    Awaited<ReturnType<typeof adminScoreboardApi.getSpotter>>["rosterReadiness"] | null
  >(null);
  const [supervisorOk, setSupervisorOk] = useState<boolean | null>(null);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetchSupervisorLive()
      .then((rows) => {
        setLive(rows);
        setSupervisorOk(true);
        if (rows.length && !selectedId) setSelectedId(rows[0].id);
      })
      .catch(() => setSupervisorOk(false));
    setMatchesLoading(true);
    adminScoreboardApi
      .matches()
      .then(setAll)
      .catch(() => setAll([]))
      .finally(() => setMatchesLoading(false));
  }, [selectedId]);

  const loadTimeline = useCallback((matchId: string) => {
    setTimelineLoading(true);
    Promise.all([
      adminScoreboardApi.listMatchEvents(matchId),
      adminScoreboardApi.getSpotter(matchId),
    ])
      .then(([events, spotter]) => {
        setTimeline(events);
        setReadiness(spotter.rosterReadiness);
      })
      .catch(() => {
        setTimeline([]);
        setReadiness(null);
      })
      .finally(() => setTimelineLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selected = [...live, ...all].find((m) => m.id === selectedId) ?? live[0] ?? all[0];

  useEffect(() => {
    if (selected?.id) loadTimeline(selected.id);
  }, [selected?.id, loadTimeline]);

  const recordEvent = async (type: string) => {
    if (!selected || busy) return;
    setBusy(true);
    const minute = selected.minute ?? 0;
    try {
      await postMatchEvent(selected.id, {
        type,
        minute,
        teamId: selected.homeTeam.id,
        metadata: { source: "admin-match-center" },
      });
      toast.success(`${EVENT_LABELS[type] ?? type} tagged`);
      refresh();
      loadTimeline(selected.id);
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setBusy(false);
    }
  };

  const removeEvent = async (eventId: string) => {
    if (!selected) return;
    try {
      await adminScoreboardApi.deleteMatchEvent(selected.id, eventId);
      toast.success("Event removed");
      loadTimeline(selected.id);
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    }
  };

  const matchOptions = [...new Map([...live, ...all].map((m) => [m.id, m])).values()];

  const matchStatusClass = (status: string) => {
    if (status === "live") return "admin-sb-status--live";
    if (status === "halftime") return "admin-sb-status--halftime";
    if (status === "finished") return "admin-sb-status--finished";
    return "admin-sb-status--upcoming";
  };

  return (
    <section className="admin-sb-section">
      <AdminSbPageHeader
        title="Match center"
        description="Canonical timeline and live match controls. Full time updates standings for group-stage fixtures."
        crumbs={[{ label: "Match center" }]}
      />

      <div className="admin-sb-supervisor-hook admin-sb-panel">
        <span
          className={
            supervisorOk === null
              ? "admin-pill"
              : supervisorOk
                ? "admin-pill admin-pill--live"
                : "admin-pill admin-pill--warn"
          }
        >
          Supervisor {supervisorOk ? "online" : supervisorOk === false ? "offline" : "…"}
        </span>
        <Link to="/scoreboard/supervisor" className="text-link">
          Public supervisor
        </Link>
        <Link to="/admin/scoreboard/roster" className="text-link">
          Rosters
        </Link>
        <a href="/spotter-tablet" className="text-link">
          Spotter tablet ↗
        </a>
      </div>

      <div className="admin-sb-sticky-bar">
        <div className="admin-filters">
          {matchesLoading ? (
            <span className="admin-sb-skeleton admin-sb-skeleton--bar" aria-busy="true" />
          ) : (
            <select
              value={selected?.id ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="Select match"
              disabled={matchOptions.length === 0}
            >
              {matchOptions.length === 0 ? (
                <option value="">No matches available</option>
              ) : (
                matchOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.homeTeam.name} vs {m.awayTeam.name} ({m.status})
                  </option>
                ))
              )}
            </select>
          )}
        </div>
      </div>

      {matchesLoading ? (
        <div className="admin-sb-skeleton admin-sb-skeleton--panel admin-sb-match-panel-skeleton" aria-busy="true" />
      ) : !selected ? (
        <div className="admin-sb-empty-state dtp-empty-state">
          <p className="admin-sb-empty-state__title dtp-empty-state__title">No matches to control</p>
          <p className="muted">
            Schedule fixtures from Master records, build rosters, then return here for live ops.
          </p>
        </div>
      ) : (
        <>
          <RosterReadinessBar
            readiness={readiness}
            homeLabel={selected.homeTeam.name}
            awayLabel={selected.awayTeam.name}
            compact
          />

          <div className="sb-supervisor-panel admin-sb-match-panel admin-sb-panel">
            <header className="admin-sb-match-header">
              <div>
                <h3>
                  {selected.homeTeam.name}{" "}
                  <span className="admin-sb-score">
                    {selected.homeScore} – {selected.awayScore}
                  </span>{" "}
                  {selected.awayTeam.name}
                </h3>
                <p className="muted">
                  Min {selected.minute ?? "—"} · SIP {selected.sipIngestStatus} ·{" "}
                  <span className={`admin-sb-status ${matchStatusClass(selected.status)}`}>
                    {selected.status === "live" ? "LIVE" : selected.status}
                  </span>
                </p>
              </div>
            </header>

            <div className="sb-supervisor-actions admin-sb-match-actions">
              <button
                type="button"
                className="admin-inline-button"
                onClick={() => patchMatch(selected.id, { status: "halftime" }).then(refresh)}
              >
                Half time
              </button>
              <button
                type="button"
                className="admin-inline-button"
                onClick={() => patchMatch(selected.id, { status: "live" }).then(refresh)}
              >
                2nd half
              </button>
              <button
                type="button"
                className="admin-inline-button admin-inline-button--primary"
                onClick={() =>
                  patchMatch(selected.id, { status: "finished" }).then(() => {
                    toast.success("Full time — stats and standings processing");
                    refresh();
                    loadTimeline(selected.id);
                  })
                }
              >
                Full time
              </button>
              <button
                type="button"
                className="admin-inline-button"
                onClick={() =>
                  ingestMatchSip(selected.id).then(() => toast.success("SIP ingest queued"))
                }
              >
                SIP ingest
              </button>
            </div>

            <div className="admin-sb-quick-events">
              {["goal", "yellow_card", "red_card", "substitution", "injury"].map((t) => (
                <button
                  key={t}
                  type="button"
                  className="admin-sb-event-chip"
                  disabled={busy || !readiness?.readyForLive}
                  title={
                    readiness?.readyForLive
                      ? undefined
                      : "Complete rosters and lock lineups first"
                  }
                  onClick={() => recordEvent(t)}
                >
                  {EVENT_LABELS[t] ?? t}
                </button>
              ))}
            </div>

            <div className="admin-sb-timeline">
              <h4>Match timeline</h4>
              {timelineLoading ? (
                <ul className="admin-sb-timeline-list">
                  {[1, 2, 3].map((i) => (
                    <li key={i}>
                      <span className="admin-sb-skeleton admin-sb-skeleton--line" />
                    </li>
                  ))}
                </ul>
              ) : timeline.length === 0 ? (
                <div className="admin-sb-empty-state dtp-empty-state admin-sb-empty-state--compact">
                  <p className="admin-sb-empty-state__title dtp-empty-state__title">
                    No events recorded yet
                  </p>
                  <p className="muted">
                    Tag goals, cards, and subs using the quick-event chips above once rosters are
                    locked.
                  </p>
                </div>
              ) : (
                <ul className="admin-sb-timeline-list">
                  {timeline.map((ev) => (
                    <li key={ev.id} className="admin-sb-timeline-row">
                      <span className="admin-sb-timeline-minute">{ev.minute}&apos;</span>
                      <span className={`admin-sb-event-type admin-sb-event-type--${ev.type}`}>
                        {EVENT_LABELS[ev.type] ?? ev.type}
                      </span>
                      <span className="admin-sb-timeline-player muted">
                        {ev.player?.displayName ?? ev.playerLabel ?? "—"}
                        {ev.team ? ` · ${ev.team.name}` : ""}
                      </span>
                      <button
                        type="button"
                        className="admin-link-danger"
                        onClick={() => removeEvent(ev.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
