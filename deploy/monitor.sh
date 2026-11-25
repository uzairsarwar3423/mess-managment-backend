#!/usr/bin/env bash
# Lightweight health monitor for the VPS. Run from cron every 5 minutes (see docs/VPS_SETUP.md):
#   */5 * * * * /opt/mess-backend/monitor.sh >>/opt/mess-backend/.deploy/monitor.log 2>&1
#
# - api container missing/stopped -> `compose up -d` with the recorded image
# - api container unhealthy       -> restart it (Docker itself only restarts containers that EXIT)
# - warns on high disk / memory use, on container restarts, and when /health/ready fails
# Alerts go to syslog (`journalctl -t mess-monitor`) and, if ALERT_WEBHOOK_URL is set in
# monitor.env, to a Slack/Discord-compatible webhook.
set -euo pipefail
LOG_TAG=monitor
# shellcheck source=deploy/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# shellcheck disable=SC1091
[[ -f "$APP_DIR/monitor.env" ]] && source "$APP_DIR/monitor.env"

DISK_WARN_PCT="${DISK_WARN_PCT:-85}"
MEM_WARN_PCT="${MEM_WARN_PCT:-90}"

alert() {
  log "ALERT: $*"
  logger -t mess-monitor -p user.warning "$*" 2>/dev/null || true
  if [[ -n "${ALERT_WEBHOOK_URL:-}" ]] && command -v curl >/dev/null; then
    local msg; msg="[$(hostname)] mess-api: $*"
    curl -fsS -m 10 -H 'Content-Type: application/json' \
      -d "{\"text\":\"${msg//\"/\'}\",\"content\":\"${msg//\"/\'}\"}" "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
}

# Do not fight a deployment in progress.
exec 9>"$STATE_DIR/lock"
flock -n 9 || { log "deploy in progress, skipping"; exit 0; }

id="$(compose ps -aq "$SERVICE" 2>/dev/null || true)"
if [[ -z "$id" ]]; then
  img="$(state_get current_image)"
  if [[ -n "$img" ]]; then
    alert "api container missing; starting $img"
    start_image "$img" || alert "failed to start $img"
  fi
  exit 0
fi

state="$(docker inspect --format '{{.State.Status}}' "$id")"
health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")"
restarts="$(docker inspect --format '{{.RestartCount}}' "$id")"
last_restarts="$(state_get monitor_restarts)"
state_set monitor_restarts "$restarts"

if [[ "$state" != "running" ]]; then
  alert "api container is $state; starting it"
  compose up -d --no-build --pull never "$SERVICE" || alert "start failed"
elif [[ "$health" == "unhealthy" ]]; then
  alert "api container unhealthy; restarting"
  compose restart "$SERVICE" || alert "restart failed"
fi

if [[ -n "$last_restarts" && "$restarts" -gt "$last_restarts" ]]; then
  alert "api container restarted $((restarts - last_restarts)) time(s) since last check (check: docker compose logs api)"
fi

if command -v curl >/dev/null && [[ "$state" == "running" ]]; then
  curl -fsS -m 10 -o /dev/null "http://127.0.0.1:$(host_port)/health/ready" \
    || alert "/health/ready failing (Supabase unreachable or API down)"
fi

disk="$(df -P / | awk 'NR==2 {gsub("%",""); print $5}')"
[[ "$disk" -ge "$DISK_WARN_PCT" ]] && alert "disk usage ${disk}% (try: docker image prune -a --filter until=168h; journalctl --vacuum-size=200M)"

mem="$(awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {printf "%d", (t-a)*100/t}' /proc/meminfo)"
[[ "$mem" -ge "$MEM_WARN_PCT" ]] && alert "memory usage ${mem}%"

log "checked (state at start of run): state=$state health=${health:-n/a} restarts=$restarts disk=${disk}% mem=${mem}%"
