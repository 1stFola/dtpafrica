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

**Both were attempted through Terraform via the CD pipeline, not the AWS console or CLI.**

Here is the exact sequence of events reconstructed from git history:

### August 20 — First CloudFront attempt
Commit `01be3b3` (`feat: uncomment Terraform job for CDN provisioning`) re-enabled the
Terraform job in the CD workflow. This triggered `terraform apply` which:

1. Read the June state file (serial 9, 8 resources)
2. The CD had a **path bug**: the workflow saved state to `terraform.tfstate` at the
   repository root, but restored it from `infra/terraform/terraform.tfstate`. So it
   restored the correct June state but saved updates to the wrong path, where they were
   never found on the next run.
3. Because of this, the reconcile step found no instance in state and cleared all state
   entries before applying.
4. Terraform then tried to create everything from scratch: new VPC, subnet, IGW, security
   group, EC2 instance, EIP — **and a new CloudFront distribution using a raw IP address
   as the origin, which AWS rejected** (`InvalidArgument: The parameter origin name cannot
   be an IP address`).
5. Result: all EC2/network resources were created (new duplicates), CloudFront was **not**
   created. These duplicate resources were deleted manually using AWS CLI.

### August 21 — Second CloudFront attempt
The Terraform code was updated to use `aws_instance.server.public_dns` as the CloudFront
origin (correct) and to add an ACM certificate for `dtp.africa`. The CD ran again:

1. Again started with no valid state (same path bug).
2. Created another new VPC, subnet, IGW, security group, EC2 instance, EIP — and this time
   also created the **ACM certificate** (`arn:aws:acm:...:certificate/39e1723f-...`).
3. CloudFront creation began (`aws_cloudfront_distribution.app: Creating...`) but the run
   was either interrupted or timed out — the distribution's final status is unknown.
4. These duplicate resources were again deleted manually.

**Therefore:**
- The ACM certificate was created by Terraform via the CD pipeline on ~21 August.
- The CloudFront distribution may or may not exist — its creation was in progress when logs
  end. It needs to be verified in the AWS console.
- No `CNAMEAlreadyExists` error was observed in any run logs.
- The DNS validation CNAME records for the ACM certificate were never added (no domain
  registrar action was taken), so the certificate is likely in `PENDING_VALIDATION` status.
- No CloudFront distribution is serving `dtp.africa` — the site currently serves directly
  from the EC2 instance.

---

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

1. **Verify CloudFront in the AWS console.** Check whether
   `aws_cloudfront_distribution.app` (tagged `dtp-staging-cdn`) actually exists.
   If it does, note its distribution ID and domain name.

2. **Check the ACM certificate status.** Find certificate
   `arn:aws:acm:us-east-1:148761651145:certificate/39e1723f-9516-4d23-9465-079a39b5558a`
   in the console. If it exists and is `PENDING_VALIDATION`, either add the validation
   CNAME records or delete it (Terraform will recreate it cleanly).

3. **Fix the disk size in Terraform code.** Change `root_volume_size` default from `20`
   to `100` in `infra/terraform/variables.tf` **before** any plan runs. This prevents
   Terraform from detecting drift and attempting to resize the live disk.

4. **Move the state file to a private S3 bucket** as planned. Enable versioning and
   server-side encryption on the bucket. Delete the `terraform-state` branch once the
   migration is confirmed.

5. **Fix the state file path bug.** The CD workflow restored state from
   `infra/terraform/terraform.tfstate` but saved it to `terraform.tfstate` (repo root).
   Both the restore and save steps must use the same path. The working-directory is
   already set to `infra/terraform`, so the save step should reference just
   `terraform.tfstate` with no path prefix.

### Before resuming CloudWatch alarms and snapshots

6. **Import existing resources into a fresh state file.** With the S3 backend in place,
   run `terraform import` for each live resource (VPC, subnet, IGW, route table,
   security group, EC2, EIP, and any CloudFront/ACM resources that exist) to build an
   accurate state before running any plan.

7. **Confirm CPU credit mode** (see Question 5 above) and adjust the alarm threshold
   accordingly.

8. **Protect the Postgres data.** The database lives on the EC2 root disk. Before any
   Terraform change that touches the instance, take a manual EBS snapshot as a backup.
   The nightly backup script added in commit `8b2a85f` should be verified as running.

---

## What I Confirm Did Not Happen

- No `terraform apply` was run directly from my local machine against staging.
- No AWS console changes were made to CloudFront, security groups, or the Elastic IP.
- No state was committed or pushed intentionally after June 5.
- The S3 bucket and DynamoDB table from the old backend config were never created.
