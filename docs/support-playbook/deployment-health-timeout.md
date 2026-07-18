# Deployment Health Check Timeout

## Symptoms

- GitHub Actions deployment reaches a health-check timeout.
- API container never reports healthy.
- Later Ansible steps fail because the API did not start.

## Recommendation-Only Triage

1. Treat the timeout as a symptom, not the root cause.
2. Find the earliest failing API/container/db setup log line before the timeout.
3. Check whether `prisma db push`, seed, environment variables, or container boot failed first.
4. Retry only when the first failure was transient or has been fixed.

## Human Approval Required

- Deployment rerun.
- Service restart.
- Rollback.
- Database repair.
