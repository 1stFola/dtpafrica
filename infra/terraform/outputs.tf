output "app_public_ip" {
  description = "Elastic IP of the app instance — point your domain A record here"
  value       = aws_eip.app.public_ip
}

output "app_instance_id" {
  description = "EC2 instance ID of the app server"
  value       = aws_instance.app.id
}

output "db_private_ip" {
  description = "Private IP of the DB instance — used in DATABASE_URL on the app server"
  value       = aws_instance.db.private_ip
}

output "db_instance_id" {
  description = "EC2 instance ID of the DB server"
  value       = aws_instance.db.id
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

# ── Ansible inventory (write to file with terraform output -raw ansible_inventory) ──

output "ansible_inventory" {
  description = "Ready-to-use Ansible inventory — pipe to infra/ansible/inventory.ini"
  value       = <<-INI
    [app]
    ${aws_eip.app.public_ip} ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/${var.key_pair_name}.pem

    [db]
    ${aws_instance.db.private_ip} ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/${var.key_pair_name}.pem ansible_ssh_common_args='-o ProxyJump=ubuntu@${aws_eip.app.public_ip}'

    [all:vars]
    db_private_ip=${aws_instance.db.private_ip}
  INI
}
