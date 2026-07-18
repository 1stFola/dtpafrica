# DTP Africa Support Playbook

This playbook backs the first version of the DTP AI Operations Layer.

The support agent is **recommend-only**. It may diagnose, collect context, and suggest a playbook path, but it must not execute production changes, database edits, account merges, service restarts, or deployment actions without a human admin.

## Support Tiers

- **Tier 1 - Known issue recommendation:** The issue matches a documented pattern. The console recommends checks and a human-safe next action.
- **Tier 2 - AI-assisted human resolution:** The issue needs context gathering, log review, or a data decision. The agent prepares a recommendation for a human.
- **Tier 3 - Human escalation:** Security, production data repair, destructive database changes, or deployment failures go directly to a responsible human.

## First 10 DTP Playbook Areas

1. [ScoreBoard supervisor offline](./scoreboard-supervisor-offline.md)
2. [Timeline CSV upload errors](./timeline-csv-upload-errors.md)
3. [Standings not updating](./standings-not-updating.md)
4. [Duplicate player profile](./duplicate-player-profile.md)
5. [ScoreBoard history not linking](./scoreboard-history-not-linking.md)
6. [Tracker OCR extraction](./tracker-ocr-extraction.md)
7. [Calibration save/display](./calibration-save-display.md)
8. [Highlight approval flow](./highlight-approval-flow.md)
9. [Production seed failure](./production-seed-failure.md)
10. [CI Prisma constraint failure](./ci-prisma-constraint.md)
11. [Deployment health check timeout](./deployment-health-timeout.md)
12. [Deployment missing environment variable](./deployment-env-missing.md)

## Learning Loop

Every resolved support report should leave behind one of three outcomes:

- Existing playbook confirmed.
- Existing playbook updated with a sharper diagnostic or prevention step.
- New playbook entry proposed.

The goal is to turn repeat Tier 2 issues into Tier 1 recommendations over time.

## Phase 3 - AI-Assisted Triage Packet

The Ops Support console can generate a triage packet for any submitted report.

The packet is still **recommend-only** and includes:

- likely cause,
- supporting diagnostics/evidence,
- playbook checklist,
- recommended human-approved actions,
- similar recent reports,
- escalation flag,
- learning-loop prompt.

Production-changing actions remain human controlled. The packet should help an admin decide what to do, not perform the fix automatically.

## Phase 4 - Resolution Learning Capture

When a report is resolved or closed, the admin should record:

- the actual resolution summary,
- whether the existing playbook was confirmed,
- whether the playbook should be updated,
- or whether a new playbook entry is needed.

Use `Playbook outcome` as the source of truth:

- `not_reviewed` - no learning decision has been made yet.
- `confirmed` - the existing playbook solved the issue.
- `updated` - the existing playbook needs sharper diagnostics or prevention notes.
- `new_entry_needed` - this issue should become a new support playbook page.

The diagnostics console surfaces reports marked `updated` or `new_entry_needed` as the playbook learning queue. A human should then update the files in `docs/support-playbook/`.

## Phase 5 - Review Workflow

The Ops Support console now includes a review workflow:

- **Learning queue:** resolved reports marked `updated` or `new_entry_needed`.
- **Repeated patterns:** report groups that occurred at least twice in the last 90 days.
- **Routing rules:** recommended human owner and approval boundaries by support category.

Use this workflow weekly, and after any high-severity incident, to decide whether a support issue should:

- remain as a one-off report,
- confirm an existing playbook,
- update an existing playbook,
- become a new playbook entry,
- or be escalated to the right human owner.

The review workflow does not edit production data or rewrite playbook files automatically. It helps admins decide what should be documented next.

## Phase 6 - Deployment Log Intake

The Ops Support console accepts structured GitHub Actions/deployment failure details:

- GitHub Actions run URL,
- branch,
- commit SHA,
- failing step,
- production host,
- log excerpt,
- admin notes.

The intake parser flags known DTP deployment signatures such as Prisma `P2002`, missing seed assets, health-check timeouts, missing environment variables, database setup failures, and container boot failures.

The result is still recommendation-only. It creates a deployment support report with suspected root cause, safe-to-retry guidance, matched signals, and recommended human-approved actions.
