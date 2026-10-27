# ADR-0010 — FairPlay gets its own admin area, linked from the ScoreBoard match center

**Status**: proposed (Phase 0) · **Decides**: where "ScoreBoard → Match → FairPlay" lives in the web app

## Context

The PID asks for a "ScoreBoard > Fixture > FairPlay tab". The web app has no per-match admin
page with tabs except the recorder console (`admin/match-stats/:matchId/*`, mounted outside
the site shell so a recorder has the whole viewport). The ScoreBoard admin area
(`/admin/scoreboard/*`) needs `scoreboard.read`. Vision is a separate area at
`/admin/vision/*` behind its own `vision.read` permission, a precedent for a product with
its own roles.

## Decision

- A new `/admin/fairplay/*` area, mounted in `AdminApp.tsx` behind `AdminRequirePermission`
  with the FairPlay slugs, with its own sidebar entry and `ADMIN_NAV_PERMISSIONS` row.
- The per-match page is `/admin/fairplay/matches/:matchId`.
- The ScoreBoard match center shows a "FairPlay" link on a match for users who hold a
  FairPlay permission. That link is the "ScoreBoard → Match → FairPlay" path.
- Nothing FairPlay-related appears in the recorder console.

## Consequences

The recorder never sees review findings during a match, which keeps shadow review out of
the official record. Organiser viewers need no ScoreBoard admin permission. The cost is
one click more than a tab, and a second place to look for match information.

## Alternatives rejected

- **A tab in the recorder console**: exposes findings to the official record-keeper; also
  mixes a reviewer tool into a recorder's pitch-side screen.
- **A route under `/admin/scoreboard`**: forces `scoreboard.read` onto organiser viewers.
