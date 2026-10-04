/**
 * Rights contracts.
 *
 * Four scopes, granted and revoked independently. See
 * docs/vision/03-RIGHTS-AND-GOVERNANCE.md.
 */

export const RIGHTS_SCOPE_KEYS = [
  "canAnalyze",
  "canTrain",
  "canPublishHighlight",
  "canShareWithScout",
] as const;

export type RightsScopeKey = (typeof RIGHTS_SCOPE_KEYS)[number];

/**
 * Where a grant attached. Resolution is "most specific wins, deny beats allow",
 * which is what makes a guardian's player-level withdrawal override a
 * partner-wide grant.
 */
export const RIGHTS_GRANT_LEVELS = ["partner", "source", "player"] as const;
export type RightsGrantLevel = (typeof RIGHTS_GRANT_LEVELS)[number];

/** Specificity order, lowest first. Used by the policy resolver. */
export const RIGHTS_GRANT_LEVEL_SPECIFICITY: Record<RightsGrantLevel, number> = {
  partner: 0,
  source: 1,
  player: 2,
};

export const RIGHTS_DENIAL_REASONS = [
  /** Nothing grants this scope at any level. */
  "no_scope",
  /** A grant exists but its window has closed. */
  "expired",
  /** A grant existed and was withdrawn. */
  "revoked",
  /** Catalogued only — no authorized DTP copy exists yet. */
  "pending_acquisition",
  /** A structured restriction on the grant forbids this specific use. */
  "restriction_violated",
  /** Subject is a minor and no consent covers this scope. */
  "minor_consent_missing",
  /** Asset belongs to a research-only corpus and can never be trained on. */
  "research_corpus",
] as const;

export type RightsDenialReason = (typeof RIGHTS_DENIAL_REASONS)[number];

export type RightsAllowed = {
  allowed: true;
  scopeId: string;
  grantLevel: RightsGrantLevel;
  /** ISO 8601, or null for no expiry. */
  expiresAt: string | null;
};

export type RightsDenied = {
  allowed: false;
  reason: RightsDenialReason;
  /** What happened, for the audit log. */
  detail: string;
  /** What the operator should do about it, for the UI. */
  remediation: string;
};

/**
 * Never a bare boolean: a denial has to tell the operator what to fix and the
 * audit log why it was refused.
 */
export type RightsDecision = RightsAllowed | RightsDenied;

export function isAllowed(decision: RightsDecision): decision is RightsAllowed {
  return decision.allowed;
}

/** Standard remediation copy, so every denial reads the same way. */
export const RIGHTS_DENIAL_REMEDIATION: Record<RightsDenialReason, string> = {
  no_scope:
    "Attach rights evidence for this partner and grant the required scope on the source record.",
  expired:
    "The grant has expired. Renew the agreement and extend the scope's expiry date.",
  revoked:
    "The grant was withdrawn. It cannot be reinstated without new rights evidence.",
  pending_acquisition:
    "This source is catalogued only. Authorize acquisition and upload an authorized copy first.",
  restriction_violated:
    "A restriction on the grant forbids this use. Review the restriction on the rights scope.",
  minor_consent_missing:
    "This player is a minor. Attach partner or guardian consent covering this scope.",
  research_corpus:
    "Research-only footage can never enter the commercial corpus. Use a DTP-owned source.",
};

// ── Restrictions on a grant ─────────────────────────────────────────────────

/**
 * The structured restrictions a rights scope may carry (`VisionRightsScope.restrictions`).
 *
 * `deny` lists the scopes this grant does not give. `note` is free text for a
 * person and restricts nothing. Any other key that says something is a flag
 * the policy does not understand, and what it does not understand it treats as
 * a denial of every scope (docs/vision/54).
 */
export type RightsRestrictions = { deny?: RightsScopeKey[]; note?: string } & Record<string, unknown>;

export const UNDERSTOOD_RESTRICTION_KEYS = ["deny", "note"] as const;

export type RestrictionsReading =
  | { ok: true; value: RightsRestrictions | null; /** Keys the policy does not understand: each denies every scope. */ unrecognised: string[] }
  | { ok: false; problem: string };

function saysSomething(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

/**
 * Read restrictions as a person submits them, before they are stored.
 *
 * Refused: anything that is not an object; a `deny` that is not a list of the
 * four scopes; a `note` that is not text. A `deny` entry that is not a scope is
 * the dangerous one -- `["canPublish"]` reads as a restriction and restricts
 * nothing -- so it is refused rather than stored. A key the policy does not
 * understand is accepted, because a person may mean exactly that, and is
 * reported so the caller can say what it will do.
 */
export function readRestrictions(input: unknown): RestrictionsReading {
  if (input === null || input === undefined) return { ok: true, value: null, unrecognised: [] };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, problem: "Restrictions are an object, for example { \"deny\": [\"canPublishHighlight\"] }." };
  const record = input as Record<string, unknown>;
  if (record.deny !== undefined) {
    if (!Array.isArray(record.deny)) return { ok: false, problem: "`deny` is a list of scopes." };
    const unknown = record.deny.filter((s) => !(RIGHTS_SCOPE_KEYS as readonly unknown[]).includes(s));
    if (unknown.length) {
      return { ok: false, problem: `\`deny\` names ${unknown.map((s) => JSON.stringify(s)).join(", ")}, which is not a scope. The scopes are ${RIGHTS_SCOPE_KEYS.join(", ")}.` };
    }
  }
  if (record.note !== undefined && typeof record.note !== "string") return { ok: false, problem: "`note` is text." };
  const unrecognised = Object.keys(record).filter((key) => !(UNDERSTOOD_RESTRICTION_KEYS as readonly string[]).includes(key) && saysSomething(record[key]));
  return { ok: true, value: record as RightsRestrictions, unrecognised };
}
