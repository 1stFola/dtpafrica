# 51 — QA fix 1: secrets

The first batch of the fix plan in [50](./50-QA-PHASES-1-6.md) §3, PR-1. It covers
criticals C5 and C3, the high finding about the env-file dump, and the medium about
the operator key in the worker's environment.

---

## The admin key was in every deploy log (C5)

The values `cd.yml` reads from Secrets Manager are not GitHub secrets, so the runner
does not mask them. Only the Postgres password and the R2 secret were masked by hand.
Every value was then passed to Ansible as `-e "name=${{ … }}"`. GitHub expands that
expression into the script text it prints, so anyone who can read the Actions logs
could read `ADMIN_API_KEY` and `VISION_R2_ACCESS_KEY_ID`.

**This was checked against a real log, not inferred.** The log of CD run 37135018237
(3 October 2026) carries `admin_api_key=` followed by a 15-character plain value. The
same is true of `vision_r2_access_key_id` (32 characters) and of the ECR registry token.
The step masked one token and handed Ansible a second one, minted by a second
`get-login-password` call. The R2 secret and the Postgres password were masked. The
check counted characters and never printed a value, and the downloaded log was
deleted. The workflow has run 238 times since 4 June 2026 with the key passed this way.

Now:

- The secrets step is one Python block. It masks every value that grants access
  (Postgres password, admin key, R2 key id, R2 secret) before anything else can print
  it. It writes all deploy variables to `$RUNNER_TEMP/deploy-secrets.json` with mode
  0600 and sets no step output carrying a secret.
- The registry token is minted once, masked, and added to the same file.
- Deploy and rollback call `ansible-playbook -e "@$VARS_FILE"`. Their `run:` text holds
  no secret, only the region, the repo URL, the branch, the GitHub token (a real
  secret, masked by the runner), the registry and the tag.
- A final `if: always()` step deletes the file. The runner discards `RUNNER_TEMP`
  anyway.
- `VISION_ENABLED` held as a JSON boolean now reaches the template as `true`, not
  Python's `True`. That bug is half of an E-medium finding; the template side is
  PR-2.

**For Fola: rotate `ADMIN_API_KEY` in `dtp/staging/app`, then redeploy.** Masking
protects future runs only. The past logs stay readable until they expire or are
deleted. Rotating the R2 access key pair is also worth doing: the key id alone does
not grant access, but the pair should be rotated together. The ECR token expired 12
hours after each run.

## The env-file dump printed the R2 keys

After `up -d`, the playbook printed `.env.staging` through a deny-list that matched
only `PASSWORD=` and `API_KEY=`, so it printed both R2 keys in full. On a manual run
there is no runner to mask anything. It now prints names only, each marked `(set)` or
`(empty)`, and never a value.

## Bootstrap and worker tokens (C3)

Both tokens lived in `vision_workers.token_hash`, and one lookup accepted either. An
unredeemed bootstrap token, which sits in provider env or cloud-init, could claim jobs
and presign master reads. A worker token handed to `register` minted a fresh one, so
the 12-hour TTL could be extended for ever.

`VisionWorker.tokenKind` (migration `20261003180000_vision_worker_token_kind`, default
`worker`) now records which kind the stored hash is:

- `mintBootstrap` writes `bootstrap`.
- `verify`, behind every job route, accepts only `worker`.
- `register` accepts only `bootstrap`. It swaps the hash with a conditional
  `updateMany` on the row still holding that bootstrap hash, so two concurrent
  registrations with one token cannot both win.
- A wrong-kind token is refused with the same message as an unknown or expired one.

Existing rows default to `worker`. That is right for every worker already registered.
A bootstrap token minted before the deploy and never redeemed becomes unusable. On
the box that is harmless, because the worker provisions a new token whenever it
starts.

## The operator key in the worker's environment

The box's worker holds the admin key as `VISION_PROVISION_API_KEY` for provisioning
and retiring. Until now it also stayed in `os.environ`, where every ffmpeg and ffprobe
process inherited it while decoding untrusted media.

- `bootstrap.main` now pops the key from the environment before the worker runs. Only
  its own frame keeps it, for the retire call.
- `media.subprocess_env()` builds an allow-list environment: `PATH`, `HOME`, locale,
  temp dirs, `LD_LIBRARY_PATH`, `SYSTEMROOT` and the CUDA/NVIDIA device variables.
  `_run`, `encoder_version` and the bench's `nvidia-smi` and synthetic-clip calls pass
  it. No child process inherits a worker token, a bootstrap token or the key.

A provision-only key separate from `ADMIN_API_KEY` would be better still. That is a
new secret and a new guard, so it stays in the backlog. Docs 46 and 06 are updated.

## Tests and checks

| Check | Result |
|---|---|
| `worker-token.service.spec.ts` (new, 7) | pass; mutation: drop the `tokenKind` comparison → 2 fail |
| API vision suite | 744 passed |
| `pnpm typecheck` | clean |
| `vision:jobcheck`, run twice | 25/25 both times; adds "a worker token cannot register for a fresh one" and "an unredeemed bootstrap token cannot act as a worker" |
| `db:purge:gate-litter` | nothing to delete |
| `prisma migrate diff`, both ways, shadow DB | no difference; without the migration the diff shows `token_kind` added |
| Worker pytest | 254 passed; mutation: `pop` → `get` on the key fails the new test |
| `cd.yml` | parses; a harness ran both embedded Python blocks on fake secrets: every secret masked, file mode 0600, `true` not `True`, the registry token added, and no secret-bearing expression left on any `run:` line |

`cd.yml` changes take effect only once merged, because GitHub runs the default
branch's copy. The first deploy after merge is the real test. Its log should show
`***` wherever a secret is passed.

## Deploying it

The API image still runs `db push` at start until PR-2, so `token_kind` will reach
live on deploy. Then record it:

```
sudo docker exec dtp-staging-api-1 pnpm --filter @dtp/api exec prisma migrate resolve --applied 20261003180000_vision_worker_token_kind
```

The migration is named for its real date, 3 October 2026, as appendix E asks. It sorts
before the two future-dated migrations already applied on live. `migrate deploy`
applies any migration it has not recorded, whatever its position, and this one
depends on nothing they created.

## What is not done

| | |
|---|---|
| **Rotating the key** | Fola's, above. |
| **A provision-only key** | The worker still uses the full admin key to provision and retire. |
| **The rest of the fix plan** | PR-2 (deploy safety) is next. |
