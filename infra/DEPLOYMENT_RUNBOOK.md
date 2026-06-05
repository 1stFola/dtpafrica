# DTP Africa — Deployment Runbook
## Successful Deployment Reference

**First successful deployment:** June 5, 2026
**Platform:** AWS EC2 t3.small, Ubuntu 22.04, us-east-1
**Stack:** React (nginx) + NestJS API + PostgreSQL 16 (all in Docker on one instance)

---

## Architecture

```
Internet → Elastic IP (static)
              │
         EC2 t3.small (Ubuntu 22.04, public subnet)
              │
         Docker Compose (dtp-staging)
              ├── web container   nginx:1.27  :80   — serves React, proxies /api/
              ├── api container   node:20     :3000 — NestJS, bound to 127.0.0.1
              └── postgres        postgres:16 :5432 — Docker-internal only
```

---

## One-Time AWS Prerequisites

### 1. EC2 Key Pair
Create a key pair named `dtp-staging` in AWS Console → EC2 → Key Pairs.
Download the `.pem` file and keep it safe.

### 2. AWS Secrets Manager (us-east-1)
Create two secrets exactly as shown:

**Secret name:** `dtp/staging/db`
```json
{
  "POSTGRES_USER": "dtp",
  "POSTGRES_PASSWORD": "your-strong-password-here",
  "POSTGRES_DB": "dtp_africa"
}
```

**Secret name:** `dtp/staging/app`
```json
{
  "ADMIN_API_KEY": "your-strong-admin-key-here"
}
```

### 3. IAM User for GitHub Actions
Create an IAM user with these policies:
- `AmazonEC2FullAccess`
- `AmazonVPCFullAccess`
- `SecretsManagerReadWrite`

Generate access keys for this user.

### 4. GitHub Repository Secrets
Settings → Secrets and variables → Actions → New repository secret:

| Secret name | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM access key ID |
| `AWS_SECRET_ACCESS_KEY` | IAM secret access key |
| `AWS_REGION` | `us-east-1` |
| `EC2_KEY_PAIR_NAME` | `dtp-staging` |
| `EC2_SSH_PRIVATE_KEY` | Full contents of `dtp-staging.pem` |
| `GIT_REPO_URL` | `https://github.com/1stFola/dtpafrica.git` |

---

## How Deployment Works

### Trigger
Any push to `main` or `dev` branch automatically triggers the CD workflow.
Manual trigger: GitHub Actions → CD workflow → Run workflow.

### CD Pipeline (`.github/workflows/cd.yml`)

```
Push to main/dev
      │
      ▼
Job 1: Terraform
  1. Restore terraform.tfstate from terraform-state branch
  2. Check if EC2 instance still exists in AWS
     → If terminated/missing: clear stale state entries
     → If running: reuse existing infrastructure (NO new resources)
  3. terraform init + validate + plan
  4. Check plan: if 0 changes needed → skip apply entirely
  5. terraform apply (only if changes needed)
  6. Capture Elastic IP from outputs
  7. Save updated terraform.tfstate to terraform-state branch
      │
      ▼
Job 2: Ansible
  1. Resolve server IP from Terraform output (fallback: query AWS directly)
  2. Install ansible-core 2.16, boto3, awscli on runner
  3. Write SSH key to runner
  4. Generate inventory.ini with real server IP
  5. Wait for SSH to be ready (up to 3 minutes)
  6. Wait for cloud-init to finish
  7. Fetch secrets from AWS Secrets Manager
  8. Run playbook.yml → roles: common, docker, deploy
  9. Verify: curl http://<server-ip>/api/v1/health → must return 200
```

### Ansible Playbook Roles

**common role:**
- apt update + upgrade (waits for apt lock first)
- Installs: curl, git, ufw, fail2ban, python3
- Sets timezone to UTC
- Enables UFW (deny-by-default, SSH allowed)

**docker role:**
- Removes old Docker packages
- Adds official Docker GPG key + apt repo
- Installs: docker-ce, docker-ce-cli, containerd, buildx, compose plugin
- Enables Docker service
- Adds ubuntu user to docker group

**deploy role:**
1. Set credential facts (postgres_user, postgres_password, postgres_db, admin_api_key)
2. Install Node.js 20 LTS via NodeSource (skips if already installed)
3. Install pnpm 9.15.0 via npm (skips if already installed)
4. Create `/opt/dtp-app` directory
5. Clone or update repo at `/opt/dtp-app/repo`
6. Write `services/api/.env` from template (PORT + ADMIN_API_KEY only — no DATABASE_URL)
7. Write `infra/.env.staging` from template (all compose variables including POSTGRES_PASSWORD)
8. `pnpm install --frozen-lockfile`
9. `pnpm --filter @dtp/api prisma:generate`
10. Start Postgres container via `docker compose up -d postgres` (chdir: repo root)
11. Wait for Postgres: `docker compose exec postgres pg_isready` (12 retries × 5s)
12. Build and start full stack: `docker compose up -d --build` (chdir: repo root)
13. Open UFW ports 80 and 443
14. Wait for port 80 to be up
15. Health check: GET http://<ansible_host>/api/v1/health → 200 (40 retries × 10s)

---

## Critical Design Decisions (Lessons Learned)

### DATABASE_URL must come from Docker Compose environment, not .env file
**Problem:** Prisma loads `services/api/.env` automatically. If `DATABASE_URL` is written
there, it overrides the compose environment variable, using the wrong password or hostname.

**Solution:** `api.env.j2` deliberately omits `DATABASE_URL`. It is provided exclusively
by `docker-compose.staging.yml`:
```yaml
DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
```
Where `postgres` is the Docker Compose service name (internal DNS), and the password
is the raw value from `.env.staging` — exactly what Postgres was initialised with.

### docker compose commands must run with chdir: repo root
**Problem:** The Dockerfiles use `context: ..` (one level up from `infra/`). If
`docker compose` runs from a different directory, the build context path is wrong.

**Solution:** All `docker compose` shell tasks use `args: chdir: /opt/dtp-app/repo`
so `context: ..` resolves to the repo root where all source files are.

### Docker commands run as root, not ubuntu
**Problem:** Adding ubuntu to the docker group requires a new login session to take effect.
Ansible reuses the same SSH connection, so `become_user: ubuntu` never sees the new group.

**Solution:** All `docker compose` tasks use `become_user: root`.

### Terraform state stored in git branch, not S3
**Solution:** State file committed to `terraform-state` branch after each apply.
Restored at the start of each run so Terraform knows what already exists.
Reconcile step checks if EC2 instance still exists in AWS — if terminated, clears
stale state so Terraform recreates from scratch without hitting VPC limits.

### Health check uses ansible_host not localhost
The health check runs from the Ansible control node (GitHub Actions runner),
not from inside the server. `ansible_host` is the actual server IP.

---

## Terraform State Management

State lives in the `terraform-state` branch of this repo.

- **On each run:** state is restored before `terraform plan` and saved after `terraform apply`
- **If instance is terminated:** reconcile step removes stale resource entries so Terraform
  creates fresh resources rather than failing on non-existent IDs
- **Never commit state to main/dev:** `terraform.tfstate` is in `.gitignore`

---

## File Reference

```
.github/workflows/
  ci.yml                    — typecheck + build on PR and push
  cd.yml                    — full deploy pipeline (Terraform + Ansible)

infra/
  terraform/
    main.tf                 — VPC, subnet, IGW, EIP, EC2
    variables.tf            — region, AMI, instance type, volume size
    outputs.tf              — server_public_ip, app_url, health_check_url, ssh_command
    security-groups.tf      — ports 80, 443, 22 open; no public Postgres
    user-data.sh            — minimal bootstrap (python3 for Ansible)

  ansible/
    playbook.yml            — orchestrates common + docker + deploy roles
    ansible.cfg             — SSH settings, pipelining enabled
    requirements.yml        — community.general, community.docker, ansible.posix
    roles/
      common/tasks/main.yml — OS hardening
      docker/tasks/main.yml — Docker CE + Compose v2
      deploy/tasks/main.yml — full app deployment
      deploy/templates/
        api.env.j2          — PORT + ADMIN_API_KEY only (no DATABASE_URL)
        staging.env.j2      — all compose vars including POSTGRES_PASSWORD

  docker-compose.staging.yml  — postgres + api + web services
  api.Dockerfile              — multi-stage Node build, pnpm baked in at build time
  web.Dockerfile              — Vite build → nginx:1.27
  nginx.staging.conf          — proxy /api/ to api:3000, SPA fallback for /

deploy.sh                   — standalone one-click deploy (no CI/CD required)
```

---

## Redeploying

**Code change (automatic):** push to `dev` or `main` — pipeline runs automatically.

**Manual redeploy from GitHub Actions:**
Actions → CD — Deploy to Staging → Run workflow → Run workflow

**Manual redeploy from terminal (server already provisioned):**
```bash
ssh -i ~/.ssh/dtp-staging.pem ubuntu@<server-ip>
cd /opt/dtp-app/repo
git pull
sudo docker compose --env-file infra/.env.staging -f infra/docker-compose.staging.yml up -d --build
```

**Check logs:**
```bash
ssh -i ~/.ssh/dtp-staging.pem ubuntu@<server-ip>
cd /opt/dtp-app/repo
sudo docker compose --env-file infra/.env.staging -f infra/docker-compose.staging.yml logs -f
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 502 Bad Gateway | API container crashed | Check logs: `docker compose logs api` |
| P1000 auth failed | Wrong POSTGRES_PASSWORD in secret | Update `dtp/staging/db` in Secrets Manager |
| P1001 can't reach DB | DATABASE_URL in api/.env overriding compose | Ensure api.env.j2 has no DATABASE_URL |
| VpcLimitExceeded | Stale Terraform state, old VPCs not cleaned | Delete unused VPCs in AWS Console |
| SSH timeout | EC2 terminated but EIP still assigned | Let reconcile step clear state, re-run |
| pnpm not found | Group membership not refreshed | docker tasks run as root, not ubuntu |
