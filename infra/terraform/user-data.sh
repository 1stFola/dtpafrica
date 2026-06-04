#!/bin/bash
# Minimal bootstrap — runs once at instance launch.
# Installs python3 so Ansible can connect immediately without waiting.
# All real provisioning is handled by the Ansible playbook.
set -euo pipefail

hostnamectl set-hostname dtp-server
apt-get update -qq
apt-get install -y -qq python3 python3-pip
