# 46 — A worker on the box

> A worker learns three things: a callback URL, a bootstrap token, and its
> resource classes. No storage credential, no database connection, no provider SDK.
> — [17-PHASE-1-INCREMENT-2](./17-PHASE-1-INCREMENT-2.md)

[45](./45-REACHABLE.md) made every screen reachable and footage uploadable,
and ended on the one thing still missing on the staging box: nothing ran a
job. The compose stack had Postgres, the API and the web app, and no worker;
the deploy built no worker image. A queued probe stayed queued. This is the
worker, beside the API, started by the stack and asking the API for its own
token.

---

## Self-provisioning

A hosted worker is launched by a provider that hands it a bootstrap token. A
worker in the compose stack has no provider: it starts when the stack starts.
`dtp_vision_worker/bootstrap.py` is the entry point for that case. With the
operator key and the `local` provider it calls `POST /vision/workers/provision`,
puts the one-time token in the environment, and hands over to the ordinary
worker main, unchanged. It keeps trying while the API is still coming up,
because the two start together, and gives up after ten minutes; a refusal the
API makes on purpose, a wrong key or an unknown provider, is not retried. When
the worker exits — the queue drained for the idle period — the row is retired,
so the dashboard does not count a worker that is gone, and the container's
restart policy brings a fresh one up. A worker handed `VISION_BOOTSTRAP_TOKEN`
directly, the hosted way, skips all of this.

The operator key is the one extra thing this worker holds, and it holds it for
provisioning and retiring alone. The stages run on the worker token as before;
the key never reaches a stage; the store is reached through presigned URLs as
before. The portability requirement of [17](./17-PHASE-1-INCREMENT-2.md) is
kept: the same image a hosted CPU pod would run.

## The stack

The deploy now builds and pushes a third image, `dtp-vision-worker`, from the
CPU Dockerfile — FFmpeg and the worker package, no CUDA. The compose file gains
a `worker` service under the `vision` profile, which the rendered env file
switches on exactly when `VISION_ENABLED` is `true`, so a stack with Vision off
has no worker polling an API that would refuse it. It claims `cpu_small`: probe,
fingerprint, transcode, cuts, track, identify and gamestate. Detect needs a GPU
and stays on a pod. It idles a day before recycling, where a pod idles two
minutes, because a container on a box one already pays for costs nothing to
leave running. Its work directory is a 2 GB tmpfs.

One worker, one job at a time, on a t3.small shared with Postgres and the API.
That is enough for a match's CPU stages in sequence, not for a queue of
matches, and a full match's transcode needs the file twice over in the work
directory and the box's memory. Short clips first.

## An upload is footage of its match

The end-to-end run on dev stopped at transcode: *not linked to a match yet*.
Every stage after probe and fingerprint refuses an asset with no match, which
is right — inference on footage nobody has attributed produces evidence that
cannot be attributed either — but an upload never set one, so no uploaded asset
could go past fingerprint. The source record already names the match. An
uploaded asset now inherits it, and stays unlinked only when the record is.

## Verification

```
worker tests             252 passed   (was 241)
  bootstrap               11
api tests              1,298 passed   (was 1,297)
typecheck               api clean
workflow, compose       parse; the worker service appears under the vision
                        profile and nowhere without it
end to end on dev       the CPU image built from the Dockerfile; a six-second
                        clip made with its FFmpeg, uploaded with vision:upload;
                        the worker provisioned itself through the dev API,
                        registered, claimed and completed probe and
                        fingerprint (codec, size, rate written), idled out,
                        retired its row; a fresh one claimed transcode: proxy
                        and four thumbnails in R2, asset ready; all removed
```

Two things the run showed. The idle shutdown counts from the last job, not the
last successful claim, so a stretch of failed claims while the API restarts
counts as idle and the worker recycles — harmless under the restart policy,
and the reason the policy is there. And a worker on Docker Desktop reaching the
host's API saw intermittent *network unreachable* on claims; on the box the
two share a compose network and no gateway.

## What is not done

| | |
|---|---|
| **A live run** | Needs #205 (the config fix) and this merged, then a deploy. The first `vision:upload` against live with a short clip, and the worker's log, is the proof. |
| **Detect** | A GPU pod, provisioned through a hosted provider with its credentials in the secret. Until then tracks and everything after them wait. |
| **More than one worker** | The box has room for one. A second CPU worker is a second machine, which is a provider question. |
| **A worker that survives a deploy** | A deploy restarts the stack; a job mid-run is reaped by the dispatcher and queued again. Fine for a six-second clip, a wasted hour for a match. |
