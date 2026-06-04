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
