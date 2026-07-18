# ScoreBoard Supervisor Offline

Tier: Tier 2 - AI-assisted human resolution

## Symptoms

- `/admin/scoreboard/match-center` shows `Supervisor offline`.
- Match-control dropdown is empty.
- Operators see `No matches to control`.

## Diagnose

- Confirm scheduled or live fixtures exist.
- Confirm the user has ScoreBoard Ops permissions.
- Check API health and GitHub Actions deployment logs.
- Review whether match statuses are `scheduled`, `live`, or accidentally archived/final.

## Recommendation

Do not create dummy live matches. Fix fixture status or deployment health, then reload Match Center.

