import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  claimVisionTask,
  convertVisionQueueItem,
  fetchVisionAnnotationQueue,
  fetchVisionLabelSchemas,
  fetchVisionMixReport,
  fetchVisionHardFrameRuns,
  fetchVisionAnnotationReviewQueue,
  fetchVisionLabellerProgress,
  fetchVisionReviewedAnnotations,
  queueVisionHardFrames,
  type VisionLabellerProgress,
  type SamplingStrategy,
  type VisionHardFrameRun,
  type VisionAnnotationReviewTask,
  type VisionReviewedDecision,
  type ReviewDecisionKind,
  type VisionActiveLearningItem,
  type VisionLabelSchema,
  type VisionMixReport,
} from "../../../api/vision";
import { useAdminAuth } from "../AdminAuthContext";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { formatClock } from "./annotation-time";
import { rejectionLabel, taskRef } from "./annotation-labels";

/**
 * The annotation queue.
 *
 * Two things live here that are easy to leave out and expensive to add later.
 *
 * The **hard-case share** is on screen rather than buried in a report, because
 * uniform random sampling produces a corpus of easy frames — mostly midfield, mostly
 * clear, mostly nothing happening — and a model trained on that looks fine in
 * evaluation and fails on the crowded penalty box that decides matches. If nobody
 * sees the number, it drifts.
 *
 * **Average correction time** is beside it, because a pre-labelling model that is 5%
 * more accurate and doubles correction time is operationally worse for DTP. Without
 * the minutes on screen, nobody can tell which of those happened.
 */

const STRATEGY_LABELS: Record<SamplingStrategy, string> = {
  uniform_random: "Random (control)",
  low_confidence: "Model unsure",
  stage_disagreement: "Stages disagreed",
  reviewer_disagreement: "Reviewers disagreed",
  new_domain_slice: "Under-covered conditions",
  business_value: "Commercially important",
  targeted_event: "Targeted event type",
};

const STATE_LABELS: Record<string, string> = {
  queued: "Waiting",
  assigned: "Being labelled",
  submitted: "Awaiting review",
  approved: "Approved",
  rejected: "Sent back",
  abandoned: "Abandoned",
};

/* Text carries the verdict; the pill's colour only reinforces it. */
const VERDICTS: Record<ReviewDecisionKind, { label: string; pill: string }> = {
  approved: { label: "Approved", pill: "is-acquired" },
  corrected: { label: "Corrected", pill: "is-progress" },
  rejected: { label: "Sent back", pill: "is-refused" },
};

export function AdminVisionAnnotationPage() {
  usePageTitle("Annotation queue");
  const navigate = useNavigate();
  const { hasPermission } = useAdminAuth();
  /* Reviewing needs vision.review; the API refuses the list to anyone without it. */
  const canReview = hasPermission("vision.review");
  /* Claiming needs vision.annotate; a reviewer-only account comes here for the review list. */
  const canAnnotate = hasPermission("vision.annotate");
  /* Deciding what gets labelled (queueing frames, making tasks) is a corpus decision: vision.datasets.manage. */
  const canManage = hasPermission("vision.datasets.manage");

  const [mix, setMix] = useState<VisionMixReport | null>(null);
  const [review, setReview] = useState<{ waiting: number; yours: number; tasks: VisionAnnotationReviewTask[] } | null>(null);
  const [reviewed, setReviewed] = useState<{ total: number; decisions: VisionReviewedDecision[] } | null>(null);
  const [labellers, setLabellers] = useState<VisionLabellerProgress[] | null>(null);
  const [queue, setQueue] = useState<VisionActiveLearningItem[]>([]);
  const [runs, setRuns] = useState<VisionHardFrameRun[]>([]);
  const [schemas, setSchemas] = useState<VisionLabelSchema[]>([]);
  const [strategy, setStrategy] = useState<SamplingStrategy | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /* Shown inside the picked-frames panel, beside the button, not at the top of the page. */
  const [runMessage, setRunMessage] = useState<{ error: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [mixReport, queueResult, schemaResult, runResult, reviewResult, progressResult, reviewedResult] = await Promise.all([
        fetchVisionMixReport(),
        fetchVisionAnnotationQueue(50),
        fetchVisionLabelSchemas(),
        fetchVisionHardFrameRuns(),
        canReview ? fetchVisionAnnotationReviewQueue(50) : Promise.resolve(null),
        canReview ? fetchVisionLabellerProgress() : Promise.resolve(null),
        canReview ? fetchVisionReviewedAnnotations(50) : Promise.resolve(null),
      ]);
      setReview(reviewResult);
      setReviewed(reviewedResult);
      setLabellers(progressResult?.labellers ?? null);
      setRuns(runResult.runs);
      setMix(mixReport);
      setQueue(queueResult.items);
      setSchemas(schemaResult.schemas);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [canReview]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The schema new work is created against: the newest one not yet retired. */
  const activeSchema = useMemo(
    () => schemas.find((s) => !s.supersededAt) ?? null,
    [schemas]
  );

  /** Claims as the signed-in person: the API takes the annotator from the session. */
  async function claim() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await claimVisionTask(strategy || undefined);
      if (!result.task) {
        setNotice("Nothing waiting. The queue is empty for that filter.");
        return;
      }
      navigate(`/admin/vision/workstation/${result.task.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function convert(item: VisionActiveLearningItem) {
    if (!activeSchema) {
      setError("No current label schema. Publish one before turning queued windows into work.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await convertVisionQueueItem(item.id, { labelSchemaVersionId: activeSchema.id });
      setNotice(`Queued window is now a task, sampled as "${STRATEGY_LABELS[item.reason]}".`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const hardShare = mix?.hardCaseShare;

  return (
    <>
      <AdminPageHeader
        title="Annotation queue"
        description="Claim a window to label, and see what the corpus is actually made of."
        crumbs={[{ label: "Vision", to: "/admin/vision" }, { label: "Annotation" }]}
      />

      {error && (
        <div className="vision-panel vision-panel--error" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="vision-panel">{notice}</div>}

      <section className="vision-panel">
        <h2 className="vision-panel__title">What the corpus is made of</h2>
        {!mix ? (
          <p className="vision-footnote">Loading…</p>
        ) : (
          <>
            <dl className="vision-stats">
              <div>
                <dt>Tasks</dt>
                <dd>{mix.tasks}</dd>
              </div>
              <div>
                <dt>Hard-case share</dt>
                {/* null, not 0, when there is no data: "no hard cases" and "no
                    tasks yet" are different claims and must not read alike. */}
                <dd>
                  {hardShare === null || hardShare === undefined
                    ? "— no tasks yet"
                    : `${Math.round(hardShare * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>Average correction time</dt>
                <dd>
                  {mix.effort.averageMinutes === null
                    ? "— not recorded"
                    : `${mix.effort.averageMinutes.toFixed(1)} min`}
                </dd>
              </div>
              <div>
                <dt>Submissions</dt>
                <dd>{mix.effort.submissions}</dd>
              </div>
            </dl>

            {hardShare !== null && hardShare !== undefined && hardShare < 0.5 && (
              <p className="vision-note">
                Over half of this corpus is random sampling. That produces a lot of easy
                frames: expect evaluation to look better than match-day performance.
              </p>
            )}

            <div className="vision-grid-2">
              <Tally title="Sampled because" counts={mix.bySamplingStrategy} labels={STRATEGY_LABELS} />
              <Tally title="Task state" counts={mix.byState} labels={STATE_LABELS} />
            </div>
            {Object.keys(mix.rejectionReasons).length > 0 && (
              <Tally title="Why work was sent back" counts={mix.rejectionReasons} labels={{}} />
            )}
          </>
        )}
      </section>

      {canAnnotate && <section className="vision-panel">
        <h2 className="vision-panel__title">Claim a window</h2>
        <div className="vision-filters">
          <label>
            <span>Only this kind</span>
            <select
              value={strategy}
              onChange={(event) => setStrategy(event.target.value as SamplingStrategy | "")}
            >
              <option value="">Anything waiting</option>
              {(Object.keys(STRATEGY_LABELS) as SamplingStrategy[]).map((key) => (
                <option key={key} value={key}>
                  {STRATEGY_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={claim} disabled={busy}>
            {busy ? "Claiming…" : "Claim next window"}
          </button>
        </div>
        <p className="vision-footnote">
          Claiming is atomic, so two people opening this at the same moment are given
          different windows.
        </p>
      </section>}

      {canReview && review && (
        <section className="vision-panel">
          <h2 className="vision-panel__title">Waiting for your review</h2>
          <p className="vision-footnote">
            Submitted work, oldest first. Only approved work enters a training set, and nobody may
            approve their own: {review.yours > 0 ? `${review.yours} of yours wait for someone else.` : "none of these is yours."}
          </p>
          {review.tasks.length === 0 ? (
            <p className="vision-footnote">Nothing waiting for review.</p>
          ) : (
            <>
              <table className="vision-table">
                <thead><tr><th scope="col">Task</th><th scope="col">Submitted</th><th scope="col">By</th><th scope="col">Footage</th><th scope="col">Window</th><th scope="col">Why sampled</th><th scope="col" /></tr></thead>
                <tbody>
                  {review.tasks.map((task) => (
                    <tr key={task.taskId}>
                      <td className="vision-mono" title={task.taskId}>{taskRef(task.taskId)}</td>
                      <td>
                        {new Date(task.submittedAt).toLocaleString()}
                        {task.sentBackBefore && (
                          <div className="vision-sub">
                            <span className="vision-pill is-progress">Resubmitted</span>{" "}
                            sent back {new Date(task.sentBackBefore.at).toLocaleDateString()}: {rejectionLabel(task.sentBackBefore.reason)}
                          </div>
                        )}
                      </td>
                      <td>{task.annotator ?? "—"}</td>
                      <td>{task.source ?? <span className="vision-mono">{task.videoAssetId.slice(0, 8)}</span>}</td>
                      <td>{formatClock(task.startMs)}</td>
                      <td>{STRATEGY_LABELS[task.samplingStrategy] ?? task.samplingStrategy}</td>
                      <td><button type="button" onClick={() => navigate(`/admin/vision/workstation/${task.taskId}`)}>Review</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {review.waiting > review.tasks.length && (
                <p className="vision-footnote">Showing the oldest {review.tasks.length} of {review.waiting}.</p>
              )}
            </>
          )}
        </section>
      )}

      {canReview && reviewed && (
        <section className="vision-panel">
          <h2 className="vision-panel__title">Already reviewed</h2>
          <p className="vision-footnote">
            Every verdict given on labelling work, newest first. A frame sent back and approved later
            appears twice, under the same task number.
          </p>
          {reviewed.decisions.length === 0 ? (
            <p className="vision-footnote">Nothing reviewed yet.</p>
          ) : (
            <>
              <table className="vision-table">
                <thead><tr><th scope="col">Task</th><th scope="col">Reviewed</th><th scope="col">Verdict</th><th scope="col">Labelled by</th><th scope="col">Footage</th><th scope="col">Window</th><th scope="col" /></tr></thead>
                <tbody>
                  {reviewed.decisions.map((d) => {
                    const verdict = VERDICTS[d.decision] ?? { label: d.decision, pill: "" };
                    return (
                      <tr key={d.decisionId}>
                        <td className="vision-mono" title={d.taskId}>{taskRef(d.taskId)}</td>
                        <td>
                          {new Date(d.reviewedAt).toLocaleString()}
                          {d.reviewer && <div className="vision-sub">by {d.reviewer}</div>}
                        </td>
                        <td>
                          <span className={`vision-pill ${verdict.pill}`}>{verdict.label}</span>
                          {d.decision === "rejected" && <div className="vision-sub">{rejectionLabel(d.rejectionReason)}</div>}
                        </td>
                        <td>{d.annotator ?? "—"}</td>
                        <td>{d.source ?? <span className="vision-mono">{d.videoAssetId.slice(0, 8)}</span>}</td>
                        <td>{formatClock(d.startMs)}</td>
                        <td><button type="button" onClick={() => navigate(`/admin/vision/workstation/${d.taskId}`)}>Open</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {reviewed.total > reviewed.decisions.length && (
                <p className="vision-footnote">Showing the latest {reviewed.decisions.length} of {reviewed.total}.</p>
              )}
            </>
          )}
        </section>
      )}

      {canReview && labellers && (
        <section className="vision-panel">
          <h2 className="vision-panel__title">Labellers</h2>
          <p className="vision-footnote">
            Each person&apos;s output and pace. Minutes are medians per attempt, so one frame left open
            does not skew them; &ldquo;recent&rdquo; is the latest 20. A frame counts for whoever made its latest attempt.
          </p>
          {labellers.length === 0 ? (
            <p className="vision-footnote">Nobody has claimed or submitted anything yet.</p>
          ) : (
            <table className="vision-table">
              <thead>
                <tr>
                  <th scope="col">Labeller</th><th scope="col">Frames</th><th scope="col">Approved</th><th scope="col">Waiting review</th>
                  <th scope="col">Sent back</th><th scope="col">Holding</th><th scope="col">Min a frame</th><th scope="col">Last submitted</th>
                </tr>
              </thead>
              <tbody>
                {labellers.map((l) => (
                  <tr key={l.annotatorId}>
                    <td>{l.name}</td>
                    <td>{l.frames}{l.attempts > l.frames && <span className="vision-footnote"> ({l.attempts} attempts)</span>}</td>
                    <td>{l.approved}</td>
                    <td>{l.awaitingReview}</td>
                    <td>{l.sentBack}</td>
                    <td title="Claimed and not submitted, plus sent back and not yet fixed">{l.claimed + l.toFix}{l.toFix > 0 && <span className="vision-footnote"> ({l.toFix} to fix)</span>}</td>
                    <td>
                      {l.medianMinutes === null ? "—" : l.medianMinutes}
                      {l.recentMedianMinutes !== null && l.attempts > 20 && <span className="vision-footnote"> (recent {l.recentMedianMinutes})</span>}
                    </td>
                    <td>{l.lastSubmittedAt ? new Date(l.lastSubmittedAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="vision-panel">
        <h2 className="vision-panel__title">Frames picked for labelling</h2>
        <p className="vision-footnote">
          Each hard_frames run picked the frames where the detector most likely failed, plus a
          share of ordinary play, with the detector's boxes as a starting point. Queueing a run
          puts its frames below; a task made from one opens with those boxes, marked as a model's.
          A second run over the same footage and detect run picks the same frames, so once one is
          queued the others are not.
        </p>
        {runs.length === 0 ? (
          <p className="vision-footnote">No hard_frames run yet. Queue one from the pipeline after detect and ball trajectory.</p>
        ) : (
          <table className="vision-table">
            <thead><tr><th scope="col">Run</th><th scope="col">Asset</th><th scope="col">Frames</th><th scope="col">Why picked</th><th scope="col"></th></tr></thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.jobId}>
                  <td className="vision-mono">{run.jobId.slice(0, 8)}</td>
                  <td className="vision-mono">{run.videoAssetId.slice(0, 8)}</td>
                  <td>{run.frames ?? "—"}</td>
                  <td>{run.causes ? Object.entries(run.causes).map(([cause, n]) => `${cause.replace(/_/g, " ")} ${n}`).join(", ") : "—"}</td>
                  <td>
                    {run.queued > 0 ? <span className="vision-footnote">{run.queued} queued</span>
                      : run.alreadyQueuedAs ? <span className="vision-footnote" title={`Run ${run.alreadyQueuedAs} picked these frames from the same footage and detect run, and its frames are queued.`}>already queued as <span className="vision-mono">{run.alreadyQueuedAs.slice(0, 8)}</span></span>
                      : !canManage ? <span className="vision-footnote">not queued</span> : (
                      <button type="button" disabled={busy} onClick={async () => {
                        setBusy(true); setRunMessage(null);
                        try { const r = await queueVisionHardFrames(run.jobId); setRunMessage({ error: false, text: `${r.queued} frame(s) queued for labelling.` }); await load(); }
                        catch (cause) { setRunMessage({ error: true, text: cause instanceof Error ? cause.message : String(cause) }); }
                        finally { setBusy(false); }
                      }}>Queue {run.frames ?? ""} frames</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {runMessage && (
          <p className={runMessage.error ? "vision-panel vision-panel--error" : "vision-footnote"} role={runMessage.error ? "alert" : "status"}>{runMessage.text}</p>
        )}
      </section>

      <section className="vision-panel">
        <h2 className="vision-panel__title">Waiting to be looked at</h2>
        <p className="vision-footnote">
          Windows the pipeline or a reviewer flagged, highest priority first. Turning one
          into a task carries its reason across, so the mix report stays honest.
        </p>
        {queue.length === 0 ? (
          <p className="vision-footnote">Nothing flagged.</p>
        ) : (
          <table className="vision-table">
            <thead>
              <tr>
                <th scope="col">Why</th>
                <th scope="col">Priority</th>
                <th scope="col">Window</th>
                <th scope="col">Asset</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => (
                <tr key={item.id}>
                  <td>{STRATEGY_LABELS[item.reason] ?? item.reason}</td>
                  <td>{item.score.toFixed(2)}</td>
                  <td>
                    {formatClock(item.startMs)} – {formatClock(item.endMs)}
                  </td>
                  <td className="vision-mono">{item.videoAssetId.slice(0, 8)}</td>
                  <td>
                    {canManage && <button type="button" onClick={() => convert(item)} disabled={busy}>
                      Make it a task
                    </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Tally({
  title,
  counts,
  labels,
}: {
  title: string;
  counts: Record<string, number>;
  labels: Record<string, string>;
}) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="vision-subhead">{title}</h3>
      <table className="vision-table">
        <tbody>
          {rows.map(([key, count]) => (
            <tr key={key}>
              <td>{labels[key] ?? key.replace(/_/g, " ")}</td>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
