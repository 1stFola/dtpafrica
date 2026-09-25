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
