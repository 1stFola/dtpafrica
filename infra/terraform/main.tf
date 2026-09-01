terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  # State is stored in GitHub Actions cache between runs (see cd.yml).
  # No S3 bucket or DynamoDB table needed.
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

# ── Public subnet ─────────────────────────────────────────────────────────────

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = var.availability_zone
  map_public_ip_on_launch = true

  tags = { Name = "${var.project}-${var.environment}-public" }
}

# ── Internet Gateway + Route Table ────────────────────────────────────────────

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

  tags = { Name = "${var.project}-${var.environment}-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ── Elastic IP — static public address for the instance ──────────────────────

resource "aws_eip" "server" {
  domain   = "vpc"
  instance = aws_instance.server.id

  tags = { Name = "${var.project}-${var.environment}-eip" }

  depends_on = [aws_internet_gateway.main]
}

# ── Single EC2 instance (runs Postgres + API + web) ───────────────────────────

resource "aws_instance" "server" {
  ami                    = var.ubuntu_ami
  instance_type          = var.instance_type   # t3.small
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.server.id]
  key_name               = var.key_pair_name

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size  # 20 GiB
    delete_on_termination = true
    encrypted             = true
  }

  # Minimal bootstrap — installs python3 so Ansible can connect immediately
  user_data = file("${path.module}/user-data.sh")

  tags = { Name = "${var.project}-${var.environment}-server" }
}

# ── ACM Certificate for dtp.africa (must be in us-east-1 for CloudFront) ─────

resource "aws_acm_certificate" "app" {
  domain_name               = "dtp.africa"
  subject_alternative_names = ["www.dtp.africa"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${var.project}-${var.environment}-cert" }
}

# ── CloudFront CDN Distribution ───────────────────────────────────────────────
# Sits in front of the EC2 Elastic IP. EC2 instance is unchanged.
# - /assets/* cached at edge for 1 year (Vite content-hashed filenames)
# - /api/*    forwarded with no cache
# - /*        HTML pages cached 1 hour, SPA 404 fallback

resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "${var.project}-${var.environment}"
  price_class         = "PriceClass_100"
  aliases             = ["dtp.africa", "www.dtp.africa"]

  # EC2 public DNS — CloudFront requires a hostname, not a raw IP.
  # AWS auto-assigns ec2-X-X-X-X.compute-1.amazonaws.com to every instance.
  origin {
    domain_name = aws_instance.server.public_dns
    origin_id   = "ec2-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Static assets — cache aggressively
  ordered_cache_behavior {
    path_pattern     = "/assets/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ec2-origin"
    compress         = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 31536000
    max_ttl                = 31536000
  }

  # API — never cache, pass all headers
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ec2-origin"
    compress         = false

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type", "X-Admin-Api-Key", "Origin"]
      cookies { forward = "all" }
    }

    viewer_protocol_policy = "https-only"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
  }

  # HTML pages — short cache
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ec2-origin"
    compress         = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  # SPA fallback — React Router needs 404/403 to return index.html
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  # ACM certificate for dtp.africa — enables HTTPS on your custom domain
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.app.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = { Name = "${var.project}-${var.environment}-cdn" }

  depends_on = [aws_eip.server]
}
