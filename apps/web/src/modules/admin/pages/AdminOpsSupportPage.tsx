import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  adminApi,
  type DeploymentIncidentResult,
  type SupportDiagnostics,
  type SupportPlaybookEntry,
  type SupportReport,
  type SupportReviewQueue,
  type SupportTriagePacket,
} from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";

const STATUSES = ["open", "triaged", "waiting_on_human", "resolved", "closed"] as const;
const PLAYBOOK_OUTCOMES = [
  "not_reviewed",
  "confirmed",
  "updated",
  "new_entry_needed",
] as const;
const CATEGORIES = [
  "scoreboard_ops",
  "player_data",
  "calibration",
  "tracker_ocr",
  "media_highlights",
  "content_admin",
  "deployment",
  "access_permissions",
  "other",
] as const;

function pretty(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type RecommendationQuickAction = {
  label: string;
  href: string;
  detail: string;
};

const QUICK_ACTIONS_BY_KEY: Record<string, RecommendationQuickAction[]> = {
  "scoreboard-supervisor-offline": [
    {
      label: "Open Match Center",
      href: "/admin/scoreboard/match-center",
      detail: "Check active fixtures, live controls, and supervisor state.",
    },
    {
      label: "Review fixtures",
      href: "/admin/scoreboard/entities",
      detail: "Confirm fixture status, kickoff, venue, and competition setup.",
    },
  ],
  "timeline-csv-upload-errors": [
    {
      label: "Open Match Center",
      href: "/admin/scoreboard/match-center",
      detail: "Upload or inspect timeline CSV event data.",
    },
    {
      label: "Open Entities",
      href: "/admin/scoreboard/entities",
      detail: "Check player names, fixtures, and CSV seed tools.",
    },
  ],
  "standings-not-updating": [
    {
      label: "Open Match Center",
      href: "/admin/scoreboard/match-center",
      detail: "Verify full-time score and match completion state.",
    },
    {
      label: "Review fixtures",
      href: "/admin/scoreboard/entities",
      detail: "Confirm competition and fixture records.",
    },
  ],
  "duplicate-player-profile": [
    {
      label: "Open Name QA",
      href: "/admin/scoreboard/entities",
      detail: "Merge duplicate names and preserve ScoreBoard history.",
    },
    {
      label: "Open Players",
      href: "/admin/players",
      detail: "Review canonical player records and profile visibility.",
    },
  ],
  "scoreboard-history-not-linking": [
    {
      label: "Open Name QA",
      href: "/admin/scoreboard/entities",
      detail: "Normalize names and connect timeline mentions to profiles.",
    },
    {
      label: "Open Players",
      href: "/admin/players",
      detail: "Find existing profiles before creating or merging records.",
    },
  ],
  "tracker-ocr-extraction": [
    {
      label: "Tracker Stats Extractor",
      href: "/admin/player-stats-extractor",
      detail: "Re-run OCR extraction and compare flagged stats.",
    },
  ],
  "calibration-save-display": [
    {
      label: "Open Calibration",
      href: "/admin/calibration",
      detail: "Check saved height, weight, benchmark, and rating data.",
    },
    {
      label: "Open Players",
      href: "/admin/players",
      detail: "Confirm public profile fields after calibration.",
    },
  ],
  "highlight-approval-flow": [
    {
      label: "Open Highlights",
      href: "/admin/scoreboard/highlights",
      detail: "Check uploaded clips and publish status.",
    },
    {
      label: "Supervisor Review",
      href: "/scoreboard/supervisor",
      detail: "Review and approve queued media from the supervisor page.",
    },
  ],
  "production-seed-failure": [
    {
      label: "Open Database Tools",
      href: "/admin/database",
      detail: "Run or inspect production-safe seed workflows.",
    },
    {
      label: "Open Entities",
      href: "/admin/scoreboard/entities",
      detail: "Review CSV seeders and scoreboard records.",
    },
  ],
  "ci-prisma-constraint": [
    {
      label: "Open Database Tools",
      href: "/admin/database",
      detail: "Inspect seed and database maintenance actions.",
    },
    {
      label: "Open Name QA",
      href: "/admin/scoreboard/entities",
      detail: "Merge duplicate players before enforcing unique mappings.",
    },
  ],
  "deployment-health-timeout": [
    {
      label: "Refresh Ops Support",
      href: "/admin/ops-support",
      detail: "Recheck diagnostics after deployment or service restart.",
    },
    {
      label: "Open Database Tools",
      href: "/admin/database",
      detail: "Verify db push and seed status before health checks.",
    },
  ],
  "deployment-env-missing": [
    {
      label: "Refresh Ops Support",
      href: "/admin/ops-support",
      detail: "Confirm environment-related diagnostics and next actions.",
    },
  ],
};

const QUICK_ACTIONS_BY_CATEGORY: Record<string, RecommendationQuickAction[]> = {
  scoreboard_ops: [
    {
      label: "Open Match Center",
      href: "/admin/scoreboard/match-center",
      detail: "Control live fixtures, timelines, and score updates.",
    },
    {
      label: "Open Entities",
      href: "/admin/scoreboard/entities",
      detail: "Review competitions, teams, fixtures, players, and Name QA.",
    },
  ],
  player_data: [
    {
      label: "Open Players",
      href: "/admin/players",
      detail: "Review canonical player records and profile data.",
    },
    {
      label: "Open Name QA",
      href: "/admin/scoreboard/entities",
      detail: "Merge duplicate names and timeline mentions.",
    },
  ],
  calibration: [
    {
      label: "Open Calibration",
      href: "/admin/calibration",
      detail: "Review player benchmark and rating inputs.",
    },
  ],
  tracker_ocr: [
    {
      label: "Tracker Stats Extractor",
      href: "/admin/player-stats-extractor",
      detail: "Upload tracker screenshots and verify extracted CSV stats.",
    },
  ],
  media_highlights: [
    {
      label: "Open Highlights",
      href: "/admin/scoreboard/highlights",
      detail: "Review uploaded match clips and publish status.",
    },
  ],
  content_admin: [
    {
      label: "Open Content",
      href: "/admin/content",
      detail: "Review editable public page content.",
    },
  ],
  deployment: [
    {
      label: "Open Database Tools",
      href: "/admin/database",
      detail: "Check seed and database operations.",
    },
    {
      label: "Refresh Ops Support",
      href: "/admin/ops-support",
      detail: "Reload deployment diagnostics and support reports.",
    },
  ],
  access_permissions: [
    {
      label: "Open RBAC",
      href: "/admin/settings/roles",
      detail: "Review roles and permissions for blocked admins.",
    },
  ],
};

function quickActionsForRecommendation(
  recommendation?: SupportPlaybookEntry | null,
  category?: string | null
) {
  const fromKey = recommendation?.key ? QUICK_ACTIONS_BY_KEY[recommendation.key] : undefined;
  if (fromKey?.length) return fromKey;
  if (category) return QUICK_ACTIONS_BY_CATEGORY[category] ?? [];
  if (recommendation?.category) return QUICK_ACTIONS_BY_CATEGORY[recommendation.category] ?? [];
  return [];
}

function RecommendationQuickActions({ actions }: { actions: RecommendationQuickAction[] }) {
  if (!actions.length) return null;

  return (
    <div className="admin-support-quick-actions" aria-label="Quick solution links">
      {actions.map((action) => (
        <a key={`${action.href}-${action.label}`} href={action.href} className="admin-support-quick-action">
          <strong>{action.label}</strong>
          <span>{action.detail}</span>
        </a>
      ))}
    </div>
  );
}

function DeploymentIncidentIntake({ onCreated }: { onCreated: () => void }) {
  const toast = useAdminToast();
  const [githubRunUrl, setGithubRunUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [failingStep, setFailingStep] = useState("");
  const [productionHost, setProductionHost] = useState("");
  const [notes, setNotes] = useState("");
  const [logExcerpt, setLogExcerpt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DeploymentIncidentResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const nextResult = await adminApi.createDeploymentIncident({
        githubRunUrl,
        branch,
        commitSha,
        failingStep,
        productionHost,
        notes,
        logExcerpt,
      });
      setResult(nextResult);
      toast.success("Deployment incident captured");
      setLogExcerpt("");
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to capture deployment incident");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="admin-sb-panel admin-support-panel admin-support-deployment">
      <header className="admin-support-section-head">
        <div>
          <p className="admin-support-kicker">Phase 6</p>
          <h2>Deployment log intake</h2>
          <p className="muted">
            Paste a GitHub Actions failure excerpt to create a recommendation-only deployment
            incident.
          </p>
        </div>
      </header>
      <form className="admin-support-deployment-form" onSubmit={submit}>
        <label>
          <span>GitHub Actions run URL</span>
          <input
            value={githubRunUrl}
            onChange={(event) => setGithubRunUrl(event.target.value)}
            placeholder="https://github.com/.../actions/runs/..."
          />
        </label>
        <label>
          <span>Failing step</span>
          <input
            value={failingStep}
            onChange={(event) => setFailingStep(event.target.value)}
            placeholder="Ansible deploy, db push, seed, health check"
          />
        </label>
        <label>
          <span>Branch</span>
          <input value={branch} onChange={(event) => setBranch(event.target.value)} />
        </label>
        <label>
          <span>Commit SHA</span>
          <input value={commitSha} onChange={(event) => setCommitSha(event.target.value)} />
        </label>
        <label>
          <span>Production host</span>
          <input
            value={productionHost}
            onChange={(event) => setProductionHost(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <label>
          <span>Notes</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What were you trying to deploy?"
          />
        </label>
        <label className="admin-support-deployment-form__log">
          <span>Log excerpt</span>
          <textarea
            required
            minLength={20}
            value={logExcerpt}
            onChange={(event) => setLogExcerpt(event.target.value)}
            rows={8}
            placeholder="Paste the first failing GitHub Actions log section here."
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Analyzing..." : "Create deployment incident"}
        </button>
      </form>
      {result && (
        <div className="admin-support-deployment-result">
          <header>
            <div>
              <p className="admin-support-kicker">{pretty(result.analysis.pattern)}</p>
              <h3>{result.analysis.suspectedRootCause}</h3>
            </div>
            <span
              className={`admin-support-pill ${
                result.analysis.severity === "critical"
                  ? "admin-support-pill--critical"
                  : "admin-support-pill--high"
              }`}
            >
              {result.analysis.safeToRetry ? "Retry maybe safe" : "Do not retry yet"}
            </span>
          </header>
          <div className="admin-support-triage__evidence">
            {result.analysis.matchedSignals.map((signal) => (
              <span key={signal} className="is-warning">
                {signal}
              </span>
            ))}
          </div>
          <ul>
            {result.analysis.recommendedActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
          <p className="muted">
            Created report: <strong>{result.report.subject}</strong>
          </p>
        </div>
      )}
    </section>
  );
}

function SupportReportCard({
  report,
  onChanged,
}: {
  report: SupportReport;
  onChanged: () => void;
}) {
  const toast = useAdminToast();
  const [status, setStatus] = useState(report.status);
  const [notes, setNotes] = useState(report.adminNotes ?? "");
  const [resolutionSummary, setResolutionSummary] = useState(report.resolutionSummary ?? "");
  const [playbookOutcome, setPlaybookOutcome] = useState(report.playbookOutcome);
  const [playbookProposal, setPlaybookProposal] = useState(report.playbookProposal ?? "");
  const [saving, setSaving] = useState(false);
  const [triage, setTriage] = useState<SupportTriagePacket | null>(null);
  const [triageLoading, setTriageLoading] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await adminApi.updateSupportReport(report.id, {
        status,
        adminNotes: notes,
        resolutionSummary,
        playbookOutcome,
        playbookProposal,
      });
      toast.success("Support report updated");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update report");
    } finally {
      setSaving(false);
    }
  }

  async function generateTriage() {
    setTriageLoading(true);
    try {
      const packet = await adminApi.supportReportTriage(report.id);
      setTriage(packet);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate triage packet");
    } finally {
      setTriageLoading(false);
    }
  }

  return (
    <article className="admin-support-report">
      <header className="admin-support-report__head">
        <div>
          <p className="admin-support-kicker">
            {pretty(report.category)} - {pretty(report.audience)}
          </p>
          <h3>{report.subject}</h3>
        </div>
        <span className={`admin-support-pill admin-support-pill--${report.severity}`}>
          {pretty(report.severity)}
        </span>
      </header>
      <p>{report.description}</p>
      {report.pageUrl && (
        <a href={report.pageUrl} className="text-link" target="_blank" rel="noreferrer">
          Open reported page
        </a>
      )}
      {report.recommendation && (
        <div className="admin-support-recommendation">
          <strong>{report.recommendation.title}</strong>
          <span>{pretty(report.recommendation.tier)}</span>
          <p>{report.recommendation.recommendation}</p>
          <code>{report.recommendation.playbookPath}</code>
          <RecommendationQuickActions
            actions={quickActionsForRecommendation(report.recommendation, report.category)}
          />
        </div>
      )}
      <div className="admin-support-triage-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={generateTriage}
          disabled={triageLoading}
        >
          {triageLoading ? "Generating..." : "Generate triage packet"}
        </button>
        <span>Recommendation only. Human approval required before changes.</span>
      </div>
      {triage && (
        <div className="admin-support-triage">
          <header>
            <div>
              <p className="admin-support-kicker">AI-assisted triage packet</p>
              <h4>{pretty(triage.recommendedTier)}</h4>
            </div>
            <span
              className={`admin-support-pill ${
                triage.escalationRequired
                  ? "admin-support-pill--critical"
                  : "admin-support-pill--medium"
              }`}
            >
              {triage.escalationRequired ? "Escalate" : "Human review"}
            </span>
          </header>
          <div className="admin-support-triage__block">
            <strong>Likely cause</strong>
            <p>{triage.likelyCause}</p>
          </div>
          <div className="admin-support-triage__evidence">
            {triage.evidence.map((item) => (
              <span key={`${item.label}-${item.value}`} className={`is-${item.status}`}>
                {item.label}: <strong>{item.value}</strong>
              </span>
            ))}
          </div>
          <div className="admin-support-triage__cols">
            <div>
              <strong>Diagnostic checklist</strong>
              <ul>
                {triage.diagnosticChecklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>Recommended actions</strong>
              <ul>
                {triage.recommendedActions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <RecommendationQuickActions
            actions={quickActionsForRecommendation(triage.report.recommendation, triage.report.category)}
          />
          {triage.similarReports.length > 0 && (
            <div className="admin-support-triage__similar">
              <strong>Similar recent reports</strong>
              {triage.similarReports.map((similar) => (
                <span key={similar.id}>
                  {similar.subject} - {pretty(similar.status)}
                </span>
              ))}
            </div>
          )}
          <p className="muted">{triage.learningLoopPrompt}</p>
        </div>
      )}
      <div className="admin-support-report__controls">
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {pretty(option)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Admin notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Human decision, next action, or GitHub Actions reference"
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save triage"}
        </button>
      </div>
      <div className="admin-support-learning">
        <header>
          <div>
            <p className="admin-support-kicker">Learning loop</p>
            <h4>What should DTP remember from this issue?</h4>
          </div>
          <label>
            <span>Playbook outcome</span>
            <select
              value={playbookOutcome}
              onChange={(event) =>
                setPlaybookOutcome(event.target.value as SupportReport["playbookOutcome"])
              }
            >
              {PLAYBOOK_OUTCOMES.map((option) => (
                <option key={option} value={option}>
                  {pretty(option)}
                </option>
              ))}
            </select>
          </label>
        </header>
        <label>
          <span>Resolution summary</span>
          <textarea
            value={resolutionSummary}
            onChange={(event) => setResolutionSummary(event.target.value)}
            rows={3}
            placeholder="What actually fixed it? Include the final human decision, IDs, and run/log links."
          />
        </label>
        <label>
          <span>Playbook proposal</span>
          <textarea
            value={playbookProposal}
            onChange={(event) => setPlaybookProposal(event.target.value)}
            rows={3}
            placeholder="If this should update the playbook, describe the new diagnostic, prevention step, or new entry."
          />
        </label>
      </div>
    </article>
  );
}

function LearningQueueCard({ report, onChanged }: { report: SupportReport; onChanged: () => void }) {
  const toast = useAdminToast();
  const [saving, setSaving] = useState(false);

  async function markReviewed() {
    setSaving(true);
    try {
      const notes = [
        report.adminNotes,
        `Playbook learning reviewed on ${new Date().toISOString()}.`,
      ]
        .filter(Boolean)
        .join("\n");
      await adminApi.updateSupportReport(report.id, {
        adminNotes: notes,
        playbookOutcome: "confirmed",
      });
      toast.success("Learning item marked reviewed");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update learning item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="admin-support-learning-card">
      <header>
        <div>
          <p className="admin-support-kicker">{pretty(report.playbookOutcome)}</p>
          <h3>{report.subject}</h3>
        </div>
        <span className={`admin-support-pill admin-support-pill--${report.severity}`}>
          {pretty(report.severity)}
        </span>
      </header>
      {report.resolutionSummary && (
        <p>
          <strong>Resolution:</strong> {report.resolutionSummary}
        </p>
      )}
      {report.playbookProposal && (
        <p>
          <strong>Proposal:</strong> {report.playbookProposal}
        </p>
      )}
      <RecommendationQuickActions
        actions={quickActionsForRecommendation(report.recommendation, report.category)}
      />
      <button type="button" className="btn btn-secondary" onClick={markReviewed} disabled={saving}>
        {saving ? "Saving..." : "Mark playbook reviewed"}
      </button>
    </article>
  );
}

export function AdminOpsSupportPage() {
  usePageTitle("Admin - Ops support");
  const toast = useAdminToast();
  const [diagnostics, setDiagnostics] = useState<SupportDiagnostics | null>(null);
  const [reviewQueue, setReviewQueue] = useState<SupportReviewQueue | null>(null);
  const [reports, setReports] = useState<SupportReport[]>([]);
  const [status, setStatus] = useState("open");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [nextDiagnostics, nextReports] = await Promise.all([
        adminApi.supportDiagnostics(),
        adminApi.supportReports({
          status: status || undefined,
          category: category || undefined,
          q: q || undefined,
          limit: 80,
        }),
      ]);
      const nextReviewQueue = await adminApi.supportReviewQueue();
      setDiagnostics(nextDiagnostics);
      setReviewQueue(nextReviewQueue);
      setReports(nextReports);
      setLastLoadedAt(new Date().toISOString());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load support console");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, category]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, status, category, q]);

  const criticalSignals = useMemo(
    () => diagnostics?.signals.filter((signal) => signal.status === "critical") ?? [],
    [diagnostics]
  );

  return (
    <section className="admin-page admin-support-page">
      <header className="admin-page-header">
        <div>
          <p className="admin-support-kicker">DTP AI Operations Layer</p>
          <h1>Support diagnostics</h1>
          <p className="muted">
            Recommendation-only console for issue intake, playbook triage, and recurring
            operational risks. No automatic fixes are executed.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          Refresh diagnostics
        </button>
      </header>

      <div className="admin-support-livebar">
        <span>
          Mode: <strong>Recommend only</strong>
        </span>
        <span>
          Last refresh:{" "}
          <strong>{lastLoadedAt ? new Date(lastLoadedAt).toLocaleTimeString() : "pending"}</strong>
        </span>
        <label>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          Auto-refresh every 30s
        </label>
      </div>

      {criticalSignals.length > 0 && (
        <div className="dtp-error-banner" role="alert">
          {criticalSignals.length} critical signal(s) need human review.
        </div>
      )}

      <section className="admin-support-grid">
        {diagnostics?.signals.map((signal) => (
          <article key={signal.key} className={`admin-support-signal is-${signal.status}`}>
            <span>{signal.label}</span>
            <strong>{signal.value}</strong>
            <p>{signal.recommendation}</p>
          </article>
        ))}
      </section>

      <DeploymentIncidentIntake onCreated={() => void load()} />

      <section className="admin-sb-panel admin-support-panel">
        <header className="admin-support-section-head">
          <div>
            <h2>Playbook review workflow</h2>
            <p className="muted">
              Repeated issues, routing rules, and resolved reports that should improve support docs.
            </p>
          </div>
        </header>
        <div className="admin-support-review-grid">
          <div className="admin-support-review-column">
            <h3>Learning queue</h3>
            {reviewQueue?.learningQueue.length ? (
              reviewQueue.learningQueue.map((report) => (
                <LearningQueueCard
                  key={report.id}
                  report={report}
                  onChanged={() => void load()}
                />
              ))
            ) : (
              <p className="muted">No playbook updates are waiting for review.</p>
            )}
          </div>
          <div className="admin-support-review-column">
            <h3>Repeated patterns</h3>
            {reviewQueue?.repeatedPatterns.length ? (
              reviewQueue.repeatedPatterns.map((pattern) => (
                <article
                  key={`${pattern.category}-${pattern.recommendationKey ?? "unmatched"}`}
                  className="admin-support-pattern-card"
                >
                  <p className="admin-support-kicker">{pretty(pattern.category)}</p>
                  <h4>{pattern.recommendation?.title ?? "Unmatched pattern"}</h4>
                  <div>
                    <span>{pattern.total} total</span>
                    <span>{pattern.openCount} open</span>
                    <span>{pattern.criticalCount} critical</span>
                  </div>
                  <p>{pattern.suggestedReview}</p>
                  <RecommendationQuickActions
                    actions={quickActionsForRecommendation(pattern.recommendation, pattern.category)}
                  />
                </article>
              ))
            ) : (
              <p className="muted">No repeated issue patterns found in the last 90 days.</p>
            )}
          </div>
          <div className="admin-support-review-column">
            <h3>Routing rules</h3>
            {reviewQueue?.routingRules.map((rule) => (
              <article key={rule.category} className="admin-support-route-card">
                <p className="admin-support-kicker">{pretty(rule.category)}</p>
                <h4>{rule.owner}</h4>
                <p>{rule.escalation}</p>
                <small>{rule.humanApprovalRequiredFor.join(", ")}</small>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="admin-sb-panel admin-support-panel">
        <header className="admin-support-section-head">
          <div>
            <h2>Issue reports</h2>
            <p className="muted">Submitted from the in-app report button.</p>
          </div>
          <div className="admin-support-filters">
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((option) => (
                <option key={option} value={option}>
                  {pretty(option)}
                </option>
              ))}
            </select>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {pretty(option)}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load();
              }}
              placeholder="Search reports"
            />
            <button type="button" onClick={() => void load()}>
              Search
            </button>
          </div>
        </header>
        {loading ? (
          <p className="muted">Loading support console...</p>
        ) : reports.length === 0 ? (
          <p className="muted">No reports match this filter.</p>
        ) : (
          <div className="admin-support-report-list">
            {reports.map((report) => (
              <SupportReportCard key={report.id} report={report} onChanged={() => void load()} />
            ))}
          </div>
        )}
      </section>

      <section className="admin-sb-panel admin-support-panel">
        <header className="admin-support-section-head">
          <div>
            <h2>Support playbook</h2>
            <p className="muted">Top recurring DTP support paths ready for human approval.</p>
          </div>
        </header>
        <div className="admin-support-playbook-grid">
          {diagnostics?.playbook.map((entry) => (
            <article key={entry.key} className="admin-support-playbook-card">
              <p className="admin-support-kicker">{pretty(entry.category)}</p>
              <h3>{entry.title}</h3>
              <p>{entry.recommendation}</p>
              <div>
                <span>{pretty(entry.tier)}</span>
                <span>{pretty(entry.severity)}</span>
              </div>
              <code>{entry.playbookPath}</code>
              <RecommendationQuickActions actions={quickActionsForRecommendation(entry)} />
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
