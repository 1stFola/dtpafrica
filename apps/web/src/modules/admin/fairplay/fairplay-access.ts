/**
 * Which FairPlay slugs open which screen. The API checks every request itself
 * (services/api/src/fairplay/access.ts); this only decides what to offer.
 */
export const FAIRPLAY_ANY = [
  "fairplay.session.manage",
  "fairplay.edge.admin",
  "fairplay.incident.operate",
  "fairplay.incident.review",
  "fairplay.evidence.view_original",
  "fairplay.evidence.export",
  "fairplay.report.view",
];

export const FAIRPLAY_STAFF = FAIRPLAY_ANY.filter((p) => p !== "fairplay.report.view");

export const FAIRPLAY_EVIDENCE_READERS = ["fairplay.incident.review", "fairplay.evidence.export", "fairplay.session.manage", "fairplay.report.view"];

export const PERMISSION_LABELS: Record<string, string> = {
  "fairplay.incident.operate": "Flag incidents",
  "fairplay.incident.review": "Record findings",
  "fairplay.session.manage": "Run the session",
  "fairplay.edge.admin": "Edge admin",
  "fairplay.evidence.view_original": "Watch originals",
  "fairplay.evidence.export": "Approve and export",
};

export const RESULT_LABELS: Record<string, string> = {
  supports_original: "Supports the on-field decision",
  supports_alternative: "Supports a different outcome",
  inconclusive: "Inconclusive",
  footage_unavailable: "No footage available",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function matchTitle(m: { home?: string; away?: string } | null | undefined): string {
  return m?.home && m?.away ? `${m.home} v ${m.away}` : "Match";
}
