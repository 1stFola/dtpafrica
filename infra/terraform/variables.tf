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
  description = "CIDR for the public subnet"
  type        = string
  default     = "10.0.1.0/24"
}

variable "availability_zone" {
  description = "Availability zone for the subnet and instance"
  type        = string
  default     = "us-east-1a"
}

# ── EC2 ───────────────────────────────────────────────────────────────────────

variable "instance_type" {
  description = "EC2 instance type — t3.small gives 2 vCPU / 2 GB RAM, free-tier eligible shape"
  type        = string
  default     = "t3.small"
}

# Ubuntu 22.04 LTS (Jammy) — us-east-1 canonical AMI.
# To find the latest for your region:
#   aws ec2 describe-images --owners 099720109477 \
#     --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
#     --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text
variable "ubuntu_ami" {
  description = "Ubuntu 22.04 LTS AMI ID — verify this is current for your region before applying"
  type        = string
  default     = "ami-0c7217cdde317cfec" # us-east-1 as of mid-2024
}

variable "key_pair_name" {
  description = "Name of the existing EC2 key pair to attach (used by Ansible for SSH)"
  type        = string
}

# ── Storage ───────────────────────────────────────────────────────────────────

variable "root_volume_size" {
  description = "Root EBS volume size in GiB — 20 GiB covers OS + Docker images + Postgres data"
  type        = number
  default     = 20
}
