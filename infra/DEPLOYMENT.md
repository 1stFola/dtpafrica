# Deployment Guide

## Architecture

```
Internet
   │
   ▼
[Elastic IP]
   │
[App EC2 — public subnet]
  ├── web container  (nginx :80)
  └── api container  (NestJS :3000, localhost-only)
           │  DATABASE_URL (private IP)
           ▼
[DB EC2 — private subnet]
  └── postgres container (:5432)
        └── /data/postgres (dedicated EBS volume)
```

## One-Time Setup Checklist

### 1. AWS prerequisites (do once, manually)

- [ ] Create an EC2 key pair named **`dtp-staging`** and download the `.pem` file
- [ ] Create an S3 bucket for Terraform state (e.g. `dtp-terraform-state`) and a DynamoDB table (`dtp-terraform-locks`) then uncomment the `backend` block in `infra/terraform/main.tf`
- [ ] Create two secrets in **AWS Secrets Manager** (same region as the infra):

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

- [ ] Create an IAM user / role for GitHub Actions with the following policies:
  - `AmazonEC2FullAccess`
  - `AmazonVPCFullAccess`
  - `SecretsManagerReadWrite` (or a least-privilege policy scoped to `dtp/staging/*`)

### 2. GitHub repository secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret name | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM access key ID |
| `AWS_SECRET_ACCESS_KEY` | IAM secret access key |
| `AWS_REGION` | e.g. `us-east-1` |
| `EC2_KEY_PAIR_NAME` | `dtp-staging` (just the name, not the file) |
| `EC2_SSH_PRIVATE_KEY` | Full contents of `dtp-staging.pem` |
| `GIT_REPO_URL` | `git@github.com:YOUR_ORG/YOUR_REPO.git` |

### 3. Update hardcoded values

Before the first deploy, update these placeholders:

- `infra/terraform/variables.tf` → verify `ubuntu_ami` is current for your region
- `infra/ansible/playbook-app.yml` → set `git_repo_url`
- `infra/ansible/playbook-db.yml` + `playbook-app.yml` → adjust `aws_region` / `vpc_cidr` if you changed the defaults

## Deployment Flow

```
push to main
     │
     ▼
  CI workflow  (typecheck, build, compose-validate)
     │ success
     ▼
  CD workflow
     ├── terraform apply  (idempotent — safe to re-run)
     ├── ansible playbook-db.yml  (provision DB instance)
     │     ├── common role  (packages, UFW, fail2ban)
     │     ├── docker role  (Docker CE + Compose v2)
     │     └── db role      (format EBS, fetch secrets, run Postgres)
     └── ansible playbook-app.yml  (provision App instance)
           ├── common role
           ├── docker role
           └── app role     (fetch secrets, clone repo, write .env, build & start containers)
```

## Manual Operations

### Re-deploy without infra changes
```bash
# Trigger the CD workflow manually from GitHub Actions UI
# or push an empty commit:
git commit --allow-empty -m "chore: redeploy" && git push
```

### Run Ansible locally
```bash
cd infra/ansible
pip install ansible boto3 botocore
ansible-galaxy collection install -r requirements.yml

# Generate inventory from Terraform outputs
terraform -chdir=../terraform output -raw ansible_inventory > inventory.ini

# Run
ansible-playbook playbook-db.yml  -e aws_region=us-east-1
ansible-playbook playbook-app.yml -e aws_region=us-east-1 \
  -e db_private_ip=$(terraform -chdir=../terraform output -raw db_private_ip)
```

### SSH into instances
```bash
# App instance (direct)
ssh -i ~/.ssh/dtp-staging.pem ubuntu@<app-public-ip>

# DB instance (via app as jump host)
ssh -i ~/.ssh/dtp-staging.pem \
    -o ProxyJump=ubuntu@<app-public-ip> \
    ubuntu@<db-private-ip>
```

### View container logs
```bash
# On app instance
cd /opt/dtp-app/repo
docker compose -f infra/docker-compose.prod.yml logs -f

# On DB instance
cd /opt/dtp-db
docker compose logs -f
```

### Manual DB backup
```bash
# On DB instance
docker compose -f /opt/dtp-db/docker-compose.yml exec postgres \
  pg_dump -U dtp dtp_africa | gzip > /data/backup-$(date +%F).sql.gz
```
