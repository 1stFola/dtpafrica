# 62 — QA fix 12: the docs

PR-12 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3, and the last. It covers the
documentation findings in appendices A, B, D, E and F. Two small code changes come with
it; neither changes behaviour. No migration, and the contract version stays `1.12.0`.

The rule for this PR was that a doc is corrected against the code or against something
checked today, not against another doc.

---

## Doc 07 lists the routes the code has

[07](./07-API-CONTRACTS.md) was written before the code and edited by hand as routes
landed. Compared with the controllers, it named 20 routes that do not exist and left out
53 that do.

**A generated table.** 07 now ends with *Every route, as built*: all 115 Vision routes,
with the permission or token each requires and the controller it is in. It is read from
the controllers' decorators by `services/api/scripts/vision-routes.ts`:

```
pnpm --filter @dtp/api vision:routes --write
```

**A test that keeps it true.** `vision-routes.spec.ts` runs with the API suite, so in CI,
and fails when:

- the table in 07 is not what the controllers have;
- a hand-written table in 07 names a route the code does not have without saying *not
  built* in its row, or says *not built* of one the code does have;
- a route has neither a permission nor a token guard of its own.

The third is a check on the code, not the doc: every one of the 115 is guarded, and the
only routes without a permission are the worker's and the partner upload's.

**The hand-written tables.** Corrected where they were wrong:

| Was in 07 | Is |
|---|---|
| `POST /vision/sources/:id/rights-evidence`, `/rights-scopes`, `/revoke` | `/vision/partners/:id/evidence`, `/vision/rights/scopes`, `/vision/rights/scopes/:id/revoke`, with the partner, signatory, refuse-acquisition and upload-grant routes beside them |
| `POST /vision/assets/:id/segments`, `/jobs` | `POST /vision/review/:assetId/camera-segments`, `POST /vision/jobs` |
| `POST /vision/datasets/:id/split`, `GET …/leakage-report` | `/splits`, `/leakage` |
| `PATCH /vision/sources/:id`; `GET /vision/assets/:id`, `/playback`, `/duplicates`; `PATCH …/match-link`; `GET /vision/review/:assetId/timeline` | marked *not built*, each with what does its job instead |
| Highlights, metrics and scout search | the section says Phase 7 and later, and each row says *not built* |

The scanner had a bug of its own, which checking its output against a second scan found:
on a file with Windows line endings it gave every route the permission of the route
before it. It normalises line endings now, with a test.

## The bucket's CORS rule is set

Docs [42](./42-PHASE-5-INCREMENT-5.md) and [43](./43-PHASE-5-INCREMENT-6.md) say the
derived bucket's CORS rule is unset and that the minimap therefore cannot read chunks.
Appendix F noted it had been set on 2 October.

Checked on 4 October 2026 with preflight requests against presigned URLs:

| Bucket | From | `GET` | `PUT` |
|---|---|---|---|
| derived | `http://localhost:5173` | allowed | refused |
| derived | the staging site's `http://<ip>` origin | allowed | refused |
| derived | any other origin | refused | refused |
| master | any origin | refused | refused |

So the minimap can read chunks today. 42 and 43 keep what they said, as history, under a
dated note saying what is true now. Docs [45](./45-REACHABLE.md) and
[47](./47-THE-VISION-ENVIRONMENT.md) say a browser upload would need `PUT` allowed on the
master bucket; that is still true and they are unchanged.

One thing this turned up: the rule names origins. When the site gets a domain or HTTPS
the new origin has to be added, or the minimap stops reading chunks. The runbook says so
now.

## Other doc corrections

| Doc | Said | Now |
|---|---|---|
| [44](./44-PHASE-6-INCREMENT-1.md) | the review queue is in the contract and not built | not built in that increment; built in [49](./49-PHASE-6-INCREMENT-3.md) |
| [48](./48-PHASE-6-INCREMENT-2.md) | the roster's `1`–`9` is the identity panel's | the same, with a note that the digits did not exist then and were built in [59](./59-QA-FIX-9-WORKSTATION.md). Doc 08's copy of the claim was corrected in 59 |
| `infra/DEPLOYMENT.md`, migrations | "20 migrations (there are more now)" | 35 on 4 October, and where the real list is |
| `infra/DEPLOYMENT.md`, baselining | every DTP database needs baselining, staging included | staging was baselined on 3 October ([52](./52-QA-FIX-2-DEPLOY-SAFETY.md)); the steps describe a local dev database |
| `infra/DEPLOYMENT.md`, the worker | a transcode needs room on `/tmp/dtp-vision`, a 2 GB tmpfs | `/var/lib/dtp-vision`, a volume on disk since 52; the worker's memory and CPU limits |
| `infra/DEPLOYMENT.md`, CORS | set the rule | done, when, for which origins, and that a new origin needs adding |
| `infra/DEPLOYMENT.md`, turning Vision on | merge a developer's `.env` R2 values into the server's secret | the same command, under a warning that it makes the server share buckets and a token with that developer's machine, and what to do instead |
| [50](./50-QA-PHASES-1-6.md) | the plan | a closing section: each batch, its pull request and its report |
| [appendix F](./qa/F-backlog-not-built.md) | four items as open | marked resolved, with the report that resolved each |

## Stale comments

- `apps/web/src/api/vision.ts`: "Phase 0 exposes one read-only endpoint."
- `AdminVisionEventsPage.tsx`: two mentions of "the next increment", for things built in
  [48](./48-PHASE-6-INCREMENT-2.md).
- The purge script's and its patterns' comments were corrected in
  [61](./61-QA-FIX-11-GATES-CI.md). `models.service.ts` and `models.controller.ts`, which
  appendix B named, had already been brought up to date by
  [57](./57-QA-FIX-7-MODELS.md).

## Two code changes

Both were left for this PR by earlier reports.

- **One default pitch.** 105 × 68 was written five times: twice in the contracts, once in
  the API's pitch model, twice in the web. The contracts' `DEFAULT_PITCH_DIMENSIONS` is
  built from the two numbers in `prediction.ts`, and the API and the web take it from
  there. Same numbers; nothing moves.
- **`phase: "0"` is gone from `GET /vision/status`.** It was a hard-coded label that had
  said Phase 0 through six phases, shown on the status panel as "Phase 0". The field and
  the row are removed. Nothing else read it.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,500 passed (was 1,492); typecheck clean |
| Web | 212 passed; typecheck and build clean |
| Contracts | 66 passed; build clean |
| Worker | not run: nothing in it changed |
| The route scanner against a second, independent scan | 115 routes each, the same paths and the same permissions |
| Mutation runner | 13 of 13 killed: the scanner, the doc's table, the hand-written tables and the guard check |
| The bucket's CORS answers | as in the table above, read from the bucket's own responses |
| Gates | not run: no route, service or schema changed. The status route lost a label |

## What is still open, in one place

Gathered from the *not done* lists of reports 51 to 61, leaving out what a later report
did. Nothing here is new.

**For Fola**

- Rotate `ADMIN_API_KEY`. It was readable in CD logs from June until [51](./51-QA-FIX-1-SECRETS.md).
- Check live rights scopes for a `restrictions` key other than `deny` or `note`. Since
  [54](./54-QA-FIX-4-RIGHTS.md) such a key denies every scope.
- Whether live has annotation versions drawn before [59](./59-QA-FIX-9-WORKSTATION.md)'s
  letterbox fix (`select count(*) from vision_annotation_versions`). If so: discard or redraw.
- Separate R2 buckets and a token for the server, so a developer's gates and the server
  do not share them. Needs the Cloudflare dashboard.
- Grow the server's root volume from 20 GiB before a full match is uploaded.
- The FFmpeg licence row in the OSS register.

**Low findings in appendix B, not done.** Earlier reports pointed these at this PR. They
change behaviour, so they are not in a docs PR, and they are listed here so they are not
lost. **Done since, in [63](./63-QA-FIX-13-LOW-FINDINGS.md).** As listed:

- The proposer of an event can accept it after someone else's correction: self-acceptance
  checks the latest row's author, not the chain's first. A second person has to have
  touched it, so it is not a one-person bypass, but it is weaker than the rule reads.
- A correction keeps `method: model` in its provenance.
- `requirePerson` is copied into five services with five error codes.
- Refusal shapes are uneven: some lack `remediation`, `ReasonRequired` is a 409.
- `gate.comparedWith` keeps only the last production version compared.

**Engineering follow-ups**

- CI runs eight of twenty-two gates. The rest need a bucket two processes share, for
  which a MinIO service in the job would do.
- A provision-only key for the worker; it still holds the admin key.
- The identity workstation shows the first 2,000 tracks of a run and says when there are
  more; it does not fetch the next page. Its boxes are still drawn through React.
- The expired-playback-URL refresh is on the identity page only, and has not been seen to
  fire.
- Dead code appendix D named: `windowProblem` in `event-review.ts`, a second
  `formatDuration` in the source detail page.

**Waiting on something outside the code** is appendix F, section A1: real footage, a GPU
run, thresholds with numbers, licensed models for jerseys, the ball and calibration.

## After merge

Nothing to deploy by hand and nothing to run. `GET /vision/status` no longer returns
`phase`.
