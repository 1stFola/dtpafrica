# DirectToPro Africa — AWS Deployment Proposal

**Prepared by:** [Your Name]
**Date:** June 4, 2026
**Subject:** Cloud Infrastructure Plan for Staging Deployment on AWS

---

## 1. Overview

This document outlines the proposed cloud deployment strategy for the **DirectToPro Africa** platform — a full-stack web application consisting of a React frontend, a NestJS API backend, and a PostgreSQL database.

The goal is to move the application from a local development environment to a fully automated, reproducible, and secure cloud deployment on **Amazon Web Services (AWS)**, with a CI/CD pipeline that deploys every approved change to `main` automatically.

---

## 2. Application Summary

The platform is a monorepo containing three core runtime components:

| Component | Technology | Role |
|---|---|---|
| **Web (Frontend)** | React 18, Vite, served via nginx | Player profiles, scoreboard, academy dashboard, admin panel |
| **API (Backend)** | NestJS (Node.js 20), Prisma ORM | REST API, business logic, data access |
| **Database** | PostgreSQL 16 | Persistent storage for players, matches, academies, blog content |

All three are containerised using **Docker** and orchestrated with **Docker Compose**.

---

## 3. Proposed AWS Architecture

All services run on a single EC2 instance (`t3.small`) behind a static Elastic IP. Postgres runs in a Docker container on the same host and is never exposed to the internet — it is only reachable from within the Docker network on that machine.

```
Internet
    │
    ▼
[Elastic IP — static public address]
    │
[EC2 t3.small — Ubuntu 22.04 — public subnet]
  ├── nginx container     (port 80/443 — serves React app, proxies /api/ to API)
  ├── API container       (port 3000 — internal only, bound to 127.0.0.1)
  └── PostgreSQL container (port 5432 — Docker-internal only, never public)
        └── Docker volume (persistent data storage on the root EBS volume)
```

### Key design decisions

- **Single instance** — All services run together on one `t3.small`. This keeps costs low for staging while the platform is being validated. Splitting services across instances is straightforward in Terraform if scaling is needed later.
- **Elastic IP** — The public IP never changes across reboots or instance replacements, keeping DNS records stable.
- **Postgres inside Docker** — The database is on the same host but isolated within the Docker network. Port 5432 is not open in the security group, so it is physically unreachable from outside the instance.
- **Encrypted EBS root volume** — All data at rest is encrypted.
- **No NAT Gateway** — Since everything runs on one public instance, no NAT Gateway is needed. This eliminates the largest cost driver (~$35/month) compared to a two-instance setup.

---

## 4. Security Model

### Network level (AWS Security Group)

| Traffic | Source | Allowed |
|---|---|---|
| HTTP (80) | Internet | Yes — web app |
| HTTPS (443) | Internet | Yes — for SSL once domain is connected |
| SSH (22) | CI runner / admin IP | Yes |
| PostgreSQL (5432) | Internet | **No — not open** |
| PostgreSQL (5432) | Docker-internal | Yes — API container only |

### Secrets management

All credentials are stored in **AWS Secrets Manager** — never in the repository or in any file committed to git. Ansible retrieves them at deploy time and injects them into environment files on the server (mode `0600`, readable only by the deploy user).

Two secret entries:

- `dtp/staging/db` — PostgreSQL username, password, and database name
- `dtp/staging/app` — Admin API key

### OS level

- **UFW firewall** — deny-by-default, only ports 22/80/443 open
- **fail2ban** — blocks brute-force SSH attempts automatically
- API container bound to `127.0.0.1:3000` — not reachable from outside the instance directly

---

## 5. Tooling Stack

| Tool | Purpose |
|---|---|
| **Terraform** | Provisions all AWS infrastructure as code — VPC, subnet, internet gateway, security group, EC2 instance, Elastic IP. Idempotent and version-controlled. |
| **Ansible** | Configures the server after provisioning: installs Node.js 20, pnpm, Docker CE, retrieves secrets, clones the repo, generates env files, runs Prisma migrations, and starts all containers. |
| **GitHub Actions** | CI/CD pipeline — type-checks and builds on every pull request, then automatically deploys to AWS on every merge to `main`. |
| **Docker / Docker Compose** | Packages all three services into isolated containers using the existing `docker-compose.staging.yml`. |
| **AWS Secrets Manager** | Single source of truth for all credentials. Nothing sensitive is stored in the repo or passed as plain text through CI/CD logs. |

---

## 6. CI/CD Pipeline

Every merge to `main` follows this fully automated path:

```
Developer merges PR to main
           │
           ▼
    CI Workflow (GitHub Actions)
    ├── Install dependencies (pnpm)
    ├── Type-check entire workspace
    ├── Build all packages (engines, UI, API, web)
    └── Validate Docker Compose configuration
           │ All checks pass
           ▼
    CD Workflow (GitHub Actions)
    │
    ├── Job 1 — Terraform apply
    │     Creates or updates AWS infrastructure (idempotent — safe to re-run)
    │     Outputs the Elastic IP dynamically to the next job
    │
    └── Job 2 — Ansible playbook
          ├── common role   — apt upgrade, UFW, fail2ban, timezone
          ├── docker role   — Docker CE + Compose v2 plugin (official Docker repo)
          └── deploy role
                ├── Retrieve secrets from AWS Secrets Manager
                ├── Install Node.js 20 LTS + pnpm 9.15.0
                ├── Clone repository at latest main commit
                ├── Write env files (secrets injected, files locked to 0600)
                ├── pnpm install --frozen-lockfile
                ├── prisma generate
                ├── Start Postgres container, wait until healthy
                ├── prisma db push  (creates / migrates all tables)
                ├── Build and start API + web containers
                └── Smoke test — /api/v1/health must return HTTP 200
```

If any step fails the pipeline stops immediately. No partial deploys reach production.

---

## 7. Infrastructure Specifications

### EC2 Instance

| Parameter | Value |
|---|---|
| OS | Ubuntu 22.04 LTS |
| Instance type | `t3.small` — 2 vCPU, 2 GB RAM |
| Root disk | 20 GB gp3 EBS (encrypted) |
| Subnet | Public (internet-accessible via IGW) |
| Public address | Elastic IP (static — survives reboots) |

### Estimated AWS cost (us-east-1, on-demand)

| Resource | Approx. monthly cost |
|---|---|
| t3.small EC2 | ~$15 |
| 20 GB gp3 EBS | ~$2 |
| Elastic IP | ~$4 |
| Data transfer (light) | ~$1–3 |
| **Total estimate** | **~$22–24/month** |

> This is significantly cheaper than the two-instance alternative (~$70–80/month) by eliminating the NAT Gateway and second EC2 instance. The architecture can be split into multiple instances at any time by updating the Terraform configuration.

---

## 8. Repository Structure (deployment files)

All deployment code lives inside the existing repository:

```
infra/
├── terraform/
│   ├── main.tf              — VPC, EC2, Elastic IP, networking
│   ├── security-groups.tf   — firewall rules
│   ├── variables.tf         — configurable parameters (region, instance type, AMI)
│   ├── outputs.tf           — emits public IP, SSH command, app URL after apply
│   └── user-data.sh         — minimal bootstrap (installs python3 for Ansible)
│
├── ansible/
│   ├── playbook.yml         — single playbook targeting the one server
│   ├── inventory.ini        — generated from Terraform output
│   ├── requirements.yml     — pinned Ansible collection dependencies
│   └── roles/
│       ├── common/          — OS hardening, packages, UFW, fail2ban
│       ├── docker/          — Docker CE + Compose v2 installation
│       └── deploy/          — secrets retrieval, VICE, repo deploy, containers
│           └── templates/
│               ├── api.env.j2      — services/api/.env (Prisma + NestJS)
│               └── staging.env.j2  — infra/.env.staging (Docker Compose vars)
│
└── DEPLOYMENT.md            — operational runbook (day-2 operations)

deploy.sh                    — standalone one-click deploy script (no CI/CD required)

.github/workflows/
├── ci.yml                   — typecheck + build on every PR
└── cd.yml                   — automated deploy to AWS on merge to main
```

---

## 9. What Is NOT in Scope (this phase)

The following are intentionally deferred:

- **SSL/HTTPS** — Port 443 is open and nginx is ready. Adding a Let's Encrypt certificate requires pointing a domain at the Elastic IP and running Certbot — a single follow-up task.
- **Automated database backups** — A manual `pg_dump` procedure is documented in `DEPLOYMENT.md`. A scheduled backup can be added as a cron job or Lambda function.
- **Horizontal scaling** — The single-instance setup supports scaling to multiple app instances behind an ALB. This is a straightforward Terraform change when needed.
- **Production environment** — This targets staging. Promotion to production reuses the same Terraform and Ansible code with a different `environment` variable and stronger instance sizes.

---

## 10. Summary

This proposal delivers a cost-effective (~$22/month), secure, and fully automated deployment of the DirectToPro Africa platform on AWS. The entire infrastructure is defined as code, secrets never leave AWS Secrets Manager, and every merge to `main` triggers a complete, verified deployment automatically.

The setup is deliberately simple for this phase — one server, one pipeline, one place to look when something needs attention — while being structured in a way that scales cleanly when the platform grows.

---

*For technical questions or to review the implementation files, refer to the `infra/` directory of the repository or contact the author of this document.*
