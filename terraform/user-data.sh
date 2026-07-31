#!/bin/bash
set -euo pipefail

dnf install -y docker rsync git
systemctl enable --now docker
usermod -aG docker ec2-user

# docker compose v2 CLI plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /home/ec2-user/resolve
chown -R ec2-user:ec2-user /home/ec2-user/resolve
