# Production Seed Failure

Tier: Tier 2 - AI-assisted human resolution

## Symptoms

- Production seed completes with errors.
- Seed asset file is missing.
- Incremental load fails after deploy.

## Diagnose

- Review GitHub Actions logs.
- Confirm seed files are copied into the API dist path.
- Confirm seed mode is `incremental` when loading production-safe updates.

## Recommendation

Fix packaged seed assets or seed path assumptions before rerunning. Do not rerun full seed on production without approval.

