# 71 — The FFmpeg row in the licence register

The QA ([50](./50-QA-PHASES-1-6.md)) found FFmpeg on the live box while the licence
register marked it `REVIEW REQUIRED`, which the register defines as "Not cleared. Do not
ship." It stayed on every open list since as a decision for Fola. On 4 October 2026 Fola
decided it. This records the decision; no code that runs changed.

---

## What was found

The register's row said the licence depends on the build flags and asked for them to be
recorded. They never were. Read from the images:

| Image | FFmpeg | Licence of the build |
|---|---|---|
| CPU worker, Debian 12 | `5.1.9-0+deb12u1`, with libx264 and libx265 | GPL-2.0-or-later (`--enable-gpl`) |
| GPU worker, Ubuntu 22.04 | `4.4.2-0ubuntu0.22.04.1` | GPL-2.0-or-later (`--enable-gpl`) |

Neither image builds FFmpeg; each installs its distribution's package. The worker runs
`ffmpeg` and `ffprobe` as separate programs and links no FFmpeg library. It encodes the
proxy with libx264, which is the GPL part: an LGPL-only build does not have it.

## The decision

**Cleared for use inside DTP's own worker, with a condition.**

The GPL's conditions attach to giving copies to others, not to running the software. The
images are built by DTP's CI, pushed to DTP's private registry and run on DTP's server.
No copy leaves DTP.

The condition is that this stays true. The register lists what reopens the question: the
image given to anyone outside DTP, a public registry, **a hosted GPU provider running the
worker**, FFmpeg's libraries linked into DTP's code, or a different build. The hosted
provider is the one that is coming: it is to be decided before the first GPU pod is
rented, not assumed.

The alternative, if any of those is wanted and the answer is no, is an LGPL-only build
with another H.264 encoder in place of libx264. That is engineering: both images, the
transcode stage and its tests, and the proxy's quality and speed checked again.

Not covered: patents on H.264 and H.265, which a software licence does not speak to.

The register is an engineering record and says so at its head. This is Fola's decision,
recorded; it is not legal advice.

## What changed

- **`docs/licenses/OSS_REGISTER.md`**: the FFmpeg row is `APPROVED` for use inside DTP's
  own worker only, names the build, and points to a new section with the packages, the
  basis, the condition and what it does not cover.
- **CI**: the gates job, after it builds the worker image, reads the licence the image's
  own `ffmpeg` reports and fails if the register's row names a different one or is not
  approved. The image takes whatever the distribution ships, so nobody here chooses the
  flags; this is what notices if they change.

## Checks

| Check | Result |
|---|---|
| The CPU image's build | read from the image built from this repository: `ffmpeg -version` and `ffmpeg -L` |
| The GPU image's build | read from the same package on a plain `ubuntu:22.04`. The GPU image itself was not built |
| The new CI step, run against the local image | passes as written; fails when the row is changed to say LGPL; fails when the row is changed to not approved |
| The workflow file | parses; the step sits between the image build and the end-to-end gate |
| API suite | 1,566 passed (the specs that read the workflow among them) |

Not yet seen on GitHub: the step's first run there is this PR's own.

## After merge

Nothing to deploy. Before a hosted GPU provider is used, open the register's FFmpeg
section and decide the condition for that case.
