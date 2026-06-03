variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Short project identifier — used in resource names and tags"
  type        = string
  default     = "dtp"
}

variable "environment" {
  description = "Deployment environment label"
  type        = string
  default     = "staging"
}

# ── Networking ────────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR for the public subnet (app instance)"
  type        = string
  default     = "10.0.1.0/24"
}

variable "private_subnet_cidr" {
  description = "CIDR for the private subnet (DB instance)"
  type        = string
  default     = "10.0.2.0/24"
}

variable "availability_zone" {
  description = "AZ for both subnets — same AZ keeps inter-instance traffic free"
  type        = string
  default     = "us-east-1a"
}

# ── EC2 ───────────────────────────────────────────────────────────────────────

variable "app_instance_type" {
  description = "Instance type for the app server"
  type        = string
  default     = "t3.small"
}

variable "db_instance_type" {
  description = "Instance type for the Postgres server"
  type        = string
  default     = "t3.micro"
}

# Ubuntu 22.04 LTS  — update the AMI ID if you switch regions.
# Find current AMIs: aws ec2 describe-images --owners 099720109477 \
#   --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"
variable "ubuntu_ami" {
  description = "Ubuntu 22.04 LTS AMI ID for the target region"
  type        = string
  default     = "ami-0c7217cdde317cfec" # us-east-1 as of 2024-06 — verify before use
}

variable "key_pair_name" {
  description = "Name of the EC2 key pair to associate with both instances (must already exist in AWS)"
  type        = string
}

# ── App EBS ───────────────────────────────────────────────────────────────────

variable "app_root_volume_size" {
  description = "Root EBS volume size (GiB) for the app instance"
  type        = number
  default     = 20
}

variable "db_root_volume_size" {
  description = "Root EBS volume size (GiB) for the DB instance"
  type        = number
  default     = 30
}

variable "db_data_volume_size" {
  description = "Dedicated EBS data volume size (GiB) — mounted at /data/postgres"
  type        = number
  default     = 50
}
