# Duplicate Player Profile

Tier: Tier 2 - AI-assisted human resolution

## Symptoms

- A public profile URL ends in `-1`.
- ScoreBoard history appears on a duplicate profile.
- Existing master player profile has no ScoreBoard history.

## Diagnose

- Search `/admin/scoreboard/entities` Players and Name QA tabs.
- Search the full `/admin/players` profile list.
- Compare display name, slug, team, and position.

## Recommendation

Use the ScoreBoard merge action to move events/history into the canonical master profile. Keep automatic execution disabled.

