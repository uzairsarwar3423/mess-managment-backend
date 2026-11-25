#!/usr/bin/env bash
# One-time, NON-DESTRUCTIVE VPS preparation for the Mess API (Ubuntu 22.04/24.04, Debian 12).
#
#   sudo bash bootstrap.sh [deploy-user]     (default user: deploy)
#
# Idempotent. It never removes packages, users, containers, volumes or existing config:
#   - installs Docker Engine + compose plugin from Docker's apt repo, only if docker is missing
#   - creates the deploy user (docker group) and /opt/mess-backend (owned by it)
#   - writes /etc/docker/daemon.json log rotation ONLY if that file does not exist yet
#   - installs nginx / certbot / curl only if missing
#   - ADDS ufw allow rules for SSH/80/443 but does NOT enable ufw (see docs/VPS_SETUP.md)
# SSH hardening is documented, not automated, so you cannot lock yourself out.
set -euo pipefail

DEPLOY_USER="${1:-deploy}"
APP_DIR=/opt/mess-backend

[[ $EUID -eq 0 ]] || { echo "run as root (sudo)"; exit 1; }
say() { printf '\n==> %s\n' "$*"; }

say "packages"
apt-get update -qq
for pkg in ca-certificates curl gnupg nginx certbot python3-certbot-nginx ufw; do
  dpkg -s "$pkg" >/dev/null 2>&1 || apt-get install -y -qq "$pkg"
done

if ! command -v docker >/dev/null; then
  say "installing Docker Engine"
  # shellcheck disable=SC1091  # exists on every target distro
  . /etc/os-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  say "docker already installed: $(docker --version)"
  docker compose version >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin
fi

if [[ ! -f /etc/docker/daemon.json ]]; then
  say "docker log rotation (new /etc/docker/daemon.json)"
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true
}
JSON
  systemctl restart docker
else
  say "/etc/docker/daemon.json exists - left unchanged (the compose file sets log rotation for the API anyway)"
fi
systemctl enable --now docker

say "deploy user: $DEPLOY_USER"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

say "app directory: $APP_DIR"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/.deploy"
if [[ ! -f "$APP_DIR/.env.production" ]]; then
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /dev/null "$APP_DIR/.env.production"
  echo "    created EMPTY $APP_DIR/.env.production (mode 600) - fill it in before the first deploy"
fi

say "firewall rules (added, not enabled)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw status | head -1

say "done. Next steps: docs/VPS_SETUP.md (SSH key, .env.production, Nginx + HTTPS, ufw enable, cron monitor)"
