export type SupportPlaybookEntry = {
  key: string;
  title: string;
  category: string;
  tier: "tier_1_known" | "tier_2_assisted" | "tier_3_human";
  severity: "low" | "medium" | "high" | "critical";
  symptoms: string[];
  diagnostics: string[];
  recommendation: string;
  playbookPath: string;
};

export const SUPPORT_PLAYBOOK: SupportPlaybookEntry[] = [
  {
    key: "scoreboard-supervisor-offline",
    title: "ScoreBoard match center or supervisor offline",
    category: "scoreboard_ops",
    tier: "tier_2_assisted",
    severity: "high",
    symptoms: ["Supervisor offline", "No matches to control", "active fixtures missing"],
    diagnostics: ["Check live match count", "Check recent match statuses", "Confirm admin permissions"],
    recommendation:
      "Verify scheduled/live fixtures and ScoreBoard Ops permissions, then inspect GitHub Actions/deploy logs if API health is stale.",
    playbookPath: "docs/support-playbook/scoreboard-supervisor-offline.md",
  },
  {
    key: "timeline-csv-upload-errors",
    title: "Timeline CSV upload errors or missing event types",
    category: "scoreboard_ops",
    tier: "tier_1_known",
    severity: "medium",
    symptoms: ["CSV rejected", "event missing", "player labels not linked"],
    diagnostics: ["Validate headers", "Check event type list", "Review playerLabel/playerLabel2"],
    recommendation:
      "Compare the CSV with the match-center template, confirm event type spelling, and use Name QA for incomplete player names.",
    playbookPath: "docs/support-playbook/timeline-csv-upload-errors.md",
  },
  {
    key: "standings-not-updating",
    title: "League table or match stats not updating",
    category: "scoreboard_ops",
    tier: "tier_2_assisted",
    severity: "high",
    symptoms: ["table stale", "final score missing", "match report not reflected"],
    diagnostics: ["Check match status", "Check full_time event", "Compare stored scores"],
    recommendation:
      "Confirm match status is final and score fields are saved, then re-run the approved standings recalculation path manually.",
    playbookPath: "docs/support-playbook/standings-not-updating.md",
  },
  {
    key: "duplicate-player-profile",
    title: "Duplicate player profile or -1 slug created",
    category: "player_data",
    tier: "tier_2_assisted",
    severity: "medium",
    symptoms: ["player-name-1 URL", "ScoreBoard history on duplicate", "existing profile has no events"],
    diagnostics: ["Search master players", "Review Name QA", "Compare normalized names"],
    recommendation:
      "Use ScoreBoard Entities merge to move events/history into the canonical master player profile.",
    playbookPath: "docs/support-playbook/duplicate-player-profile.md",
  },
  {
    key: "scoreboard-history-not-linking",
    title: "ScoreBoard history not linking to player profile",
    category: "player_data",
    tier: "tier_2_assisted",
    severity: "medium",
    symptoms: ["event appears in match only", "profile history empty", "single-name player not clickable"],
    diagnostics: ["Check playerLabel and playerLabel2", "Review complete first/last name", "Use Name QA"],
    recommendation:
      "Complete ambiguous names, merge duplicates where needed, and keep single-name labels unlinked until verified.",
    playbookPath: "docs/support-playbook/scoreboard-history-not-linking.md",
  },
  {
    key: "calibration-save-display",
    title: "Calibration data saves but profile display is wrong",
    category: "calibration",
    tier: "tier_1_known",
    severity: "medium",
    symptoms: ["height missing", "weight not stored", "benchmark did not change"],
    diagnostics: ["Check input format", "Preview calibration context", "Confirm save response"],
    recommendation:
      "Use supported height formats such as 5'11\" or 180cm, then re-save calibration and reload the public profile.",
    playbookPath: "docs/support-playbook/calibration-save-display.md",
  },
  {
    key: "highlight-approval-flow",
    title: "Highlight upload queued but cannot be approved",
    category: "media_highlights",
    tier: "tier_1_known",
    severity: "medium",
    symptoms: ["queued unpublished", "supervisor missing approval", "video card not visible"],
    diagnostics: ["Check highlight status", "Check media URL normalization", "Review supervisor permissions"],
    recommendation:
      "Open ScoreBoard supervisor/highlights review, confirm media type, then approve/publish using the admin review control.",
    playbookPath: "docs/support-playbook/highlight-approval-flow.md",
  },
  {
    key: "production-seed-failure",
    title: "Production seed or incremental data load failed",
    category: "deployment",
    tier: "tier_2_assisted",
    severity: "high",
    symptoms: ["seed completed with errors", "ENOENT", "missing seed file"],
    diagnostics: ["Check GitHub Actions logs", "Check dist asset paths", "Confirm seed mode"],
    recommendation:
      "Review GitHub Actions deploy logs and verify seed assets are copied into the API dist path before rerunning incremental seed.",
    playbookPath: "docs/support-playbook/production-seed-failure.md",
  },
  {
    key: "ci-prisma-constraint",
    title: "CI/CD failed during Prisma db push",
    category: "deployment",
    tier: "tier_3_human",
    severity: "critical",
    symptoms: ["P2002", "unique constraint", "health check timeout"],
    diagnostics: ["Inspect GitHub Actions logs", "Identify duplicated column", "Plan data repair before constraint"],
    recommendation:
      "Do not auto-fix production constraints. Escalate with the failing constraint, duplicate count, and proposed cleanup script.",
    playbookPath: "docs/support-playbook/ci-prisma-constraint.md",
  },
  {
    key: "deployment-health-timeout",
    title: "Deployment health check timed out",
    category: "deployment",
    tier: "tier_2_assisted",
    severity: "high",
    symptoms: ["health check", "timed out", "timeout after", "api could not start"],
    diagnostics: ["Check container logs", "Check API boot logs", "Inspect preceding db push/seed failure"],
    recommendation:
      "Treat the health timeout as a symptom. Inspect the first failing setup/boot step before rerunning deployment.",
    playbookPath: "docs/support-playbook/deployment-health-timeout.md",
  },
  {
    key: "deployment-env-missing",
    title: "Deployment failed because an environment variable is missing",
    category: "deployment",
    tier: "tier_2_assisted",
    severity: "high",
    symptoms: ["environment variable", "env var", "missing", "not configured", "no ocr provider"],
    diagnostics: ["Identify missing variable", "Check service env file/secret", "Confirm service restart after update"],
    recommendation:
      "Verify the required production secret exists for the correct service before restarting or redeploying.",
    playbookPath: "docs/support-playbook/deployment-env-missing.md",
  },
];

export function recommendPlaybookEntry(input: {
  category?: string | null;
  subject?: string | null;
  description?: string | null;
}): SupportPlaybookEntry {
  const haystack = `${input.subject ?? ""} ${input.description ?? ""}`.toLowerCase();
  const byKeyword = SUPPORT_PLAYBOOK.find((entry) =>
    entry.symptoms.some((symptom) => haystack.includes(symptom.toLowerCase()))
  );
  if (byKeyword) return byKeyword;
  return (
    SUPPORT_PLAYBOOK.find((entry) => entry.category === input.category) ??
    SUPPORT_PLAYBOOK[0]
  );
}
