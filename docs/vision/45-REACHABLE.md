# 45 — Reachable: links, a queue control, and the box turned on

> A phase is not complete because code exists — its gate must demonstrably pass.
> — [11-PHASE-PLAN](./11-PHASE-PLAN.md)

Every gate through Phase 6 Increment 1 passed against a real API and a real
database. None of it could be reached by clicking. The workstation screens were
mounted at URLs nothing linked to; the source page listed assets without their
ids; no screen could queue a job; footage could only arrive through a presigned
upload no page or script performed; and the staging box had never been told
Vision exists. This increment is the plumbing between the engine and a person.

---

## On the source page

Each copy under DTP control is now a card: its ingest state, codec and
duration, its id (selectable, for the API), two links — *Identity review* and
*Calibration editor*, dimmed with a note until the proxy exists — the latest
run of every stage in order with its state, and one control: a stage picker
and a *Queue* button. The picker starts on the next stage in order; the button
is disabled while a prerequisite has not succeeded, with the note saying which
(`needs transcode to succeed first`). The stage order is a mirror of the
contract's `JOB_TYPE_PREREQUISITES`, and the API refuses out of order anyway;
the mirror only saves the round trip. The source view carries each asset's
proxy variant, so a seeded asset with a proxy but no transcode job is not
dimmed.

## Two scripts

`vision:upload` sends a video from any machine through the API's resumable
session: open, sign parts, PUT each 8 MiB part straight to the store with
retries, complete. The bytes never pass through the API, as [19](./19-PHASE-1-INCREMENT-4.md)
built it. It prints the session id to resume with, then the asset id and the
jobs queued (probe and fingerprint, automatically), and the curl for transcode.

`seed:rbac` upserts the permission and role catalogue and nothing else, so the
live box can gain the vision roles without the demo competitions the full seed
carries. The super admin role already holds every permission; what it lacked
on the box was the roles to assign.

## The box

The staging deploy had no `VISION_*` environment at all, which is the designed
default ([15](./15-PHASE-0-IMPLEMENTED.md)): the module off, storage in memory,
the mock provider. Ten keys now travel from the `dtp/staging/app` secret
through the workflow, the playbook and the compose file into the API container,
each empty until the secret holds it, so a deploy without them changes nothing.
The runbook's new section, *Turning Vision on*, lists the keys, the migrations,
the role seed, the bucket's CORS rule, and how footage and a worker reach the box.

## Verification

```
web tests                177 passed   (was 172)
  pipeline                 5
typecheck               api and web clean
upload CLI              a 6 MiB synthetic file into the dev API and R2: one part,
                        session completed, asset created, probe and fingerprint
                        queued; asset and master object removed after
seed:rbac               against the dev database: 43 permissions, 12 roles, none created, no user touched
```

The source page was driven in the browser as a signed-in ML engineer on the
demo source: three assets, each with its id and links; the two without a proxy
dimmed with the note; *Queue probe* queued a probe on the demo asset and the
card read `queued`; picking *Detect* on another disabled the button with
`needs transcode to succeed first`. The scratch user, the uploaded asset and the
queued job were removed.

## What is not done

| | |
|---|---|
| **A worker on the box** | The compose stack has no worker and the CD builds no worker image. Until one runs, a queued job stays queued. With the `local` provider the CPU worker is started by hand with a bootstrap token ([17](./17-PHASE-1-INCREMENT-2.md)); a compose service for it is the next infra step. |
| **Detect** | Needs a GPU. Probe, fingerprint, transcode and cuts run on a CPU worker; tracks and everything after wait on a pod run. |
| **A browser upload** | The CLI is the path. A browser upload needs the bucket's CORS rule to allow `PUT` as well, and a page that survives a Nigerian connection; the CLI resumes, a page would have to. |
| **The events screen** | Candidates are still filed through the API. |
