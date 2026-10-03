# 47 — The Vision environment

> Mouse-driven review does not scale to 90 minutes of footage.
> — [08-FRONTEND](./08-FRONTEND.md), § Keyboard map

ScoreBoard has its own environment in the admin app: a shell, a section per
thing it does, a count of each, and a button for every action. Vision had
three pages, two of which nothing linked to, and an API with sixty routes of
which a dozen had a button. A partner could not be registered from the
browser; evidence could not be attached; no job could be retried; no dataset
or model existed to a person who did not know curl. [45](./45-REACHABLE.md)
gave the source page links and a queue control. This is the rest: Vision as an
environment, the way ScoreBoard is one.

---

## The shell

`/admin/vision` mounts the Vision app under its own layout: breadcrumbs, a
tagline, the counts that say how much there is (sources, footage ready, jobs
queued and running, workers alive, and whether the module is on), and a
sidebar of sections. The layout, the sidebar and the badges reuse ScoreBoard's
classes, so the two environments read as one admin. The workstation screens —
annotation task, identity review, calibration editor — still mount outside the
shell, because a frame-accurate video tool needs the whole viewport; every one
of them opens from a button inside it.

| Section | What is there, and every action it carries |
|---|---|
| **Overview** | Counts as tiles, each a link; where things are done; the configuration panels the old status page was. |
| **Sources & rights** | Register a partner, attach its rights evidence (the document through the API, since a browser cannot PUT to the master bucket), add a signatory, register a source linked to its match; then the list with its filters, and each source's page with grants, acquisition, the upload link and its assets with the queue control. |
| **Footage** | Every copy under DTP control across sources: source, match, state, media, every stage's latest run as dots, the counts of tracks, segments and events, the next stage's queue button, and the three screens that open on it. |
| **Pipeline** | The dispatcher's health with a tick; every worker with retire, and provisioning with the one-time token shown once; every job filtered by state and stage, with retry, cancel and its event log inline. |
| **Annotation** | The queue as before, reachable now. |
| **Datasets** | Create a version; add footage by asset id; split, freeze, export; the leakage and representation reports as the API returns them. |
| **Models** | Register a model and its versions (licence note required, as the register demands); benchmark against a frozen dataset; request promotion; a different person approves, rejects with a reason, rolls back; benchmarks and promotions listed. |
| **Events** | Candidates per asset; propose one by source time; accept, reject with a reason, promote, promote creating; the inspector with the video under it is the next increment. |

Every button is gated by the permission its route checks, so a reviewer sees
no register forms and an ML engineer no decision buttons; the API refuses
regardless, the gate only saves the round trip. Every action reports in
words, the API's own refusal when it refuses, and reloads.

## Four small routes

`GET /vision/overview` for the counts; `GET /vision/assets` for the footage
list with each asset's proxy and latest stage runs; `GET /vision/workers` for
the pipeline page; and `POST /vision/partners/:id/evidence/file`, the rights
document as multipart through the API into the write-once master bucket. The
presigned route stays for a client that can PUT directly.

## Verification

```
web tests                177 passed
api tests              1,299 passed   (was 1,298)
typecheck               api and web clean
```

The environment was driven in the browser as a signed-in Vision Admin on the
dev database: every section renders under the shell with the counts; a
dataset version, a model and a partner were registered from their forms and
appeared in their lists with the notice naming the next step; an event
candidate was proposed from the Events page and listed as the proposer's,
awaiting a second person, as evidence rather than promotable. The console
errors seen were the public home endpoints and the ScoreBoard idle-lock poll,
both outside Vision and pre-existing. Everything registered was removed.

## What is not done

| | |
|---|---|
| **The event inspector** | Candidates are proposed by typing a source millisecond. The timeline under the video, with the actor track and roster slot from the identity screen's context, is Phase 6 Increment 2. |
| **Annotation schemas** | Published through the API still; the queue page claims against the published one. |
| **Reports as prose** | The leakage and representation reports, benchmarks and promotions are shown as the API's JSON. They are the gate's evidence; a chart is a later nicety. |
| **A browser upload** | The CLI remains the path for footage; a browser upload needs the master bucket's CORS rule for PUT and a page that resumes. |
