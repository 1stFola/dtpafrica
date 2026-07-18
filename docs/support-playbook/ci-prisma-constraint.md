# CI Prisma Constraint Failure

Tier: Tier 3 - Human escalation

## Symptoms

- GitHub Actions fails during `prisma db push`.
- Error includes `P2002` or unique constraint conflict.
- API health check times out after failed database setup.

## Diagnose

- Identify the failing unique constraint.
- Count duplicate rows before adding/enforcing the constraint.
- Prepare a reversible cleanup plan.

## Recommendation

Escalate to a human engineer. Do not let the support agent mutate production data automatically.

