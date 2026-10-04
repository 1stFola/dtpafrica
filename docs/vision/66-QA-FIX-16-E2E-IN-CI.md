# 66 — QA fix 16: the end-to-end gate in CI

[65](./65-QA-FIX-15-GATES-IN-CI.md) put twenty-one of the twenty-two gates in CI and left
`vision:e2echeck`, the one that runs the worker's container. This adds it. CI now runs
**every gate** on every pull request. Nothing that ships changes: this is the workflow and
one test.

---

## What the gate is, and why it matters

The other twenty-one gates run the control plane with the worker's part played by the
gate itself: the gate registers as a worker, claims a job, and reports a result it wrote.
That proves the API. It proves nothing about the worker.

`vision:e2echeck` runs the real one. It builds nothing itself; given an image, it starts
the container, which registers, claims a probe, a transcode and a cuts job for a real
clip, reads the master and writes the proxy through presigned URLs, and runs FFmpeg. The
gate then checks what landed: the proxy in the store, the variant rows, the frame rate,
every artifact under its own prefix, the master read audited.

It is the only check that the worker image and the API **of one commit** work together.
Until now it ran when somebody remembered to, against whatever image they had built.

## What it took

**The image.** The gates job builds `services/vision-worker` with Buildx and loads it
into the local image store. Layers are cached between runs; nearly all the build is
installing FFmpeg, which changes only when the Dockerfile does. The build sits after the
twenty-one gates, so a failing gate does not wait for an image.

**One name for the store.** A presigned URL is made by the API on the runner and used by
the worker inside its container. In 65 the store's endpoint was `http://localhost:9090`,
and inside a container `localhost` is the container. The endpoint is now
`http://host.docker.internal:9090`:

- the container already gets that name from the gate (`--add-host
  host.docker.internal:host-gateway`), pointing at the host;
- the runner is given it in the job's first step (a line in `/etc/hosts`), pointing at
  itself.

So the same URL means the same store on both sides. Docker Desktop on a laptop defines
the name already, which is why the gate has always worked there.

Everything else was already in place: the gate makes its own match since 65, the clip it
transcodes (`test-media/sample-360p.mp4`, 22 KB) is in the repository, and the worker
reaches the API through the same host alias.

## The test

`gates.spec.ts` had `vision-worker-e2e-check.ts` as the one gate allowed to be in neither
list. Being named as the exception is how it came to be the gate nothing ran. The test
now requires that the workflow runs it, and fails if:

- the workflow has no step running the end-to-end gate, or runs the eight-gate list;
- the store's endpoint in the workflow is not `host.docker.internal`, or the runner is not
  given the name;
- the gate stops passing `--add-host` to the container.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,523 passed (was 1,522); typecheck clean |
| Mutation runner | 6 of 6 killed |
| [65](./65-QA-FIX-15-GATES-IN-CI.md)'s job on GitHub | passed on its first run on Linux, with twenty-one gates. That was the rehearsal's first check against the real thing |
| **This job, rehearsed locally** | an empty database built by `migrate deploy`, the RBAC seed, `adobe/s3mock:5.2.3` reached as `host.docker.internal:9090` from the host and from a container, an API that saw none of the local `.env`, and the worker image built from this commit: `vision:gates:ci` 22/22, then `vision:e2echeck` **38/38** |
| The workflow file | parses; the job's steps are in order |

**Not yet seen on GitHub:** the two things a Windows rehearsal cannot show. The `/etc/hosts`
line (Docker Desktop defines the name itself), and `host-gateway` on a Linux runner
reaching the API and the store on the host. Both are ordinary on GitHub's runners. This
PR's own run is the check, and Auto-fix is on.

## What is not done

| Item | Why | Where |
|---|---|---|
| The GPU image in the gate | `detect` needs a GPU; the gate runs the CPU stages | when there is a GPU runner |
| A full match | The clip is ten seconds. Memory and disk on a real match are the staging box's to show | the first real upload |
| The job split in two | One job now builds an image as well as running twenty-two gates. If the build cache is cold it adds a few minutes | split if it becomes slow |

## After merge

Nothing to deploy. A pull request that breaks the worker, the worker's Dockerfile, the
job protocol between the two, or the presigned-URL contract now fails before it merges.
