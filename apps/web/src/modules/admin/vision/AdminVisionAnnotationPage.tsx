import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  claimVisionTask,
  convertVisionQueueItem,
  fetchVisionAnnotationQueue,
  fetchVisionLabelSchemas,
  fetchVisionMixReport,
  type SamplingStrategy,
  type VisionActiveLearningItem,
  type VisionLabelSchema,
  type VisionMixReport,
} from "../../../api/vision";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { formatClock } from "./annotation-time";

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

/** Remembered so a returning annotator is not asked again every visit. */
const ANNOTATOR_KEY = "dtp.vision.annotatorId";

function readStoredAnnotator(): string {
  try {
    return window.localStorage.getItem(ANNOTATOR_KEY) ?? "";
  } catch {
    // Private windows and blocked site data both throw here. Losing a remembered
    // name is a nuisance, not a failure, so the page carries on without it.
    return "";
  }
}

export function AdminVisionAnnotationPage() {
  usePageTitle("Annotation queue");
  const navigate = useNavigate();

  const [mix, setMix] = useState<VisionMixReport | null>(null);
  const [queue, setQueue] = useState<VisionActiveLearningItem[]>([]);
  const [schemas, setSchemas] = useState<VisionLabelSchema[]>([]);
  const [annotatorId, setAnnotatorId] = useState(readStoredAnnotator);
  const [strategy, setStrategy] = useState<SamplingStrategy | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [mixReport, queueResult, schemaResult] = await Promise.all([
        fetchVisionMixReport(),
        fetchVisionAnnotationQueue(50),
        fetchVisionLabelSchemas(),
      ]);
      setMix(mixReport);
      setQueue(queueResult.items);
      setSchemas(schemaResult.schemas);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** The schema new work is created against: the newest one not yet retired. */
  const activeSchema = useMemo(
    () => schemas.find((s) => !s.supersededAt) ?? null,
    [schemas]
  );

  async function claim() {
    if (!annotatorId.trim()) {
      setError("Enter who you are first, so two people are not given the same window.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      window.localStorage.setItem(ANNOTATOR_KEY, annotatorId.trim());
    } catch {
      // Not remembering the name is survivable; failing the claim over it is not.
    }
    try {
      const result = await claimVisionTask(annotatorId.trim(), strategy || undefined);
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

      <section className="vision-panel">
        <h2 className="vision-panel__title">Claim a window</h2>
        <div className="vision-filters">
          <label>
            <span>Who are you?</span>
            <input
              value={annotatorId}
              onChange={(event) => setAnnotatorId(event.target.value)}
              placeholder="your account id"
              autoComplete="off"
            />
          </label>
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
                    <button type="button" onClick={() => convert(item)} disabled={busy}>
                      Make it a task
                    </button>
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
