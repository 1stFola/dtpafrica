# ── Daily EBS snapshots of the server (Data Lifecycle Manager) ──────────────
#
# The second layer under the nightly pg_dump (roles/backup). The root volume is
# delete_on_termination, so terminating the instance loses Postgres, Docker's images
# and everything else on it; snapshots outlive the instance. Restoring one gives the
# whole box back as it was at 03:30 UTC, Postgres crash-consistent (it replays its WAL
# on start), without a rebuild. The pg_dump in R2 stays the primary: it is off AWS,
# and it restores into anything.
#
# Snapshots are incremental, billed per GB stored (about $0.05/GB-month in us-east-1).
# The first holds every used block of the volume, not its 100 GiB size; after that,
# each day stores only the blocks that changed, mostly pulled Docker layers on a
# deploy day. Set ebs_snapshot_retain_days to 0 to create none of this.

locals {
  snapshots_enabled = var.ebs_snapshot_retain_days > 0
}

data "aws_iam_policy_document" "dlm_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  count              = local.snapshots_enabled ? 1 : 0
  name               = "${var.project}-${var.environment}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume.json
}

resource "aws_iam_role_policy_attachment" "dlm" {
  count      = local.snapshots_enabled ? 1 : 0
  role       = aws_iam_role.dlm[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "server_daily" {
  count              = local.snapshots_enabled ? 1 : 0
  description        = "${var.project}-${var.environment} server daily snapshots"
  execution_role_arn = aws_iam_role.dlm[0].arn
  state              = "ENABLED"

  policy_details {
    # By the instance's Name tag, which it already has: no change to the instance.
    resource_types = ["INSTANCE"]
    target_tags = {
      Name = "${var.project}-${var.environment}-server"
    }

    schedule {
      name      = "daily"
      copy_tags = true

      # An hour after the nightly pg_dump (02:30 UTC), both before Lagos wakes up.
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["03:30"]
      }

      retain_rule {
        count = var.ebs_snapshot_retain_days
      }

      tags_to_add = {
        SnapshotCreator = "dlm"
      }
    }
  }
}
