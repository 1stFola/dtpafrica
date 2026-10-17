# Staging: manual secret and monitoring setup

These are the steps a deploy cannot do for you. There are two parts:

- **Part A**, the session signing keys, comes from `fix/security-gaps`.
- **Part B**, backups and heartbeats, comes from `feat/db-backups-and-alerts`.

Both parts are still needed now that Terraform applies are on hold (17 October 2026):

- **Part A is required.** Once the security change reaches `main`, the deploy stops
  before it touches the server if either key is missing. The API also refuses to start
  in production without them.
- **Part B is the only off-box protection and the only alerting for now.** Terraform is
  not being applied, so the EBS snapshots (`snapshots.tf`) and the CloudWatch alarms
  (`alerts.tf`) do not exist. That leaves three things doing the job:
  - the nightly dump in R2;
  - the two heartbeats, which also fire when the box disappears;
  - the uptime monitor.

Do all the Secrets Manager edits in one sitting, before either change is merged to
`main`. Keys that a branch does not use yet are ignored, so adding them early is
harmless.

Everything below is free on the plans named.

---

## Part A: session signing keys (`ADMIN_JWT_SECRET`, `ACADEMY_JWT_SECRET`)

### A1. Generate two values

Each value must be:

- at least 32 characters;
- different from the other;
- different from `ADMIN_API_KEY`.

Run one of these twice:

```bash
openssl rand -hex 32
```

That works in Git Bash, which ships with Git for Windows. In PowerShell:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

Do not use `Get-Random`, which is not cryptographically random.

### A2. Add them to the secret

1. In the AWS console, switch to region **us-east-1** and open **Secrets Manager**,
   then the secret **`dtp/staging/app`**.
2. Click **Retrieve secret value**, then **Edit**.
3. On the **Key/value** tab, click **Add row** twice and enter:

   | Key | Value |
   |---|---|
   | `ADMIN_JWT_SECRET` | first value from A1 |
   | `ACADEMY_JWT_SECRET` | second value from A1 |

   Use the Key/value tab rather than Plaintext, so the JSON cannot be broken. Check
   that neither value has a trailing space.
4. Click **Save**. Leave every other key alone. In particular, do not change
   `ADMIN_API_KEY`: the vision worker's provision key is derived from it.

### A3. What happens on the next deploy

- CD reads both keys, hides them in the logs, and writes them to the server. If either
  is missing, the deploy run fails with
  `dtp/staging/app is missing ADMIN_JWT_SECRET...`, and the server is left as it was.
- **Everyone is signed out once.** Admins and academies sign in again with their
  usual passwords. Tokens issued before this were signed with the old key and are now
  rejected.

### A4. Check it worked

- The CD run is green, and its health check passed.
- Admin sign-in at `https://dtp.africa/admin` works, and so does an academy sign-in.
- A write to a newly protected route without credentials is refused. This should
  print `401`:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://dtp.africa/api/v1/benchmarks
  ```

To rotate a key later, repeat A1 and A2 for that key and redeploy. Everyone of that
kind (admin or academy) is signed out once.

---

## Part B: off-box backups, heartbeats and uptime

The full runbook is `docs/support-playbook/database-backup-and-restore.md`, which
arrives with the backups branch. These are its one-time steps, without the Terraform
step.

### B1. A bucket of its own in Cloudflare R2

1. In the Cloudflare dashboard, go to **R2**, click **Create bucket**, and name it
   `dtp-db-backups`.
2. Go to **R2**, then **Manage API tokens**, then **Create API token**:
   - Permission: **Object Read & Write**.
   - Scope: **only the `dtp-db-backups` bucket**.
   - Do not reuse the Vision keys. A leaked Vision key should not be able to delete
     backups.
3. Copy the **Access Key ID** and **Secret Access Key**. The secret is shown once.
4. Note your **Account ID**, shown on the R2 overview page. The endpoint is
   `https://<account id>.r2.cloudflarestorage.com`.

### B2. Two heartbeats on healthchecks.io (free plan)

1. Sign up, then go to **Integrations** and make sure email to you is enabled.
2. Click **Add Check** twice:

   | Name | Period | Grace |
   |---|---|---|
   | `dtp-db-backup` | 1 day | 3 hours |
   | `dtp-disk` | 15 minutes | 30 minutes |

3. Copy each check's **ping URL** (`https://hc-ping.com/<uuid>`). Treat these as
   secrets: anyone holding one can silence that alert.

### B3. Add six keys to `dtp/staging/app`

Edit the secret the same way as in A2:

| Key | Value |
|---|---|
| `BACKUP_S3_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` |
| `BACKUP_S3_BUCKET` | `dtp-db-backups` |
| `BACKUP_S3_ACCESS_KEY_ID` | from B1 |
| `BACKUP_S3_SECRET_ACCESS_KEY` | from B1 |
| `BACKUP_HEARTBEAT_URL` | the `dtp-db-backup` ping URL |
| `DISK_HEARTBEAT_URL` | the `dtp-disk` ping URL |

If any key is missing, the deploy still succeeds, but the nightly backup fails and
says so in `journalctl -u dtp-backup`. A missing heartbeat URL sends nothing.

### B4. After the next deploy, prove one backup end to end

SSH to the server as described in `infra/DEPLOYMENT.md`, then run:

```bash
systemctl list-timers dtp-backup.timer dtp-disk-check.timer
```

```bash
sudo systemctl start dtp-backup.service
```

```bash
sudo dtp-backup verify latest
```

The first command shows both timers scheduled. The second makes a backup now. The
third downloads that backup, restores it into a throwaway Postgres and counts rows.
After that, `dtp-db-backup` turns green on healthchecks.io, and `dtp-disk` turns green
within 15 minutes.

### B5. Uptime monitor

On UptimeRobot or Better Stack (free plan), create an HTTP **keyword** monitor:

- URL: `https://dtp.africa/api/v1/health/ready`
- Keyword: `"db":"ok"`
- Interval: every 5 minutes
- Alerts: email

The endpoint comes with the backups branch. Until that branch is deployed, it returns
404, so create the monitor after B4.

### Skipped for now

Step 5 of the runbook is skipped while Terraform applies are on hold. That step covers
the CloudWatch CPU-credit and status-check alarms and the 7 daily EBS snapshots. With
it skipped:

- the disk heartbeat going silent is what tells you the box is down;
- a large spend of CPU credits shows up only as the uptime monitor failing.

---

## Checklist

- [ ] A1–A2: `ADMIN_JWT_SECRET` and `ACADEMY_JWT_SECRET` are in `dtp/staging/app`, before
      the security change is merged to `main`.
- [ ] B1: the `dtp-db-backups` bucket and its own scoped token exist.
- [ ] B2: the two healthchecks.io checks exist, with email on.
- [ ] B3: the six `BACKUP_*` and `*_HEARTBEAT_URL` keys are in `dtp/staging/app`.
- [ ] Both changes are merged and deployed.
- [ ] A4: sign-ins work and the anonymous POST returns 401.
- [ ] B4: `dtp-backup verify latest` passes and both checks are green.
- [ ] B5: the uptime monitor is created and green.
