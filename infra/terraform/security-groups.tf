# ── App Instance Security Group ───────────────────────────────────────────────

resource "aws_security_group" "app" {
  name        = "${var.project}-${var.environment}-app-sg"
  description = "App server — allow HTTP/HTTPS from the internet, SSH from bastion/CI"
  vpc_id      = aws_vpc.main.id

  # HTTP — public
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS — public
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SSH — restrict to your IP in production.
  # 0.0.0.0/0 is kept here so GitHub Actions runner can reach it;
  # tighten after setting up a bastion or SSM Session Manager.
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project}-${var.environment}-app-sg"
    Project     = var.project
    Environment = var.environment
  }
}

# ── DB Instance Security Group ────────────────────────────────────────────────

resource "aws_security_group" "db" {
  name        = "${var.project}-${var.environment}-db-sg"
  description = "DB server — PostgreSQL accessible only from the app security group"
  vpc_id      = aws_vpc.main.id

  # Postgres — only from app instances
  ingress {
    description     = "PostgreSQL from app"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  # SSH — same reasoning as above; lock down after first setup
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project}-${var.environment}-db-sg"
    Project     = var.project
    Environment = var.environment
  }
}
