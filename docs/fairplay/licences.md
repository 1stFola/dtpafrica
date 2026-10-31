# FairPlay licences: inventory, notices and the FFmpeg build review

Phase 6.5. This is an engineering record, not legal advice. **These rulings are Fola's:** this page
sets out what was found and proposes an answer. Every Edge row in the
[register](../licenses/OSS_REGISTER.md#fairplay-edge-venue-service) stays `REVIEW REQUIRED` until
then, and the Edge does not go beyond development (B9, B10).

Nothing here changed what the Edge does on a match. The installer now also refuses an image that
differs from this review.

## What needs a ruling

| # | Question | Proposed answer |
|---|---|---|
| B9 | Does the 4 October ruling on FFmpeg extend to the Edge's different build? | Yes, on the same condition: only while the image stays on DTP-owned machines in a named DTP custodian's care (D12) |
| B10 | Are the Edge's other rows cleared? | Yes for the rows marked "proposed APPROVED", for the same use |
| B10a | `benburkert/openpgp`, inside MediaMTX, has no licence file. Is that accepted? | Yes for use inside DTP only, with the row kept open as a known gap. It must be settled before any copy leaves DTP |
| New | If the machine stays DTP's but an organiser's staff operate it, is that still inside DTP? | Fola's call, and it depends on who fills each job (R7). No copy changes hands, so the proposal is yes. An organiser owning, keeping or installing it is no |

## How it was read

Nothing was taken from a README or from memory.

| Part | Where it was read | What was found |
|---|---|---|
| FFmpeg | `ffmpeg -version` and `ffmpeg -L` in the Edge image | 7.1.5, Debian's `7:7.1.5-0+deb13u1`, GPL-2.0-or-later |
| Python packages | each package's own metadata in the image | 21 packages, all permissive except certifi's MPL-2.0 file licence. The register called cffi MIT; it states MIT-0 |
| Debian packages | `dpkg-query` and each `/usr/share/doc/<package>/copyright` | 292 packages on Debian 13.7, none from `contrib` or `non-free`, no copyright file naming AGPL as a licence. Many are GPL or LGPL, as expected of an operating system |
| MediaMTX | the licence in its image; the module list built into the binary, at the pinned digest | MIT, with 84 modules |
| MediaMTX's modules | each module's repository at that exact version, through GitHub's licence API, then the text itself where GitHub could not classify it (19 modules) | permissive, with the two exceptions below |
| The console's bundle | the built files and the lockfile's packages | react, react-dom and scheduler, all MIT |

**Limits of this reading.** A module was read at its repository's root licence; folders vendored
inside a module were not walked. The Debian result reads the `License:` lines of copyright files,
and does not establish which code each binary links. Python, Debian and the build were read from the
image built on this laptop today. Debian's updates can change versions on a rebuild, so
`deploy/licences.sh` records what a given machine really has.

### Two exceptions in MediaMTX

- **`github.com/benburkert/openpgp` has no licence file.** Its headers say "BSD-style license" and
  point to a LICENSE file the repository does not have. It is a fork of `golang.org/x/crypto/openpgp`,
  which is BSD-3-Clause, so the intent looks clear, but nothing grants the fork's own changes in
  terms. MediaMTX lists it as an indirect dependency, and only its `aes/keywrap` package appears in
  the binary's strings, which is a weak signal rather than proof. DTP neither modifies nor
  redistributes it. The real fix is upstream; nothing has been raised there, because that is an
  outward-facing step for Fola to choose.
- **`github.com/cyphar/filepath-securejoin` is BSD-3-Clause AND MPL-2.0.** MPL is file-level copyleft
  and bites only on distributing modified files. DTP does neither.

## FFmpeg build review

**What is different from what was cleared.** The 4 October ruling names Debian 12's 5.1.9 and
Ubuntu's 4.4.2, and the row says a different build reopens the question. The Edge has Debian 13's
7.1.5. Both builds are distribution packages, configured `--enable-gpl`, and neither uses
`--enable-nonfree`. The licence is the same, GPL-2.0-or-later. What differs is the version and the
exact set of libraries linked.

**How the Edge uses it** (`tests/test_boundaries.py` holds this to the code):

| Program | When | Encodes? |
|---|---|---|
| `ffprobe` | every recorded segment | no |
| `ffmpeg -c copy` | cutting an evidence clip (`evidence.py`, [ADR-0013](./adr/0013-evidence-clips-by-stream-copy.md)) | no: the camera's own encode is copied |
| `ffmpeg -c:v libx264` | the synthetic test feeds only (`synth.py`, the `synthetic` Compose profile) | yes, and never on a match |

So, unlike the Vision worker, the Edge uses **no GPL-only part of the build on a match**. That matters
in two places:

- **It keeps the basis of the ruling.** These are separate programs started on a command line, with
  no FFmpeg library linked into DTP's code, and the conditions attach to giving copies to others.
- **It makes the way out cheaper than the worker's.** If a copy must ever go to an organiser, the
  Edge could use an LGPL-only FFmpeg without replacing an H.264 encoder, because it needs only the
  MP4 parts and stream copy. That would mean compiling FFmpeg, and re-running the evidence tests.
  It would also shrink an 884 MB image. It has not been built or tried, and nothing needs it while
  the Edge stays inside DTP.

**What reopens the ruling, if given:**

- the image, or a machine carrying it, is given, sold or lent to an organiser or anyone else outside DTP;
- an organiser installs the Edge on their own machine from DTP's files, even though the package comes from Debian;
- the image is made pullable from a public registry;
- FFmpeg's libraries are linked into DTP's code, or the build changes.

**What does not reopen it.** A clip or report handed to an organiser is output, not a copy of FFmpeg.
The console's JavaScript does reach a reviewer's browser, but it contains no FFmpeg.

**If a copy ever does leave DTP,** the GPL's source obligation applies to FFmpeg and to the GPL
libraries it links, and notices must go with it. MediaMTX's module texts would have to be collected as
well, since its image does not contain them.

**Not covered: patents.** H.264 and H.265 are under patent pools whatever software handles them, and
a software licence says nothing about that. The Edge stores and copies the cameras' encodes and
encodes nothing on a match, which is a fact to give an adviser, not an answer. Not answered here, as
in the register.

## Notices

| What | Where |
|---|---|
| Every part, its version and its licence | [`THIRD_PARTY_NOTICES.md`](../../services/fairplay-edge/THIRD_PARTY_NOTICES.md) |
| Full texts the installed image holds | `deploy/licences.sh <folder>`, `notices.txt` and `mediamtx-LICENSE` |
| The console's, which reach each reviewer's browser | `/third-party-notices.txt` on the Edge, from `apps/fairplay-console/public` |
| A machine's own inventory and SBOM (CycloneDX) | `deploy/licences.sh <folder>`, `inventory.json` and `sbom.cdx.json` |

The console's notice is the one that was really missing: its bundle kept React's `@license` comments,
which point to a LICENSE file that was not served. The MIT licence asks for the text to go with copies.

Not used, though the pack names them: Video.js and rclone (a test holds this).

## What keeps this true

`fairplay-edge licences --check` compares the image with `fairplay_edge/licences_reviewed.py`, and exits 2
on any of these:

- ffmpeg absent, or reporting another licence, or another series than 7.1 (a Debian security update
  within 7.1 passes, as it should);
- ffmpeg built with `--enable-nonfree`;
- a Python package unreviewed, missing, or at another version or licence;
- a Debian package from `contrib` or `non-free`.

`deploy/install.sh` and `deploy/update.sh` run it after the build and before starting anything. An
update that fails it goes back to the old tag and keeps running. CI cannot do this, because CI builds no
Edge image, so it runs the same comparison's unit tests and holds the list to `constraints.txt`,
`compose.yaml`, the notices file and the register.

## F20, which was parked with this

The threat review tied the FFmpeg part of F20 to B9: FFmpeg isn't version-pinned and pip doesn't use
`--require-hashes`.

| Part | Where it stands |
|---|---|
| Base image and MediaMTX | pinned by digest |
| Python packages | pinned by version, and now checked at install. **No hashes**, so a tampered wheel at the same version would pass |
| FFmpeg | not pinned, deliberately: Debian removes superseded versions and this is how security fixes arrive. The series and licence are now checked at install |
| `cap_drop`, `no-new-privileges` and `read_only` on `init` and the synthetic feeds | not looked at here |

Hashes would need the wheels downloaded and the image rebuilt to prove it, which needs Fola's approval,
so F20 stays open for that part.

## Checks

| Check | Result |
|---|---|
| Edge suite, in the Edge test image | 395 passed, 1 skipped (the one run by the cloud e2e check); `test_licences.py` is new, 16 test functions |
| Console: `pnpm test`, `pnpm typecheck`, `pnpm build` | 28 passed; typecheck clean; built, with `third-party-notices.txt` in `dist` |
| `fairplay-edge licences --check` on the real image | as reviewed: FFmpeg 7.1.5, 21 Python and 292 Debian packages |
| A real install and update, Compose on this laptop, synthetic feeds | see below, all passed |

The stack run built its images from the local Edge image, so **it downloaded nothing**. Each run used
a two-line Dockerfile over that image, with the new code copied in. The real Dockerfile was not
rebuilt, because that would download Python packages. The Dockerfile itself did not change: the
tool is a plain module in a package that already ships.

| On the real stack | Result |
|---|---|
| Install, with the reviewed list doctored to say FFmpeg 5.1 | refused, naming "ffmpeg is 7.1, reviewed as 5.1"; nothing started |
| Install, as reviewed | passed; Edge healthy |
| `deploy/licences.sh` | all five files written, 401 SBOM components, 3.8 MB of notices, no Debian package without a copyright file, no secret in any file |
| `/third-party-notices.txt` | served by the Edge |
| Update, doctored | refused for that same reason; tag back to the old one; old image still running and healthy; maintenance off |
| Update, as reviewed | passed; new tag, healthy |

**A bug this found, fixed.** The guard first used `docker compose run edge`. That works at install,
but during an update the running Edge holds its fixed address, so every update would have been refused
with "Address already in use". My first run of the "update refuses" check passed for that wrong reason.
Only the following "update passes" check exposed it. The guard now uses `docker run --network none`,
and the check also requires the FFmpeg reason in the output.

**Not tested:**

- the real Dockerfile rebuilt with this code, for the reason above;
- an install on Linux, and so `deploy/licences.sh` on a Linux host;
- any legal question. This is not legal advice.

## After merge

Nothing to deploy. When Fola rules, the register's rows change status, and B9 and B10 close.

## Handover for 6.5 (prompt pack section K)

```text
DTP FAIRPLAY | PHASE 6.5 DELIVERY
STATUS: inventory, notices and the FFmpeg build review are complete; the rulings are Fola's and are not made; every Edge row stays REVIEW REQUIRED

REPOSITORY FACTS CONFIRMED
- Existing patterns used: the register's format; the worker's CI guard that holds the FFmpeg row to the image; measure.sh's shape
- Hardware facts actually verified: none
- Unknowns remaining: who operates the machine at a venue (R7), which bears on the ruling

IMPLEMENTED
- Code paths changed: fairplay_edge/licences.py, licences_reviewed.py, deploy/licences.sh (new); CLI licences; install.sh and update.sh refuse an image that differs; console public/third-party-notices.txt; THIRD_PARTY_NOTICES.md
- APIs and migrations: none
- Local/Cloud config: none

SECURITY + COST
- Auth and evidence changes: none; the notice is a public static file holding only the MIT text
- New dependencies and license: none
- New recurring cost: $0

TEST EVIDENCE
- Commands actually run: tests/test_licences.py, tests/test_boundaries.py, the Edge suite; console test, typecheck, build; a real install and update, refused and allowed; deploy/licences.sh
- Passed / failed / untested: as above; the real Dockerfile rebuild and a Linux host untested
- Measured replay/CPU/RAM/SSD outcomes: none; this phase measures none

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: none in the code. benburkert/openpgp, inside MediaMTX, has no licence file; a ruling, not a code fix
- Steps to revert safely: revert the commit
- Human approvals required: Fola's rulings on B9, B10, B10a and the operating question; hashes for F20 need an approved download
- Proposed next phase: 6.6, cost and rights
```
