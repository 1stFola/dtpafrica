# Deployment Runbook

Operational reference for the DTP Africa staging deployment on AWS.
For the architecture overview and executive summary see `DEPLOYMENT_PROPOSAL.md`.

---

## Architecture (quick reference)

```
Internet
    │
    ▼
[Elastic IP — static]
    │
[EC2 t3.small — Ubuntu 22.04 — public subnet]
  ├── nginx container      :80  (public — serves React app, proxies /api/)
  ├── API container        :3000 (127.0.0.1 only — NestJS)
  └── Postgres container   :5432 (Docker-internal only — never public)
```

Postgres is a container **on the same box**, not a managed instance and not a
separate host.

### Which files are actually live

There is more under `infra/` than the deployment uses, and reading the wrong file
leads to commands that fail on the server. What runs:

| | |
|---|---|
| `infra/ansible/playbook.yml` | the entry point — runs the `common`, `docker` and `deploy` roles, in that order |
| `infra/ansible/roles/deploy/` | everything that matters: repo clone, env files, image pull, stack start, health checks |
| `infra/docker-compose.staging.yml` | the live stack. Images come from ECR, tagged with the commit SHA |
| `infra/api.Dockerfile`, `infra/web.Dockerfile` | what CI builds and pushes to ECR; also what `deploy.sh` (repo root) builds on the box for the manual path |
| `infra/nginx.staging.conf` | baked into the web image; serves the React build and proxies `/api/` |
| `infra/docker-compose.yml` | Postgres on its own, for local development. `deploy.sh` also starts it, which the CD path does not |

**There is one deployed stack, and this is it.** Those three roles are all the
playbook runs, and `docker-compose.staging.yml` is the file it deploys. Take the live
invocations from the `deploy` role or from **Day-2 Operations** below.

Two further Ansible roles, `app` and `db`, used to sit here unreferenced, describing
a different shape: images built on the box, an `infra/.env.prod`, and Postgres on its
own host. Nothing ran them, and one could not have run -- its env-file task templated
a `.env.prod.j2` that was not in the role. They have been deleted, because reading
them cost real time: commands built out of them point at
`infra/docker-compose.prod.yml` and `infra/.env.prod`, neither of which exists on the
server, and they fail with `couldn't find env file`.

If a separate database host is ever wanted, that is new work rather than a dormant
role to switch on. Nothing is waiting here to be enabled.

---

## One-Time Setup Checklist

### 1. AWS prerequisites

- [ ] Create an EC2 key pair named **`dtp-staging`** in your target region and download the `.pem` file
- [ ] *(Optional)* Create an S3 bucket (`dtp-terraform-state`) and DynamoDB table (`dtp-terraform-locks`) for remote Terraform state, then uncomment the `backend` block in `infra/terraform/main.tf`
- [ ] Create two secrets in **AWS Secrets Manager**:

  **`dtp/staging/db`**
  ```json
  {
    "POSTGRES_USER": "dtp",
    "POSTGRES_PASSWORD": "<strong-random-password>",
    "POSTGRES_DB": "dtp_africa"
  }
  ```

  **`dtp/staging/app`**
  ```json
  {
    "ADMIN_API_KEY": "<strong-random-key>"
  }
  ```

- [ ] Create an IAM user for GitHub Actions with these policies:
  - `AmazonEC2FullAccess`
  - `AmazonVPCFullAccess`
  - `SecretsManagerReadWrite` (or scope it to `dtp/staging/*`)

### 2. GitHub repository secrets

Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM access key ID |
| `AWS_SECRET_ACCESS_KEY` | IAM secret access key |
| `AWS_REGION` | e.g. `us-east-1` |
| `EC2_KEY_PAIR_NAME` | `dtp-staging` |
| `EC2_SSH_PRIVATE_KEY` | Full contents of `dtp-staging.pem` |
| `GIT_REPO_URL` | `git@github.com:YOUR_ORG/YOUR_REPO.git` |

### 3. Verify before first deploy

- `infra/terraform/variables.tf` → confirm `ubuntu_ami` is current for your region
- `infra/ansible/playbook.yml` → confirm `git_repo_url` matches your repo (or override via GitHub secret)

---

## Deployment Flow

### Automatic (CI/CD)

```
push / merge to main
        │
        ▼
  CI workflow — typecheck, tests (API, web, vision worker), builds, image smoke tests
        │
        ├── any job fails ──▶ nothing deploys. The box keeps serving what it has.
        │
        │ every job passes
        ▼
  CD workflow, triggered by CI *finishing successfully* (`workflow_run`), not by the push
  └── Ansible deploy
        ├── Resolve the Elastic IP from AWS (never a stored value)
        ├── Fetch secrets from Secrets Manager
        ├── Build dtp-api and dtp-web on the runner, push to ECR tagged with the commit
        ├── Record the image currently serving traffic  ← the rollback target
        ├── ansible-playbook playbook.yml
        │     ├── common role — apt upgrade, UFW, fail2ban
        │     ├── docker role — Docker CE + Compose v2
        │     └── deploy role
        │           ├── Clone the repo at this commit, write env files (0600)
        │           ├── Start Postgres, wait for its healthcheck
        │           ├── Pull the images for this commit from ECR (never builds on the box)
        │           ├── docker compose up -d, prune unused images
        │           └── Wait for GET /api/v1/health to return 200
        ├── Health check from the runner: GET /api/v1/health
        └── if the playbook died or the health check failed
              └── redeploy the recorded previous image, re-check, and fail loudly
```

**The deploy is gated on CI, and the gate is the trigger.** CD used to run `on: push`
alongside CI, so a merge with a failing check still reached the box — the two ran in
parallel and neither waited for the other. It now starts only from a CI run whose
conclusion is `success`, and it deploys `workflow_run.head_sha`: the commit CI actually
verified, not whatever the branch tip has become since.

Two things follow from how `workflow_run` works:

- GitHub runs only the copy of `cd.yml` that is **on the default branch**. Changes to the
  deploy workflow do nothing until they are merged, and a pull request cannot exercise them.
- A failing test now blocks a deploy, which is the point — and a *flaky* test blocks one
  too. Fix or quarantine the test; do not remove the gate.

**Rollback is automatic, and it covers the application only.** The tag serving traffic is
read off the box before the playbook runs, and put back if the deploy dies or fails its
health check. ECR keeps the last ten images, so the previous tag is nearly always pullable.
Migrations **are** part of a deploy since October 2026 (docs/vision/52): after the pull
and before the swap, the new image runs `prisma migrate deploy`, forward only, and a failure
stops the deploy with the old release still serving. The rollback skips that step
(`run_migrations=false`) and the image no longer touches the schema on start, so a rollback
restores the application and leaves the schema where the newer release put it. Migrations
are additive, so the older image runs against it.

A manual `workflow_dispatch` run skips the gate by design: it is the operator saying they
know what they are deploying.
### Manual trigger (no new commit needed)

GitHub Actions UI → CD workflow → Run workflow → select `main`.

### Manual deploy from your machine

```bash
# 1. Generate inventory from current Terraform state
terraform -chdir=infra/terraform output -raw ansible_inventory \
  > infra/ansible/inventory.ini

# 2. Run the playbook
cd infra/ansible
pip install ansible boto3 botocore
ansible-galaxy collection install -r requirements.yml
ansible-playbook playbook.yml \
  -e aws_region=us-east-1 \
  -e git_repo_url=git@github.com:YOUR_ORG/YOUR_REPO.git
```

### One-click script (no Terraform/Ansible needed)

If the EC2 instance is already running and you just need to deploy the app:

```bash
# Copy script to server then SSH in and run
scp -i ~/.ssh/dtp-staging.pem deploy.sh ubuntu@<server-ip>:~/
ssh -i ~/.ssh/dtp-staging.pem ubuntu@<server-ip>
chmod +x deploy.sh && ./deploy.sh
```

---

## Database Provisioning and Migrations

### Current state (read this before changing anything)

Two mechanisms exist in this repo, and only one of them actually runs in staging:

> **Superseded on 3 October 2026 (docs/vision/52).** The deploy now runs `prisma migrate
> deploy` as its own step and the API image no longer runs `db push`. The table and the
> history below are kept for the record; the live ledger was baselined the same day.

| | `prisma db push` | `prisma migrate deploy` |
|---|---|---|
| Runs today | No — local iteration only | **Yes** — a deploy step in `infra/ansible/roles/deploy/tasks/main.yml`, and `deploy.sh` |
| Records history | No `_prisma_migrations` table | Yes |
| Reviewable SQL | None — Prisma decides at runtime | Yes, committed |
| Destructive changes | Silently allowed (`--accept-data-loss`) | Fails and stops |

As of this change, `prisma/migrations/` **can** build a database from zero. It
held 20 migrations when this list was written (there are more now; CI checks them, not
this list):

- `20260528000000_init` — baseline, the schema as it stood before the first
  incremental migration, reconstructed from git history
- `20260528120000` … `20260703130000` — the 14 original incremental migrations
- `20260910120000_db_push_catchup` — schema that only ever reached databases via
  `db push` (admin RBAC, support reports, match statistics and sheet log,
  academy change requests, and assorted columns)
- `20260924230000_vision_phase_0` — the Vision Engine tables
- `20260925150000_vision_grant_object_key_nullable` — a partner upload grant may
  exist before anyone knows which object it is for
- `20260925180000_vision_dataset_factory` — dataset versions, members, annotation
  tasks and versions, label schema versions, review decisions, active-learning items
- `20260930030000_vision_variant_encoder` — which encoder build produced a variant, because
  the CPU and GPU worker images ship different ones
- `20260930040000_recorder_idle_and_competition_status` — catch-up: the recorder idle-lock
  columns and index, and the `sb_competitions.status` default, all of which had reached
  `schema.prisma` without one

Verified on **30 Sep 2026**, against a throwaway Postgres in Docker:

- `prisma migrate diff` reports `-- This is an empty migration.` in **both** directions,
- and `prisma migrate deploy` applies all 20 to an empty database with no error.

It was false when checked an hour earlier, exactly as the note below predicted: seven
`sb_match_statistics` columns, an index, and the `sb_competitions.status` default had reached
`schema.prisma` without a migration. Staging never noticed, because the API image's `CMD` runs
`db:push`; what was broken was provisioning a **new** database, which is the one thing
`prisma/migrations/` is for. The catch-up migration uses `IF NOT EXISTS` throughout — unlike a
generated one — because every database that exists today was built by `db push` and already has
those columns, so it has to be safe on both a fresh database and an existing one. That was tested
by applying it twice.

> **CI now re-checks this on every pull request** — the `schema-migrations` job in
> `.github/workflows/ci.yml` runs both diffs and a from-zero `migrate deploy` against a
> throwaway Postgres. It exists because this instruction, aimed at a human, went stale
> twice: first when two Vision migrations landed after the list was written, and again when
> the recorder idle-lock columns, the competition status default and the submit-guard
> timestamps all reached `schema.prisma` with no migration at all.
>
> The list above is still worth keeping current by hand, since CI checks the schema and not
> the prose.

### Provisioning a brand-new database

```bash
pnpm --filter @dtp/api exec prisma migrate deploy
```

To re-verify the end-to-end equivalence claim above after adding a migration,
against a throwaway database:

```bash
pnpm --filter @dtp/api exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url "postgresql://USER:PASS@HOST:5432/dtp_migrate_check" --script
```

Empty output means the migrations and `schema.prisma` agree.
`--shadow-database-url` must point at a database you are happy to have wiped —
Prisma creates and drops the schema inside it.

### Baselining a database that already has tables but no `_prisma_migrations`

This is the situation for **every existing DTP database** — the local dev
database and the staging volume both have a full schema that `db push` built,
and no migration history at all. Running `migrate deploy` against one of them
fails with `P3005 The database schema is not empty`.

The fix is to tell Prisma these migrations are already applied, without
executing their SQL. Nothing is written to the tables; only `_prisma_migrations`
rows are inserted.

```bash
cd services/api

# Back up first. This is cheap, and the next step is easier to reason about
# when you know you can undo it.
docker compose -f ../../infra/docker-compose.staging.yml exec postgres pg_dump -U dtp dtp_africa | gzip > ~/pre-baseline-$(date +%F).sql.gz

# Mark every existing migration as applied, oldest first.
for m in \
  20260528000000_init \
  20260528120000_competition_templates \
  20260528140000_scoreboard_player_pipeline \
  20260602120000_player_slug_required \
  20260602130000_highlight_duration \
  20260603120000_player_position_philosophies \
  20260603140000_academy_login_credentials \
  20260604120000_academy_admin_fields \
  20260609120000_highlight_media_type \
  20260619120000_sb_match_event_player_label2 \
  20260621120000_sb_match_comment \
  20260627120000_sb_match_slug \
  20260703120000_sb_match_squad_players \
  20260703130000_sb_match_formations \
  20260910120000_db_push_catchup \
  20260924230000_vision_phase_0 \
  20260925150000_vision_grant_object_key_nullable \
  20260925180000_vision_dataset_factory
do
  pnpm exec prisma migrate resolve --applied "$m"
done

# Should now report: Database schema is up to date!
pnpm exec prisma migrate status
```

Caveats:

- **Only mark a migration applied if the database really contains its result.**
  If a database is missing something — say it predates `vision_phase_0` — stop
  before that migration, let `migrate deploy` apply the rest, then check
  `migrate status`.
- On Windows, run the loop in Git Bash, or use PowerShell's `foreach`.
- If `migrate status` afterwards reports drift, diff it explicitly with
  `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel ./prisma/schema.prisma --script`
  and write a real migration for the difference. Do not paper over it with
  another `resolve`.

### Decision: deployment switched from `db push` to `migrate deploy`

**Done, 3 October 2026** ([docs/vision/52](../docs/vision/52-QA-FIX-2-DEPLOY-SAFETY.md)).
The QA of Vision Phases 1–6 found the risk this section warned about was real: the image
ran `db push --accept-data-loss` on every start, **including the automatic rollback**, so
rolling back past a schema change dropped the newer tables and columns with their data.

What runs now:

1. Ansible pulls the new images, then runs
   `docker compose run --rm --no-deps -T api pnpm --filter @dtp/api db:migrate:deploy`
   — the new image's migrations, against the live database, before anything is swapped.
2. Only then does `up -d` start the new release.
3. The rollback passes `run_migrations=false`. The API `CMD` no longer touches the schema.

The live ledger was baselined on 3 October 2026 (`migrate status`: up to date), so the
first deploy under this applies only what is new. A new migration needs nothing by hand:
no `migrate resolve --applied` after a deploy. Write migrations additive (add, never drop
or narrow in the same release) so the previous image still runs if a rollback happens.

## Turning Vision on

The Vision Engine is off on a fresh box: `VISION_ENABLED` is unset, the object store is
in-memory and the compute provider is the mock (docs/vision/15). The deploy carries ten
`VISION_*` keys from the `dtp/staging/app` secret into the API container, every one
empty until the secret holds it, so a deploy without them changes nothing.

1. Add to the `dtp/staging/app` secret in AWS Secrets Manager (same JSON as `ADMIN_API_KEY`):
   `VISION_ENABLED` (`true`), `VISION_STORAGE_BACKEND` (`r2`), `VISION_COMPUTE_PROVIDER`
   (`local` until a hosted provider is credentialed), `VISION_R2_ACCOUNT_ID`,
   `VISION_R2_ACCESS_KEY_ID`, `VISION_R2_SECRET_ACCESS_KEY`, and the four bucket names
   `VISION_R2_BUCKET_MASTER`, `VISION_R2_BUCKET_DERIVED`, `VISION_R2_BUCKET_MODELS`,
   `VISION_R2_BUCKET_CLIPS`. From a machine with the AWS CLI signed in and a
   `services/api/.env` that already holds the R2 values, this merges them into the secret
   without printing any of them (Git Bash; the existing keys are kept):

   ```bash
   cd services/api && CURRENT=$(aws secretsmanager get-secret-value --secret-id dtp/staging/app --region us-east-1 --query SecretString --output text) && MERGED=$(python - "$CURRENT" <<'PY'
   import json, re, sys
   secret = json.loads(sys.argv[1])
   env = dict(re.match(r"([A-Z0-9_]+)=(.*)", line.strip()).groups() for line in open(".env", encoding="utf-8") if re.match(r"[A-Z0-9_]+=", line.strip()))
   for key in ["VISION_R2_ACCOUNT_ID", "VISION_R2_ACCESS_KEY_ID", "VISION_R2_SECRET_ACCESS_KEY", "VISION_R2_BUCKET_MASTER", "VISION_R2_BUCKET_DERIVED", "VISION_R2_BUCKET_MODELS", "VISION_R2_BUCKET_CLIPS"]:
       secret[key] = env[key].strip().strip('"')
   secret["VISION_ENABLED"] = "true"
   secret["VISION_STORAGE_BACKEND"] = "r2"
   secret["VISION_COMPUTE_PROVIDER"] = "local"
   print(json.dumps(secret))
   PY
   ) && aws secretsmanager put-secret-value --secret-id dtp/staging/app --region us-east-1 --secret-string "$MERGED" --query VersionId --output text
   ```

   Check it without printing values:

   ```bash
   aws secretsmanager get-secret-value --secret-id dtp/staging/app --region us-east-1 --query SecretString --output text | python -c "import sys,json; print(sorted(json.load(sys.stdin)))"
   ```
2. Seed the role catalogue (migrations are applied by the deploy itself):
   `sudo docker exec dtp-staging-api-1 pnpm --filter @dtp/api seed:rbac`.
3. Re-run the deploy (manual trigger). `GET /api/v1/vision/status` then reports `enabled: true`
   and the storage backend `r2`.
4. Set the CORS rule on the derived bucket so the review UI can read Parquet from it
   (docs/vision/43): allowed origins the site's origin, methods `GET` and `HEAD`, headers `*`,
   exposed headers `Content-Length`.
5. Footage reaches the box through `pnpm --filter @dtp/api vision:upload -- --source <id>
   --file <video> --api http://<server>/api/v1 --key <ADMIN_API_KEY>` from any machine; the
   API opens a resumable session and the bytes go straight to the store.
6. The CPU worker runs beside the API as the `worker` compose service, under the `vision`
   profile the env file switches on with `VISION_ENABLED`. It provisions its own bootstrap
   token through the API with the operator key and claims the CPU stages; `detect` needs a
   GPU pod. Watch it with `sudo docker compose -f infra/docker-compose.staging.yml
   --env-file infra/.env.staging logs -f worker` from `/opt/dtp-app/repo`. A full match's
   transcode needs the file twice over on `/tmp/dtp-vision` (a 2 GB tmpfs) and the box's
   memory; test with short clips first (docs/vision/46).

## Day-2 Operations

### SSH into the server

```bash
# Get IP from Terraform output
terraform -chdir=infra/terraform output server_public_ip

# SSH
ssh -i ~/.ssh/dtp-staging.pem ubuntu@<server-public-ip>
```

### View container logs

```bash
# All services
cd /opt/dtp-app/repo
docker compose -f infra/docker-compose.staging.yml logs -f

# Single service
docker compose -f infra/docker-compose.staging.yml logs -f api
docker compose -f infra/docker-compose.staging.yml logs -f web
docker compose -f infra/docker-compose.staging.yml logs -f postgres
```

### Restart a service

```bash
cd /opt/dtp-app/repo
docker compose -f infra/docker-compose.staging.yml restart api
```

### Stop / start the full stack

```bash
cd /opt/dtp-app/repo
# Stop
docker compose -f infra/docker-compose.staging.yml down

# Start (without rebuilding)
docker compose --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml up -d
```

### Redeploy after a manual code change

```bash
cd /opt/dtp-app/repo
git pull
docker compose --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml up -d --build
```

### Run a maintenance script

Maintenance scripts run **inside the API container**, not on the host. The host has
no `node_modules` — the deploy stopped installing them once CI took over building
the images — and the container additionally has the right `DATABASE_URL` already set,
so there is nothing to configure.

```bash
cd /opt/dtp-app/repo
sudo docker compose --env-file infra/.env.staging -f infra/docker-compose.staging.yml \
  exec api pnpm --filter @dtp/api <script-name>
```

Or, shorter, straight at the container — no compose file, no env file, same result:

```bash
sudo docker exec dtp-staging-api-1 pnpm --filter @dtp/api <script-name>
```

Confirm the name first with `sudo docker ps --format '{{.Names}}\t{{.Image}}'`. That
listing is also the quickest way to answer *"is my merge actually running?"* — the
image tag is the commit SHA, so compare it against `git log --oneline -1`.

**Read-only. No `--apply` exists, and running them changes nothing:**

| | |
|---|---|
| `db:report:player-stat-drift` | Goals the events record that no profile shows, and career totals that fell behind their competition rows |
| `db:report:duplicate-players` | Player records that are probably one person, with the evidence for each |

**Dry run by default. Write only when given `--apply`,** which goes after a `--` so
pnpm passes it through rather than reading it itself:

| | |
|---|---|
| `db:repair:joemark-venues` | Fixes the JOEMARK fixtures' venues and scorer names |
| `db:repair:player-lookup-keys` | Rebuilds the normalised name keys duplicate detection depends on |
| `db:repair:player-stats` | Sets competition rows to what the events say, and credits the career totals that are short |
| `db:sync:event-player-links` | Links goal and assist labels to player rows, and names the ones it cannot |
| `db:dedupe:squad-members` | Removes one of two squad rows for the same person so their name resolves to one player again, and goals stop reaching nobody. Not a merge — split history stays split |
| `db:merge:duplicate-players` | Merges duplicate player records, folding history onto the survivor |
| `db:purge:gate-litter` | Removes rows the Vision gates left behind |
| `db:purge:placeholder-players` | Removes records created from placeholder names like `Unknown` |

```bash
... exec api pnpm --filter @dtp/api db:repair:joemark-venues            # dry run
... exec api pnpm --filter @dtp/api db:repair:joemark-venues -- --apply # writes
```

Check the header before trusting it. Every one of these prints either `APPLYING` or
`dry run, pass --apply to …` at the top of its output. If the `--` is swallowed
somewhere between your shell, docker and pnpm, the flag never reaches the script: it
does a dry run instead and says so at the end, which is easy to skim past when you
were expecting a write. The direct form avoids the question entirely:

```bash
... exec api pnpm --filter @dtp/api exec tsx scripts/repair-player-stats.ts --apply
```

**Run the report before the repair**, every time. The repairs list what they are
about to touch and name the players; that list is the last chance to notice the tool
has understood the data differently from you.

`db:repair:squad-duplicates` is the exception to all of the above: it has no
`--apply` and writes straight away, because it runs unattended on every container
start from the `api.Dockerfile` CMD. There is no dry run to reach for.

### Manual database backup

```bash
# On the server
docker compose -f /opt/dtp-app/repo/infra/docker-compose.staging.yml \
  exec postgres pg_dump -U dtp dtp_africa \
  | gzip > ~/backup-$(date +%F).sql.gz
```

### Restore from backup

```bash
gunzip -c ~/backup-<date>.sql.gz \
  | docker compose -f /opt/dtp-app/repo/infra/docker-compose.staging.yml \
    exec -T postgres psql -U dtp dtp_africa
```

### Check resource usage

```bash
docker stats
df -h          # disk
free -m        # memory
```

---

## Tear Down Infrastructure

```bash
# Destroys EC2, EIP, VPC — data volume included. Irreversible.
terraform -chdir=infra/terraform destroy \
  -var="key_pair_name=dtp-staging"
```

Back up the database before running this.

---

## Upgrading the Server

To change instance type (e.g. t3.small → t3.medium):

1. Update `instance_type` in `infra/terraform/variables.tf`
2. Run `terraform apply` — AWS will stop and restart the instance
3. The Elastic IP stays attached; no DNS change needed
4. Re-run the CD workflow to redeploy the app stack
