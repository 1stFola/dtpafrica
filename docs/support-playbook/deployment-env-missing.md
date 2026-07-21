# Deployment Missing Environment Variable

## Symptoms

- Production logs mention a missing key, provider, secret, or environment variable.
- API boots without required third-party configuration.
- A feature works locally but fails in production after deploy.

## Recommendation-Only Triage

1. Identify the exact missing variable from the log.
2. Confirm whether it belongs in `services/api/.env`, GitHub Actions secrets, or server container env.
3. Confirm the value is available to the running service, not only committed to an example file.
4. Restart or redeploy only after a human confirms the secret is correct.

## Human Approval Required

- Secret creation/update.
- Production service restart.
- Deployment rerun.
