# ── Single-instance security group ───────────────────────────────────────────
# All services (web, API, Postgres) run on one instance.
# Postgres is never exposed publicly — it is accessed only via localhost inside Docker.

resource "aws_security_group" "server" {
  name        = "${var.project}-${var.environment}-sg"
  description = "DTP server - HTTP/HTTPS public, SSH restricted"
  vpc_id      = aws_vpc.main.id

  # HTTP — public web traffic
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS — for when SSL is added
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SSH — open to 0.0.0.0/0 so GitHub Actions CI runner can reach it.
  # Tighten to your own IP once initial setup is complete.
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # All outbound — needed for apt, Docker pulls, AWS API calls
  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project}-${var.environment}-sg"
    Project     = var.project
    Environment = var.environment
  }
}
