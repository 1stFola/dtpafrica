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
  CI workflow — typecheck, build, compose-validate
        │ passes
        ▼
  CD workflow
  ├── Job 1: terraform apply
  │     Provisions VPC, subnet, security group, EC2, Elastic IP
  │     Outputs: server_public_ip → passed to Job 2
  │
  └── Job 2: ansible-playbook playbook.yml
        ├── common role    — apt upgrade, UFW, fail2ban
        ├── docker role    — Docker CE + Compose v2
        └── deploy role
              ├── Fetch secrets from Secrets Manager
              ├── Install Node.js 20 + pnpm 9.15.0
              ├── Clone repo at latest main
              ├── Write env files (0600)
              ├── pnpm install --frozen-lockfile
              ├── prisma generate
              ├── Start Postgres, wait for pg_isready
              ├── prisma db push
              ├── docker compose up --build (postgres + api + web)
              └── Smoke test: GET /api/v1/health → HTTP 200
```

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

| | `prisma db push` | `prisma migrate deploy` |
|---|---|---|
| Runs today | **Yes** — `infra/api.Dockerfile` `CMD`, and `deploy.sh` | No |
| Records history | No `_prisma_migrations` table | Yes |
| Reviewable SQL | None — Prisma decides at runtime | Yes, committed |
| Destructive changes | Silently allowed (`--accept-data-loss`) | Fails and stops |

As of this change, `prisma/migrations/` **can** build a database from zero. It
holds 18 migrations:

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

Verified: `prisma migrate diff` reports **no difference** between
`prisma/migrations/` and the current `schema.prisma`, in both directions — both
runs output `-- This is an empty migration.`

> Re-check this whenever a migration is added. The list above went stale once
> already: two Vision migrations landed after it was written, and the baselining
> loop below did not name them, which would have left a database baselined short
> and then failed on the next `migrate deploy`.

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

### Decision: should deployment switch from `db push` to `migrate deploy`?

**Recommendation: yes, but as a separate, deliberate change — not as part of
this one.** Nothing in the deploy path has been changed here.

Why switch:

- The container today runs `prisma db push --accept-data-loss` on **every
  start** (`services/api/package.json` → `db:push`, invoked from the
  `api.Dockerfile` `CMD`). A schema edit that drops or narrows a column drops
  production data on the next restart, with no prompt and no diff. That is the
  single biggest argument, and it is a live risk rather than a theoretical one.
- `db push` produces no history, so there is no way to tell which schema a given
  deployed image expects, and no way to review the SQL before it runs.
- Rolling back is currently "edit the schema and push again", which for a
  dropped column means restoring from `pg_dump`.

Why it has not been switched here:

- `db push` is what works in staging today. Switching provisioning mechanics is
  a deployment-risk change and deserves its own review, its own deploy window,
  and a fresh backup.
- The staging database must be baselined (previous section) **before** the
  switch, or the first deploy after it fails on `P3005` and the API container
  restart-loops.
- `migrate deploy` is stricter by design: it stops on a failed migration rather
  than reconciling. That is the behaviour we want, but it turns some silent
  recoveries into hard deploy failures, so the first few deploys need watching.

If and when it is switched, the change is:

1. Baseline the staging database (previous section). Confirm
   `prisma migrate status` reports up to date.
2. Add `"db:migrate:deploy": "prisma migrate deploy"` to
   `services/api/package.json`.
3. In `infra/api.Dockerfile`, replace `db:push` with `db:migrate:deploy` in the
   `CMD`. Do the same in `deploy.sh`.
4. Deploy with a fresh `pg_dump` in hand, and watch the API container logs
   through the first restart.

Until then, `db push` remains the provisioning mechanism in staging, and
`prisma/migrations/` is kept correct and verified so that the switch is a
configuration change rather than a migration-writing exercise.

---

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

These three report what they would do and write nothing until given `--apply`.
It goes after a `--`, so pnpm passes it through rather than reading it itself:

| | |
|---|---|
| `db:repair:joemark-venues` | Fixes the JOEMARK fixtures' venues and scorer names |
| `db:sync:event-player-links` | Links goal and assist labels to player rows, and names the ones it cannot |
| `db:purge:gate-litter` | Removes rows the Vision gates left behind |

```bash
... exec api pnpm --filter @dtp/api db:repair:joemark-venues            # dry run
... exec api pnpm --filter @dtp/api db:repair:joemark-venues -- --apply # writes
```

`db:repair:squad-duplicates` is the exception: it has no `--apply` and writes
straight away, because it runs unattended on every container start from the
`api.Dockerfile` CMD. There is no dry run to reach for.

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
