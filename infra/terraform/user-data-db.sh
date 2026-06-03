#!/bin/bash
# Minimal bootstrap for the DB instance.
# Ansible handles all real provisioning.
set -euo pipefail

hostnamectl set-hostname dtp-db
apt-get update -qq
apt-get install -y -qq python3 python3-pip
