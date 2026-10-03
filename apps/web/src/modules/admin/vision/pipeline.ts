/**
 * The pipeline as the operator sees it on a source's asset: which stage comes
 * next, which can be queued now, and what the latest run of each did.
 *
 * A mirror of the contract's stage order (`JOB_TYPE_PREREQUISITES` in
 * `@dtp/vision-contracts`), kept small on purpose: the API refuses a stage whose
 * prerequisites have not succeeded, and this only has to agree with it well
 * enough to grey out the button before the round trip.
 */

export type JobState = "queued" | "claimed" | "running" | "succeeded" | "failed" | "cancelled" | string;

export type JobRow = { id: string; type: string; state: JobState; queuedAt: string; finishedAt: string | null; error: string | null; attemptNumber?: number };

export type Stage = { type: string; label: string; needs: readonly string[]; where: "cpu" | "gpu"; note: string };

/** Stage order, with what each needs to have succeeded first. */
export const STAGES: readonly Stage[] = [
  { type: "probe", label: "Probe", needs: [], where: "cpu", note: "FFprobe metadata: codec, size, frame rate, duration." },
  { type: "fingerprint", label: "Fingerprint", needs: ["probe"], where: "cpu", note: "Perceptual hash, for duplicates." },
  { type: "transcode", label: "Transcode", needs: ["probe"], where: "cpu", note: "The review proxy the workstation plays." },
  { type: "cuts", label: "Camera cuts", needs: ["transcode"], where: "cpu", note: "Proposes camera segments from the scene score." },
  { type: "detect", label: "Detect", needs: ["transcode"], where: "gpu", note: "Players, goalkeepers, referees and the ball, frame by frame." },
  { type: "track", label: "Track", needs: ["detect"], where: "cpu", note: "Links detections into tracks." },
  { type: "identify", label: "Identify", needs: ["track"], where: "cpu", note: "Which side each track's kit is." },
  { type: "gamestate", label: "Game state", needs: ["track"], where: "cpu", note: "Every track in metres per frame; needs a calibrated segment." },
];

const ORDER = new Map(STAGES.map((s, i) => [s.type, i]));

/** The latest job of each type, by queue time. */
export function latestByType(jobs: readonly JobRow[]): Map<string, JobRow> {
  const out = new Map<string, JobRow>();
  for (const job of [...jobs].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))) out.set(job.type, job);
  return out;
}

export function succeededTypes(jobs: readonly JobRow[]): Set<string> {
  return new Set(jobs.filter((j) => j.state === "succeeded").map((j) => j.type));
}

/** Whether a stage can be queued: every prerequisite has a succeeded run. */
export function canQueue(stage: Stage, done: ReadonlySet<string>): boolean {
  return stage.needs.every((n) => done.has(n));
}

/** What is missing before a stage can run, in order, or null when nothing is. */
export function missingFor(stage: Stage, done: ReadonlySet<string>): string[] | null {
  const missing = stage.needs.filter((n) => !done.has(n)).sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
  return missing.length ? missing : null;
}

/** The first stage in order that can be queued and has not succeeded: the obvious next click. */
export function nextStage(jobs: readonly JobRow[]): Stage | null {
  const done = succeededTypes(jobs);
  const latest = latestByType(jobs);
  for (const stage of STAGES) {
    if (done.has(stage.type)) continue;
    const current = latest.get(stage.type);
    if (current && ["queued", "claimed", "running"].includes(current.state)) continue;
    if (canQueue(stage, done)) return stage;
  }
  return null;
}

/** `succeeded 2m ago`, `running`, `failed: <error>`, or `not run`. */
export function describeRun(job: JobRow | undefined, now = Date.now()): string {
  if (!job) return "not run";
  if (job.state === "failed") return `failed${job.error ? `: ${job.error}` : ""}`;
  if (job.state === "succeeded" && job.finishedAt) return `succeeded ${ago(job.finishedAt, now)}`;
  return job.state;
}

function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
