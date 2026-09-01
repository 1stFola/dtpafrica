import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
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
import { MatchCsvIngestModal } from "../components/MatchCsvIngestModal";
import { MatchStatsUpdateModal } from "../components/MatchStatsUpdateModal";
import { FixtureFormModal } from "../components/FixtureFormModal";
import { FriendlyFormModal } from "../components/FriendlyFormModal";
import { QuickScoreUpdatePanel } from "../components/QuickScoreUpdatePanel";
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
  const [liveFeatureBusy, setLiveFeatureBusy] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [fixtureOpen, setFixtureOpen] = useState(false);
  const [friendlyOpen, setFriendlyOpen] = useState(false);
  const [matchSearch, setMatchSearch] = useState("");
  const [competitionOptions, setCompetitionOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);

  const refresh = useCallback(() => {
    adminScoreboardApi
      .supervisorLive()
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

  useEffect(() => {
    if (fixtureOpen) {
      adminScoreboardApi.competitionPicker().then(setCompetitionOptions).catch(() => {});
    }
  }, [fixtureOpen]);

  const matchOptions = useMemo(
    () => [...new Map([...live, ...all].map((m) => [m.id, m])).values()],
    [all, live]
  );
  const filteredMatchOptions = useMemo(() => {
    const q = matchSearch.trim().toLowerCase();
    if (!q) return matchOptions;
    return matchOptions.filter((m) =>
      [
        m.homeTeam.name,
        m.awayTeam.name,
        m.competition.name,
        m.venue,
        m.roundLabel,
        m.status,
        m.stageKey,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [matchOptions, matchSearch]);

  useEffect(() => {
    if (!filteredMatchOptions.length) return;
    if (!selectedId || !filteredMatchOptions.some((m) => m.id === selectedId)) {
      setSelectedId(filteredMatchOptions[0].id);
    }
  }, [filteredMatchOptions, selectedId]);

  const hasMatchSearch = matchSearch.trim().length > 0;
  const selected =
    filteredMatchOptions.find((m) => m.id === selectedId) ??
    filteredMatchOptions[0] ??
    (hasMatchSearch ? undefined : matchOptions.find((m) => m.id === selectedId)) ??
    (hasMatchSearch ? undefined : matchOptions[0]);

  const patchSelectedMatch = (patch: Partial<SbMatchListItem>) => {
    const apply = (rows: SbMatchListItem[]) =>
      rows.map((m) => (m.id === selected?.id ? { ...m, ...patch } : m));
    setLive((rows) => apply(rows));
    setAll((rows) => apply(rows));
  };

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

  const setLiveFeature = async (patch: { enabled?: boolean; audioEnabled?: boolean }) => {
    if (!selected || liveFeatureBusy) return;
    setLiveFeatureBusy(true);
    try {
      const result = await adminScoreboardApi.setMatchLiveFeature(selected.id, patch);
      patchSelectedMatch({
        stats: {
          ...(selected.stats ?? {}),
          liveFeature: result.liveFeature,
        },
      });
      if (patch.enabled !== undefined) {
        toast.success(patch.enabled ? "Public live feed approved" : "Public live feed disabled");
      } else if (patch.audioEnabled !== undefined) {
        toast.success(
          patch.audioEnabled
            ? "Live commentary audio approved"
            : "Live commentary audio disabled"
        );
      }
      refresh();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setLiveFeatureBusy(false);
    }
  };

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
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setFriendlyOpen(true)}>
              Create friendly
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setFixtureOpen(true)}>
              Create fixture
            </button>
          </>
        }
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
        <Link to="/admin/scoreboard/roster" className="text-link">
          Rosters
        </Link>
      </div>

      <div className="admin-sb-sticky-bar">
        <div className="admin-filters">
          {matchesLoading ? (
            <span className="admin-sb-skeleton admin-sb-skeleton--bar" aria-busy="true" />
          ) : (
            <>
              <input
                type="search"
                value={matchSearch}
                onChange={(e) => setMatchSearch(e.target.value)}
                placeholder="Search matches"
                aria-label="Search matches"
              />
              <select
                value={
                  filteredMatchOptions.some((m) => m.id === selected?.id)
                    ? (selected?.id ?? "")
                    : ""
                }
                onChange={(e) => setSelectedId(e.target.value)}
                aria-label="Select match"
                disabled={matchOptions.length === 0 || filteredMatchOptions.length === 0}
              >
                {matchOptions.length === 0 ? (
                  <option value="">No matches available</option>
                ) : filteredMatchOptions.length === 0 ? (
                  <option value="">No matching matches</option>
                ) : (
                  filteredMatchOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.homeTeam.name} vs {m.awayTeam.name} ({m.status})
                    </option>
                  ))
                )}
              </select>
            </>
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

          <QuickScoreUpdatePanel
            match={selected}
            onSaved={(patch) => {
              patchSelectedMatch(patch);
              refresh();
            }}
            onEventsImported={(result) => {
              if (result.events.length) {
                setTimeline((current) => {
                  const byId = new Map(current.map((event) => [event.id, event]));
                  for (const event of result.events) byId.set(event.id, event);
                  return [...byId.values()].sort((a, b) => a.minute - b.minute);
                });
              }
              void loadTimeline(selected.id);
              void refresh();
            }}
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
              <button
                type="button"
                className="admin-inline-button"
                onClick={() => setStatsModalOpen(true)}
              >
                Update stats
              </button>
              <button
                type="button"
                className="admin-inline-button"
                onClick={() => setCsvModalOpen(true)}
              >
                CSV upload
              </button>
              {(() => {
                const publicLiveEnabled = Boolean(selected.stats?.liveFeature?.enabled);
                const liveAudioEnabled = Boolean(selected.stats?.liveFeature?.audioEnabled);
                return (
                  <>
                    <button
                      type="button"
                      className={
                        publicLiveEnabled
                          ? "admin-inline-button admin-inline-button--danger"
                          : "admin-inline-button admin-inline-button--primary"
                      }
                      disabled={liveFeatureBusy}
                      onClick={() => setLiveFeature({ enabled: !publicLiveEnabled })}
                    >
                      {publicLiveEnabled ? "Disable public live" : "Approve public live"}
                    </button>
                    <button
                      type="button"
                      className={
                        liveAudioEnabled
                          ? "admin-inline-button admin-inline-button--danger"
                          : "admin-inline-button admin-inline-button--primary"
                      }
                      disabled={liveFeatureBusy || !publicLiveEnabled}
                      title={
                        publicLiveEnabled
                          ? undefined
                          : "Approve public live before enabling commentary audio"
                      }
                      onClick={() => setLiveFeature({ audioEnabled: !liveAudioEnabled })}
                    >
                      {liveAudioEnabled
                        ? "Disable live commentary"
                        : "Approve live commentary"}
                    </button>
                  </>
                );
              })()}
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

          {csvModalOpen && selected && (
            <MatchCsvIngestModal
              matchId={selected.id}
              matchLabel={`${selected.homeTeam.name} vs ${selected.awayTeam.name}`}
              isFinished={selected.status === "finished"}
              onClose={() => setCsvModalOpen(false)}
              onSuccess={() => {
                refresh();
                loadTimeline(selected.id);
              }}
            />
          )}
          {statsModalOpen && selected && (
            <MatchStatsUpdateModal
              matchId={selected.id}
              matchLabel={`${selected.homeTeam.name} vs ${selected.awayTeam.name}`}
              homeTeam={selected.homeTeam}
              awayTeam={selected.awayTeam}
              stats={selected.stats}
              onClose={() => setStatsModalOpen(false)}
              onSuccess={() => {
                refresh();
                loadTimeline(selected.id);
              }}
            />
          )}
        </>
      )}

      <FriendlyFormModal
        open={friendlyOpen}
        onClose={() => setFriendlyOpen(false)}
        onCreated={(matchId) => {
          refresh();
          setSelectedId(matchId);
        }}
      />

      <FixtureFormModal
        open={fixtureOpen}
        competitions={competitionOptions}
        onClose={() => setFixtureOpen(false)}
        onCreated={(matchId) => {
          refresh();
          setSelectedId(matchId);
        }}
      />
    </section>
  );
}
