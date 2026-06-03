terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  # Remote state in S3 — create the bucket once manually then uncomment.
  # backend "s3" {
  #   bucket         = "dtp-terraform-state"
  #   key            = "staging/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "dtp-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ── VPC ───────────────────────────────────────────────────────────────────────

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.project}-${var.environment}-vpc" }
}

# ── Subnets ───────────────────────────────────────────────────────────────────

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = var.availability_zone
  map_public_ip_on_launch = true

  tags = { Name = "${var.project}-${var.environment}-public" }
}

resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidr
  availability_zone = var.availability_zone

  tags = { Name = "${var.project}-${var.environment}-private" }
}

# ── Internet Gateway + Routing (public subnet) ───────────────────────────────

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-${var.environment}-igw" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.project}-${var.environment}-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ── NAT Gateway (lets the private DB instance reach the internet for updates) ─

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.project}-${var.environment}-nat-eip" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id
  tags          = { Name = "${var.project}-${var.environment}-nat" }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = { Name = "${var.project}-${var.environment}-private-rt" }
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}

# ── Elastic IP for App Instance ───────────────────────────────────────────────

resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id
  tags     = { Name = "${var.project}-${var.environment}-app-eip" }
}

# ── App Instance ──────────────────────────────────────────────────────────────

resource "aws_instance" "app" {
  ami                    = var.ubuntu_ami
  instance_type          = var.app_instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.app.id]
  key_name               = var.key_pair_name

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.app_root_volume_size
    delete_on_termination = true
    encrypted             = true
  }

  # Minimal bootstrap — Ansible does the real provisioning
  user_data = file("${path.module}/user-data-app.sh")

  tags = { Name = "${var.project}-${var.environment}-app" }
}

# ── DB Instance ───────────────────────────────────────────────────────────────

resource "aws_instance" "db" {
  ami                    = var.ubuntu_ami
  instance_type          = var.db_instance_type
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.db.id]
  key_name               = var.key_pair_name

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.db_root_volume_size
    delete_on_termination = true
    encrypted             = true
  }

  # Minimal bootstrap — Ansible does the real provisioning
  user_data = file("${path.module}/user-data-db.sh")

  tags = { Name = "${var.project}-${var.environment}-db" }
}

# ── Dedicated EBS data volume for Postgres ────────────────────────────────────

resource "aws_ebs_volume" "db_data" {
  availability_zone = var.availability_zone
  size              = var.db_data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = { Name = "${var.project}-${var.environment}-db-data" }
}

resource "aws_volume_attachment" "db_data" {
  device_name  = "/dev/sdf"
  volume_id    = aws_ebs_volume.db_data.id
  instance_id  = aws_instance.db.id
  force_detach = false
}
