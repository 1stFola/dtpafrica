# Terraform State Audit — DTP Africa Staging
**Prepared by:** Ladipo Sanni
**Date:** September 26, 2026
**In response to:** Infrastructure state questions raised before resuming Terraform

---

## Summary

The state file is out of date, publicly visible, and does not include CloudFront or the ACM
certificate. The CD workflow had a path bug that prevented state from being updated after the
first June run. Nothing was created via the AWS console — all infrastructure was attempted
through Terraform via the CD pipeline. Multiple failed runs left orphaned AWS resources that
were cleaned up by hand. The answers below are based on a full audit of the git history,
the branch contents, and the local filesystem.

---

## Question 1 — Do you have a local state file?

**Yes. There is a local state file, but it is empty (0 bytes).**

Location found:
```
C:\Users\Olamide\Documents\meedl\dtpafrica\infra\terraform\terraform.tfstate
Last modified: 22 August 2026
Size: 0 bytes
```

It is empty because the CD workflow created it as a blank placeholder when it checked out
the `terraform-state` branch. It has never been written to locally. It contains no resource
records and is not usable.

A second file was also found at:
```
C:\Users\Olamide\Documents\Olamide New\guardduty-mfa-alerts\terraform\terraform.tfstate
```
This belongs to a completely unrelated project and is not relevant.

**The only meaningful state file is the one on the `terraform-state` branch at
`infra/terraform/terraform.tfstate`.** Its contents:

| Field | Value |
|---|---|
| Serial | 9 |
| Lineage | `342fd955-9d9b-71a8-43fc-b07ab3ea3ffb` |
| Terraform version | 1.8.5 |
| Date written | 5 June 2026 |

Resources recorded:
```
aws_eip.server
aws_instance.server
aws_internet_gateway.main
aws_route_table.public
aws_route_table_association.public
aws_security_group.server
aws_subnet.public
aws_vpc.main
```

This confirms your finding: serial 9, lineage starting `342fd955`, 8 resources, no
CloudFront and no ACM certificate. **There is no newer local state file anywhere.**

---

## Question 2 — How were the certificate and CloudFront distribution made?

**CloudFront was not implemented. We are using Namecheap's CDN, configured in September
by Mr Fola and the team.**

The Namecheap CDN sits in front of the server at `54.225.155.75` and serves `dtp.africa`
through Namecheap's edge network. No CloudFront distribution is serving this site.

The AWS-based CloudFront work (commits from August) was attempted but abandoned:

### August 20 — First CloudFront attempt via Terraform/CD
Commit `01be3b3` re-enabled the Terraform job in the CD workflow. This triggered
`terraform apply` which:

1. Read the June state file (serial 9, 8 resources).
2. The CD had a **path bug**: the workflow saved state to `terraform.tfstate` at the
   repository root, but restored it from `infra/terraform/terraform.tfstate`. Every run
   after the first therefore started with no state.
3. Terraform treated everything as new and created a second VPC, EC2, EIP.
4. CloudFront creation **failed** — `InvalidArgument: The parameter origin name cannot be
   an IP address`. A raw IP was used as origin, which AWS does not accept.
5. The duplicate resources were deleted manually via AWS CLI.

### August 21 — Second attempt
The code was corrected to use the EC2 public DNS as origin and added an ACM certificate.
The CD ran again:
- Created another duplicate VPC, EC2, EIP.
- Created the **ACM certificate** (`arn:aws:acm:us-east-1:148761651145:certificate/39e1723f-...`).
- CloudFront creation began but the run timed out or was abandoned.
- Duplicate resources were again deleted manually.
- The ACM certificate DNS validation CNAME records were never added to the domain, so the
  certificate is likely still in `PENDING_VALIDATION`.

**In September, the team switched to Namecheap's CDN instead**, which is simpler to
manage for a team without a dedicated AWS infrastructure engineer and does not require
Terraform.

**What this means for the state file:** The ACM certificate exists in AWS but is not in
the state file. CloudFront does not exist. Before resuming Terraform, the orphaned ACM
certificate should either be imported into state or deleted from the AWS console to avoid
confusion.

No `CNAMEAlreadyExists` error was encountered. No console or CLI changes were made to
CloudFront or ACM outside of what the CD pipeline created.

## Question 3 — Was anything changed by hand since June?

Based on git history and the commit `e4fd412` (`The root volume is 100 GiB: Terraform and
the open-items lists say what is live`):

| Resource | Change | Method | In state? |
|---|---|---|---|
| EC2 root disk | Grown from 20 GiB to **100 GiB** on 4 October | AWS console | **No** |
| EC2 instance | Stopped and restarted multiple times during debugging | CD pipeline / console | N/A |
| Security group | No changes known beyond what Terraform set | — | Yes |
| Elastic IP | No changes — same IP `54.225.155.75` throughout | — | Yes |
| CloudFront | Not confirmed to exist | — | No |
| ACM certificate | Created August 21, validation status unknown | Terraform/CD | No |
| nginx config | Updated in repo (real-IP headers for CDN) | Git | N/A |

**The disk resize is the most critical untracked change.** The June state records
`root_block_device.volume_size = 20`. When Terraform next runs against the live instance,
it will detect a drift (20 vs 100 GiB) and attempt to resize the disk back to 20 GiB,
which would require stopping the instance and risks data loss. This must be corrected in
the Terraform code before any `apply` runs.

---

## Question 4 — Any other copies of the state?

**S3 bucket:** The early code had a commented-out S3 backend pointing at `dtp-terraform-state`
with DynamoDB table `dtp-terraform-locks`. Commit `908cdf0` removed that backend entirely.
To the best of my knowledge, **neither the S3 bucket nor the DynamoDB table was ever
created**. No `terraform init` with that backend was ever run. There is no state in S3.

**GitHub Actions cache:** Commit `908cdf0` introduced a cache-based state approach. The
cache keys were fixed strings (`terraform-state-staging`) which GitHub Actions will not
overwrite once set — only new unique keys can be saved. As a result, the cache approach
**never reliably preserved state**. The path was then changed to the git branch approach.
Any cache entries from June 2026 will have expired (GitHub retains cache for 7 days of
inactivity, maximum 90 days). There is no usable state in the Actions cache.

---

## Question 5 — CPU credit mode

**The instance is recorded as `credit_specification = unlimited` in the June state file.**

I do not have a record of anyone switching it to `standard`. The outage described
(hours of throttling) is more consistent with **memory pressure** than CPU credit
exhaustion on an unlimited instance — an unlimited t3.small would bill for burst CPU
rather than throttle. However, I cannot rule out that it was switched via the console
without being recorded here.

**Recommendation:** before adding the CPU alarm, verify the current credit mode with:
```bash
aws ec2 describe-instance-credit-specifications \
  --instance-ids i-08eadc0c132acb0ef \
  --region us-east-1 \
  --query 'InstanceCreditSpecifications[0].CpuCredits' \
  --output text
```

---

## Proposed Next Steps

### Immediate (before any Terraform runs)

1. **Verify and delete the orphaned ACM certificate.** Find
   `arn:aws:acm:us-east-1:148761651145:certificate/39e1723f-9516-4d23-9465-079a39b5558a`
   in the AWS console. Since we are using Namecheap's CDN (not CloudFront), this
   certificate serves no purpose. Delete it to keep the account clean.

2. **Remove CloudFront and ACM resources from `main.tf`.** The Terraform code currently
   defines `aws_cloudfront_distribution.app` and `aws_acm_certificate.app`. Since the
   team uses Namecheap's CDN instead, these blocks should be removed from `main.tf` and
   `outputs.tf` to prevent Terraform from trying to create them on the next apply.

3. **Fix the disk size in Terraform code.** Change `root_volume_size` default from `20`
   to `100` in `infra/terraform/variables.tf` before any plan runs. The disk was grown to
   100 GiB on 4 October. If Terraform runs against the old value it will detect drift and
   attempt to resize the disk, requiring an instance stop.

4. **Move the state file to a private S3 bucket.** Enable versioning and server-side
   encryption. Delete the `terraform-state` branch once the migration is confirmed.

5. **Fix the state file path bug in the CD workflow.** The restore and save steps must
   both reference the same path. The working-directory is set to `infra/terraform`, so
   both should use `terraform.tfstate` with no prefix.

### Before resuming CloudWatch alarms and snapshots

6. **Import existing resources into a fresh state file.** With the S3 backend in place,
   run `terraform import` for each live resource (VPC, subnet, IGW, route table,
   security group, EC2, EIP) to build an accurate baseline before running any plan.

7. **Confirm CPU credit mode** and adjust the alarm threshold accordingly:
   ```bash
   aws ec2 describe-instance-credit-specifications \
     --instance-ids i-08eadc0c132acb0ef \
     --region us-east-1 \
     --query 'InstanceCreditSpecifications[0].CpuCredits' \
     --output text
   ```

---

## Database Protection — Current State and Steps to Complete

The database is a PostgreSQL 16 container running on the EC2 root disk. If the instance
is terminated or replaced, the data is gone. This is the most critical risk in the current
architecture.

### What already exists in the codebase

A full nightly backup system was built in commit `8b2a85f` and is part of the Ansible
deploy. It includes:

- **`infra/backup/dtp-backup.py`** — a Python script that dumps Postgres inside the
  container (client always matches server version), compresses with `pg_dump -Fc`,
  verifies the archive, uploads to an S3-compatible bucket off AWS, and prunes old copies.
- **Cloudflare R2 as the off-box store** — backups leave AWS entirely, so an AWS account
  compromise or accidental instance termination does not destroy them.
- **Dead man's switch via healthchecks.io** — if a backup fails or the timer stops firing,
  an alert is sent by email.
- **`dtp-backup verify latest`** — restores the newest backup into a throwaway Postgres
  container and counts rows, proving the backup is actually usable.
- **Systemd timer** — runs nightly, separate from the Docker stack.

### Steps to activate (if not already done)

The `STAGING-MANUAL-SETUP.md` file has the full checklist. The short version:

**B1 — Create the R2 bucket**
1. Log into Cloudflare → R2 → Create bucket → name: `dtp-db-backups`
2. Create an R2 API token scoped only to that bucket (Object Read & Write)
3. Copy the Access Key ID, Secret Access Key, and Account ID

**B2 — Create healthchecks.io monitors**
1. Create a check named `dtp-db-backup` with period 1 day, grace 3 hours
2. Create a check named `dtp-disk` with period 15 minutes, grace 30 minutes
3. Enable email alerts on both

**B3 — Add the secrets to AWS Secrets Manager (`dtp/staging/app`)**

| Key | Value |
|---|---|
| `BACKUP_S3_ENDPOINT` | `https://<cloudflare_account_id>.r2.cloudflarestorage.com` |
| `BACKUP_S3_BUCKET` | `dtp-db-backups` |
| `BACKUP_S3_ACCESS_KEY_ID` | from B1 |
| `BACKUP_S3_SECRET_ACCESS_KEY` | from B1 |
| `BACKUP_HEARTBEAT_URL` | ping URL from the `dtp-db-backup` check |
| `DISK_HEARTBEAT_URL` | ping URL from the `dtp-disk` check |

**B4 — Trigger a deploy and verify**
```bash
# After the next deploy, SSH to the server and run:
systemctl list-timers dtp-backup.timer dtp-disk-check.timer  # both should appear
sudo systemctl start dtp-backup.service                       # run a backup now
sudo dtp-backup verify latest                                  # prove it restores
```
If `verify latest` prints a row count and exits 0, the backup is working end to end.

### Additional data-loss prevention measures

**Before any Terraform change that touches the EC2 instance:**
```bash
# Take a manual EBS snapshot before any risky maintenance
aws ec2 create-snapshot \
  --volume-id $(aws ec2 describe-instances \
    --instance-ids i-08eadc0c132acb0ef \
    --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' \
    --output text) \
  --description "pre-terraform-$(date +%F)" \
  --region us-east-1
```

**Move the database off the root disk (longer term).** The root disk is deleted when the
instance is terminated. A dedicated EBS data volume (`/dev/sdf` mounted at `/data/postgres`)
survives instance replacement. This is the safest architectural change — it decouples the
database from the server lifecycle. The Terraform code already has a commented-out version
of this from the original two-instance plan.

**Enable EBS automated snapshots via AWS Data Lifecycle Manager.** Once Terraform is
running again, `snapshots.tf` (referenced in `STAGING-MANUAL-SETUP.md`) can automate 7
daily EBS snapshots with a 7-day retention policy. Until then, take manual snapshots
before any maintenance.

**Summary of current data-loss risk:**

| Risk | Current protection | Gap |
|---|---|---|
| Bad migration / app bug | `dtp-backup` nightly R2 dump (if activated) | None if B1–B4 are done |
| Instance terminated | R2 dump (off-box) | EBS snapshot not yet automated |
| AWS region outage | R2 on Cloudflare (different infra) | No cross-region replica |
| Postgres disk corruption | R2 dump + verify | EBS snapshot for point-in-time |
| Accidental `docker volume rm` | R2 dump | EBS snapshot |

---

## What I Confirm Did Not Happen

- No `terraform apply` was run directly from my local machine against staging.
- No AWS console changes were made to CloudFront, the ACM certificate, security groups,
  or the Elastic IP.
- No state was committed or pushed intentionally after June 5.
- The S3 bucket and DynamoDB table from the old backend config were never created.
- CloudFront was never successfully provisioned. The site is served through Namecheap's
  CDN, configured in September by Mr Fola and the team.
