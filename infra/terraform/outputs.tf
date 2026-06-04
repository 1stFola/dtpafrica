# ── Primary outputs ───────────────────────────────────────────────────────────

output "server_public_ip" {
  description = "Static Elastic IP — point your domain A record here"
  value       = aws_eip.server.public_ip
}

output "server_instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.server.id
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "ssh_command" {
  description = "Ready-to-run SSH command for the server"
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ubuntu@${aws_eip.server.public_ip}"
}

output "app_url" {
  description = "Public URL of the deployed application"
  value       = "http://${aws_eip.server.public_ip}"
}

output "health_check_url" {
  description = "API health check URL"
  value       = "http://${aws_eip.server.public_ip}/api/v1/health"
}

# ── Ansible inventory ─────────────────────────────────────────────────────────
# Generate the file with:
#   terraform output -raw ansible_inventory > ../ansible/inventory.ini

output "ansible_inventory" {
  description = "Ansible inventory contents — pipe to infra/ansible/inventory.ini"
  value       = <<-INI
    [server]
    ${aws_eip.server.public_ip} ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/${var.key_pair_name}.pem ansible_ssh_common_args='-o StrictHostKeyChecking=no'

    [all:vars]
    server_public_ip=${aws_eip.server.public_ip}
  INI
}
