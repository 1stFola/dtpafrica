#!/bin/bash
# Minimal bootstrap for the app instance.
# Ansible handles all real provisioning — this just ensures SSH is up fast
# and the instance is identifiable in logs.
set -euo pipefail

hostnamectl set-hostname dtp-app
apt-get update -qq
# python3 is required by Ansible; everything else is handled by the playbook
apt-get install -y -qq python3 python3-pip
