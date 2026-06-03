# DirectToPro Africa — AWS Deployment Proposal

**Prepared by:** Ladipo Sanni
**Date:** June 3, 2026
**Subject:** Cloud Infrastructure Plan for Staging Deployment on AWS

---

## 1. Overview

This document outlines the proposed cloud deployment strategy for the **DirectToPro Africa** platform — a full-stack web application consisting of a React frontend, a NestJS API backend, and a PostgreSQL database.

The goal is to move the application from a local development environment to a fully automated, reproducible, and secure cloud deployment on **Amazon Web Services (AWS)**, with a CI/CD pipeline that deploys every approved change to main automatically.

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

The infrastructure separates the application server from the database server for security, performance, and independent scalability.

```
Internet
    │
    ▼
[Elastic IP — static public address]
    │
[App Server — EC2, public subnet]
  ├── nginx container  (port 80/443 — public web traffic)
  └── API container    (port 3000 — internal only, no public exposure)
           │
           │  Private network connection (DATABASE_URL)
           ▼
[Database Server — EC2, private subnet]
  └── PostgreSQL container  (port 5432 — accessible only from App Server)
        └── Dedicated EBS volume (persistent data storage, separate from OS disk)
```

### Key design decisions

- **Two EC2 instances** — the database runs on a dedicated instance in a private subnet, meaning it is physically unreachable from the internet. Only the app server can connect to it.
- **Elastic IP** on the app server ensures the public IP address never changes, so DNS records remain stable across reboots or instance replacements.
- **NAT Gateway** allows the private database instance to download updates and Docker images without being directly exposed to the internet.
- **Dedicated EBS data volume** for PostgreSQL data, separate from the OS disk. This means the database can survive an OS-level rebuild and can be independently snapshotted for backups.
- **Encrypted EBS volumes** on both instances for data at rest.

---

## 4. Security Model

Security is addressed at multiple layers:

### Network level (AWS Security Groups)
| Traffic | Source | Destination | Allowed |
|---|---|---|---|
| HTTP (80) | Internet | App Server | Yes |
| HTTPS (443) | Internet | App Server | Yes |
| SSH (22) | Restricted IP / CI | App Server | Yes |
| PostgreSQL (5432) | App Server only | DB Server | Yes |
| PostgreSQL (5432) | Internet | DB Server | **No — blocked** |
| SSH (22) | App Server (proxy) | DB Server | Yes |

### Secrets management
All credentials (database password, API keys) are stored in **AWS Secrets Manager** — never in the repository, never in environment files committed to git. The application retrieves them at deploy time only.

Two secret entries are created:
- `dtp/staging/db` — PostgreSQL username, password, and database name
- `dtp/staging/app` — Admin API key

### OS level
- **UFW firewall** enabled on both instances (deny-by-default)
- **fail2ban** installed to block brute-force SSH attempts
- Docker API containers bind only to `127.0.0.1` — not accessible from outside the instance

---

## 5. Tooling Stack

| Tool | Purpose |
|---|---|
| **Terraform** | Provisions all AWS infrastructure (VPC, subnets, EC2, EBS, security groups, Elastic IP, NAT Gateway) as code. Idempotent — safe to run repeatedly. |
| **Ansible** | Configures both servers after provisioning: installs Docker, retrieves secrets, writes environment files, clones the repo, builds and starts containers. |
| **GitHub Actions** | CI/CD pipeline — runs tests and type checks on every pull request, then automatically deploys to AWS on every merge to `main`. |
| **Docker / Docker Compose** | Packages each service (web, API, database) into isolated containers for consistent, reproducible deployments. |
| **AWS Secrets Manager** | Stores all credentials. No secrets are ever stored in the repository or passed as plain text through CI/CD logs. |

---

## 6. CI/CD Pipeline

Every code change follows this automated path:

```
Developer pushes to main
         │
         ▼
   CI Workflow (GitHub Actions)
   ├── Install dependencies
   ├── Type-check entire codebase
   ├── Build all packages (engines, UI, API, web)
   └── Validate Docker Compose configuration
         │ All checks pass
         ▼
   CD Workflow (GitHub Actions)
   ├── Step 1 — Terraform apply
   │     Creates or updates AWS infrastructure (idempotent)
   │     Outputs: App public IP, DB private IP
   │
   ├── Step 2 — Ansible: provision Database server
   │     ├── Install and harden Ubuntu OS
   │     ├── Install Docker CE
   │     ├── Format and mount dedicated EBS data volume
   │     ├── Retrieve DB credentials from Secrets Manager
   │     └── Start PostgreSQL 16 container
   │
   └── Step 3 — Ansible: provision App server
         ├── Install and harden Ubuntu OS
         ├── Install Docker CE
         ├── Retrieve all credentials from Secrets Manager
         ├── Clone repository at latest main commit
         ├── Generate .env file (secrets injected, never stored in git)
         ├── Build and start API + web containers
         └── Smoke test: verify /api/v1/health returns HTTP 200
```

If any step fails, the pipeline stops and the deployment does not proceed.

---

## 7. Infrastructure Specifications

### App Server (EC2)
| Parameter | Value |
|---|---|
| OS | Ubuntu 22.04 LTS |
| Instance type | t3.small (2 vCPU, 2 GB RAM) — upgradeable |
| Root disk | 20 GB gp3 EBS (encrypted) |
| Subnet | Public (direct internet access via IGW) |
| Public address | Elastic IP (static) |

### Database Server (EC2)
| Parameter | Value |
|---|---|
| OS | Ubuntu 22.04 LTS |
| Instance type | t3.micro (2 vCPU, 1 GB RAM) — upgradeable |
| Root disk | 30 GB gp3 EBS (encrypted) |
| Data disk | 50 GB gp3 EBS (encrypted, dedicated to Postgres data) |
| Subnet | Private (no direct internet exposure) |
| Access | Only reachable from App Server security group |

### Estimated AWS cost (us-east-1, on-demand)
| Resource | Approx. monthly cost |
|---|---|
| t3.small (app) | ~$15 |
| t3.micro (db) | ~$8 |
| EBS volumes (100 GB total) | ~$9 |
| Elastic IP | ~$4 |
| NAT Gateway | ~$35 |
| **Total estimate** | **~$70–80/month** |

> Note: NAT Gateway is the largest cost driver. For a cost-optimised setup, it can be replaced with a small bastion/NAT instance (~$4/month) once the infrastructure is stable.

---

## 8. Repository Structure (new files)

All deployment code lives inside the existing repository under `infra/`:

```
infra/
├── terraform/
│   ├── main.tf                  — VPC, EC2, EBS, networking
│   ├── security-groups.tf       — firewall rules
│   ├── variables.tf             — configurable parameters
│   └── outputs.tf               — exports IPs for Ansible
│
├── ansible/
│   ├── playbook-db.yml          — DB server provisioning
│   ├── playbook-app.yml         — App server provisioning
│   ├── requirements.yml         — Ansible collection dependencies
│   └── roles/
│       ├── common/              — OS hardening (all instances)
│       ├── docker/              — Docker CE installation
│       ├── db/                  — PostgreSQL setup
│       └── app/                 — App deployment
│
├── docker-compose.prod.yml      — Production compose (no local Postgres)
└── DEPLOYMENT.md                — Step-by-step operational runbook

.github/workflows/
├── ci.yml                       — Existing: typecheck + build
└── cd.yml                       — New: automated deploy to AWS
```

---

## 9. What Is NOT in Scope (this phase)

The following are intentionally deferred to keep this phase focused:

- **SSL/HTTPS** — The infrastructure is HTTPS-ready (port 443 open, nginx in place). Adding a Let's Encrypt certificate is a single Ansible task once a domain is pointed at the Elastic IP.
- **Automated database backups** — A manual `pg_dump` procedure is documented. Scheduled EBS snapshots or a cron-based backup can be added as a follow-up.
- **Horizontal scaling / load balancer** — The current architecture supports one app instance. Scaling would require moving to an ALB + Auto Scaling Group, which is straightforward to add in Terraform later.
- **Production environment** — This plan targets a staging environment. Promoting to production is a matter of duplicating the Terraform workspace and adjusting instance sizes.

---

## 10. Summary

This proposal delivers a secure, automated, and fully reproducible deployment of the DirectToPro Africa platform on AWS. Every merge to `main` will automatically provision or update infrastructure, configure servers, retrieve secrets, and deploy the latest application — with a health check to confirm the deployment succeeded before the pipeline completes.

The entire infrastructure is defined as code, meaning it can be torn down and rebuilt identically in minutes, and every change is tracked in version control.

---

*For technical questions or to review the implementation files, please refer to the `infra/` directory of the repository or contact the author of this document.*
