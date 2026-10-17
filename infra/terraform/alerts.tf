# ── Alerts: CloudWatch alarms to one email address ──────────────────────────
#
# Only what AWS can see from outside the box and the box cannot report about itself.
# The rest (backup failed, disk filling, site down) comes from free external checks:
# docs/support-playbook/database-backup-and-restore.md, "Alerts".
#
# Nothing here exists until `alert_email` is set. Cost: both metrics are free, the
# first ten alarms in an account are free, and SNS email is free for the first 1,000
# a month. AWS emails a confirmation link to the address; until it is clicked, no
# alarm is delivered.

locals {
  alerts_enabled = var.alert_email != ""
  alert_topic    = local.alerts_enabled ? [aws_sns_topic.alerts[0].arn] : []
}

resource "aws_sns_topic" "alerts" {
  count = local.alerts_enabled ? 1 : 0
  name  = "${var.project}-${var.environment}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = local.alerts_enabled ? 1 : 0
  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# The outage this box has already had: a build on the box spent the CPU credits, and a
# t3.small with none left accepted connections but was too throttled to answer them.
# 576 is a full balance; at 30 there is about half an hour of full-speed CPU left.
resource "aws_cloudwatch_metric_alarm" "cpu_credits_low" {
  count               = local.alerts_enabled ? 1 : 0
  alarm_name          = "${var.project}-${var.environment}-cpu-credits-low"
  alarm_description   = "CPU credit balance is nearly spent; the instance will be throttled. See docs/support-playbook/database-backup-and-restore.md"
  namespace           = "AWS/EC2"
  metric_name         = "CPUCreditBalance"
  dimensions          = { InstanceId = aws_instance.server.id }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.cpu_credit_alarm_threshold
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = local.alert_topic
  ok_actions          = local.alert_topic
}

# The instance or the hardware under it failing its status checks: the box is
# unreachable for a reason no deploy will fix. EC2's automatic recovery handles a
# failed host on its own; this says it happened.
resource "aws_cloudwatch_metric_alarm" "status_check_failed" {
  count               = local.alerts_enabled ? 1 : 0
  alarm_name          = "${var.project}-${var.environment}-status-check-failed"
  alarm_description   = "EC2 status checks are failing for the DTP server."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  dimensions          = { InstanceId = aws_instance.server.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  # No data at all means the instance is gone or stopped; that is worth an email too.
  treat_missing_data = "breaching"
  alarm_actions      = local.alert_topic
  ok_actions         = local.alert_topic
}
