import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  cancelVisionJob,
  fetchVisionAllJobs,
  fetchVisionDispatcher,
  fetchVisionJobEvents,
  fetchVisionWorkers,
  provisionVisionWorker,
  retireVisionWorker,
  retryVisionJob,
  tickVisionDispatcher,
  type VisionDispatcherHealth,
  type VisionJobRow,
  type VisionWorkerRow,
} from "../../../api/vision";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminAuth } from "../AdminAuthContext";
import { useAdminVisionContext } from "./AdminVisionLayout";
import { VISION_JOB_STATES } from "@dtp/vision-contracts";
import { STAGES, UNFINISHED_JOB_STATES } from "./pipeline";
import { Field, Panel, Pill, Row, formatWhen, short, toneOfState, useAction } from "./vision-ui";

const JOB_STATES: readonly string[] = VISION_JOB_STATES;

/**
 * The pipeline as a whole: every job with retry and cancel, the dispatcher's
 * health with a tick, and every worker with provision and retire. A job's
 * event log opens inline, because "why did it fail" is the question this page
 * exists to answer.
 */
export function AdminVisionPipelinePage() {
  usePageTitle("Pipeline");
  const { hasPermission } = useAdminAuth();
  const { refreshOverview } = useAdminVisionContext();
  const [jobs, setJobs] = useState<VisionJobRow[] | null>(null);
  const [workers, setWorkers] = useState<VisionWorkerRow[]>([]);
  const [dispatcher, setDispatcher] = useState<VisionDispatcherHealth | null>(null);
  const [state, setState] = useState("");
  const [type, setType] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, { id: string; kind: string; message: string | null; createdAt: string }[]>>({});
  const [resourceClass, setResourceClass] = useState("cpu_small");
  const [providerId, setProviderId] = useState("local");
  const [token, setToken] = useState<{ workerId: string; bootstrapToken: string; expiresAt: string } | null>(null);

  const load = useCallback(async () => {
    const [j, w, d] = await Promise.all([fetchVisionAllJobs({ state: state || undefined, type: type || undefined }), fetchVisionWorkers(), fetchVisionDispatcher()]);
    setJobs(j.jobs);
    setWorkers(w.workers);
    setDispatcher(d);
    await refreshOverview();
  }, [refreshOverview, state, type]);
  const { busy, run, messages, setError } = useAction(load);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load, setError]);

  const canRun = hasPermission("vision.jobs.run");

  async function toggleEvents(jobId: string) {
    if (open === jobId) {
      setOpen(null);
      return;
    }
    setOpen(jobId);
    if (!events[jobId]) {
      try {
        const e = await fetchVisionJobEvents(jobId);
        setEvents((prev) => ({ ...prev, [jobId]: e.events }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const alive = (w: VisionWorkerRow) => !w.retiredAt && Date.now() - new Date(w.lastSeenAt).getTime() < 10 * 60 * 1000;

  return (
    <div className="vision-page">
      {messages}
      <Panel
        title="Dispatcher"
        actions={canRun && <button type="button" disabled={busy} onClick={() => run("Dispatcher ticked: stale jobs reaped, expired sessions closed.", tickVisionDispatcher)}>Tick now</button>}
      >
        {dispatcher ? (
          <>
            <Row label="Running" value={<Pill tone={dispatcher.dispatcherRunning ? "ok" : "bad"}>{dispatcher.dispatcherRunning ? "yes" : "no"}</Pill>} />
            <Row label="Oldest queued" value={dispatcher.oldestQueuedAgeSeconds === null ? "nothing queued" : `${Math.round(dispatcher.oldestQueuedAgeSeconds)}s`} />
            <Row label="Stale heartbeats" value={dispatcher.staleHeartbeats} note="Jobs whose worker went quiet; the next tick requeues or fails them." />
            <Row label="Ticks" value={`${dispatcher.stats.ticks ?? 0} · requeued ${dispatcher.stats.requeued ?? 0} · failed ${dispatcher.stats.failed ?? 0} · errors ${dispatcher.stats.errors ?? 0}`} />
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </Panel>

      <Panel title="Workers">
        {workers.length === 0 ? (
          <p className="muted">No worker has ever registered. On the staging box the compose stack runs one under the vision profile; a hosted one is provisioned below.</p>
        ) : (
          <div className="admin-sb-table-wrap">
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">Worker</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Class</th>
                  <th scope="col">Image</th>
                  <th scope="col">Seen</th>
                  <th scope="col">Jobs</th>
                  {canRun && <th scope="col" />}
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <code className="vision-mono">{short(w.id)}</code> <Pill tone={w.retiredAt ? "muted" : alive(w) ? "ok" : "warn"}>{w.retiredAt ? "retired" : alive(w) ? "alive" : "quiet"}</Pill>
                    </td>
                    <td>{w.providerId}</td>
                    <td>{w.resourceClass}</td>
                    <td className="muted vision-sub">{w.image}</td>
                    <td className="muted vision-sub">
                      first {formatWhen(w.firstSeenAt)}
                      <br />
                      last {formatWhen(w.lastSeenAt)}
                    </td>
                    <td>{w.jobsCompleted}</td>
                    {canRun && (
                      <td>
                        {!w.retiredAt && (
                          <button type="button" disabled={busy} onClick={() => run(`Worker ${short(w.id)} retired.`, () => retireVisionWorker(w.id))}>
                            Retire
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canRun && (
          <form
            className="vision-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run("Worker provisioned: the bootstrap token below is shown once.", async () => {
                const out = await provisionVisionWorker({ resourceClass, providerId });
                setToken({ workerId: out.workerId, bootstrapToken: out.bootstrapToken, expiresAt: out.bootstrapExpiresAt });
              });
            }}
          >
            <Field label="Provision a worker" hint="A hosted provider launches it; the local provider expects you to start the container yourself with the token.">
              <div className="vision-inline">
                <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                  <option value="local">local</option>
                  <option value="runpod">runpod</option>
                  <option value="lambda">lambda</option>
                  <option value="mock">mock</option>
                </select>
                <select value={resourceClass} onChange={(e) => setResourceClass(e.target.value)}>
                  <option value="cpu_small">cpu_small</option>
                  <option value="gpu_24gb">gpu_24gb</option>
                  <option value="gpu_48gb">gpu_48gb</option>
                  <option value="gpu_80gb">gpu_80gb</option>
                </select>
                <button type="submit" disabled={busy}>
                  Provision
                </button>
              </div>
            </Field>
            {token && (
              <div className="vision-panel vision-panel--ok vision-token">
                <div>
                  Worker <code className="vision-mono">{short(token.workerId)}</code> · token expires {formatWhen(token.expiresAt)}
                </div>
                <code className="vision-token__value">{token.bootstrapToken}</code>
                <div className="vision-sub muted">VISION_BOOTSTRAP_TOKEN for the container; it stops working the moment the worker registers.</div>
              </div>
            )}
          </form>
        )}
      </Panel>

      <Panel title="Jobs">
        <div className="vision-filters">
          <label>
            <span>State</span>
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Any</option>
              {JOB_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Stage</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Any</option>
              {STAGES.map((s) => (
                <option key={s.type} value={s.type}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {jobs === null ? (
          <p className="muted">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="muted">No jobs match.</p>
        ) : (
          <div className="admin-sb-table-wrap">
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Stage</th>
                  <th scope="col">State</th>
                  <th scope="col">Asset</th>
                  <th scope="col">Queued</th>
                  <th scope="col">Finished</th>
                  <th scope="col">Attempt</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <Fragment key={j.id}>
                    <tr>
                      <td>
                        <button type="button" className="vision-linklike" onClick={() => void toggleEvents(j.id)}>
                          <code className="vision-mono">{short(j.id)}</code> {open === j.id ? "▾" : "▸"}
                        </button>
                      </td>
                      <td>{j.type}</td>
                      <td>
                        <Pill tone={toneOfState(j.state)}>{j.state}</Pill>
                        {j.error && <div className="vision-warn vision-sub">{j.error}</div>}
                      </td>
                      <td>{j.videoAssetId ? <Link to={`/admin/vision/events?asset=${j.videoAssetId}`}><code className="vision-mono">{short(j.videoAssetId)}</code></Link> : "—"}</td>
                      <td className="muted vision-sub">{formatWhen(j.queuedAt)}</td>
                      <td className="muted vision-sub">{formatWhen(j.finishedAt)}</td>
                      <td className="muted">
                        {j.attemptNumber}/{j.maxAttempts}
                      </td>
                      <td>
                        {canRun && ["failed", "cancelled"].includes(j.state) && (
                          <button type="button" disabled={busy} onClick={() => run(`Job ${short(j.id)} queued again.`, () => retryVisionJob(j.id))}>
                            Retry
                          </button>
                        )}
                        {canRun && UNFINISHED_JOB_STATES.includes(j.state) && (
                          <button type="button" disabled={busy} onClick={() => run(`Job ${short(j.id)} cancelled.`, () => cancelVisionJob(j.id, "cancelled from the pipeline page"))}>
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === j.id && (
                      <tr className="vision-table__detail">
                        <td colSpan={8}>
                          {events[j.id] ? (
                            events[j.id]!.length === 0 ? (
                              <span className="muted">No events recorded.</span>
                            ) : (
                              <ul className="vision-events">
                                {events[j.id]!.map((e) => (
                                  <li key={e.id}>
                                    <span className="muted vision-sub">{formatWhen(e.createdAt)}</span> <strong>{e.kind}</strong> {e.message}
                                  </li>
                                ))}
                              </ul>
                            )
                          ) : (
                            <span className="muted">Loading events…</span>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
