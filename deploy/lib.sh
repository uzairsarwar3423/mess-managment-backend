#!/usr/bin/env bash
# Shared helpers for deploy.sh / rollback.sh / monitor.sh. Sourced, not executed.
# shellcheck disable=SC2034

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
STATE_DIR="$APP_DIR/.deploy"
SECRETS_FILE="$APP_DIR/.env.production"   # production secrets: created by hand, NEVER written by these scripts
IMAGE_FILE="$APP_DIR/.env"                 # compose interpolation file: holds only API_IMAGE (+ optional API_HOST_PORT)
SERVICE="api"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"    # seconds for the container to become healthy
KEEP_IMAGES="${KEEP_IMAGES:-5}"            # old app images kept on disk for rollback

mkdir -p "$STATE_DIR"

log() { printf '%s [%s] %s\n' "$(date -u +%FT%TZ)" "${LOG_TAG:-deploy}" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

compose() { docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" "$@"; }

acquire_lock() {
  exec 9>"$STATE_DIR/lock"
  flock -w 300 9 || die "another deploy/rollback is still running (lock: $STATE_DIR/lock)"
}

preflight() {
  command -v docker >/dev/null || die "docker is not installed"
  docker compose version >/dev/null 2>&1 || die "docker compose plugin is not installed"
  [[ -f "$APP_DIR/docker-compose.yml" ]] || die "missing $APP_DIR/docker-compose.yml"
  [[ -f "$SECRETS_FILE" ]] || die "missing $SECRETS_FILE (create it by hand from .env.example; see docs/ENVIRONMENT_CONFIGURATION.md)"
  local perms; perms="$(stat -c '%a' "$SECRETS_FILE")"
  [[ "$perms" =~ ^[46]00$ ]] || log "WARNING: $SECRETS_FILE has mode $perms; run: chmod 600 $SECRETS_FILE"
  # .env is owned by these scripts. Refuse to touch it if someone put anything else in it,
  # so a secret typed there by mistake is never overwritten or lost.
  if [[ -f "$IMAGE_FILE" ]] && grep -vqE '^\s*(#.*)?$|^(API_IMAGE|API_HOST_PORT)=' "$IMAGE_FILE"; then
    die "$IMAGE_FILE contains variables other than API_IMAGE/API_HOST_PORT. Secrets belong in $SECRETS_FILE. Move them, then retry."
  fi
}

set_image() {
  local image="$1" tmp
  tmp="$(mktemp "$APP_DIR/.env.XXXXXX")"
  { [[ -f "$IMAGE_FILE" ]] && grep -E '^API_HOST_PORT=' "$IMAGE_FILE" || true; echo "API_IMAGE=$image"; } >"$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$IMAGE_FILE"
}

state_get() { [[ -f "$STATE_DIR/$1" ]] && cat "$STATE_DIR/$1" || true; }
state_set() { printf '%s\n' "$2" >"$STATE_DIR/$1.tmp" && mv "$STATE_DIR/$1.tmp" "$STATE_DIR/$1"; }

running_image() {
  local id; id="$(compose ps -q "$SERVICE" 2>/dev/null || true)"
  [[ -n "$id" ]] && docker inspect --format '{{.Config.Image}}' "$id" 2>/dev/null || true
}

host_port() { { grep -E '^API_HOST_PORT=' "$IMAGE_FILE" 2>/dev/null || true; } | cut -d= -f2 | grep . || echo 8080; }

# Start (or replace) the api container with $1 and wait for its Docker health check.
start_image() {
  local image="$1"
  set_image "$image"
  log "starting $image"
  compose up -d --no-build --pull never --remove-orphans --wait --wait-timeout "$HEALTH_TIMEOUT" "$SERVICE"
}

# Post-start verification: liveness + readiness (Supabase reachable) + host port mapping + stability.
verify() {
  log "verifying: /health/ready inside the container"
  compose exec -T "$SERVICE" node -e '
    const u = "http://127.0.0.1:8080/health/ready"; let n = 0, last = "";
    (async function t() {
      try { const r = await fetch(u); if (r.ok) process.exit(0); last = "HTTP " + r.status; } catch (e) { last = e.message; }
      if (++n >= 30) { console.error("readiness: " + last + " after " + n + " attempts"); process.exit(1); }
      setTimeout(t, 2000);
    })();' || { log "readiness check failed"; return 1; }

  if command -v curl >/dev/null; then
    log "verifying: http://127.0.0.1:$(host_port)/health from the host"
    curl -fsS --retry 5 --retry-delay 2 --retry-all-errors -o /dev/null "http://127.0.0.1:$(host_port)/health" \
      || { log "host port check failed"; return 1; }
  fi

  # A crash loop can pass one health probe; make sure the container stays up.
  local id; id="$(compose ps -q "$SERVICE")"
  local before; before="$(docker inspect --format '{{.RestartCount}}' "$id")"
  sleep "${STABILITY_SECONDS:-10}"
  local status after
  status="$(docker inspect --format '{{.State.Health.Status}}' "$id")"
  after="$(docker inspect --format '{{.RestartCount}}' "$id")"
  [[ "$status" == "healthy" && "$before" == "$after" ]] || { log "container unstable (health=$status restarts $before->$after)"; return 1; }
  log "verified healthy"
}

# Remove old app images beyond KEEP_IMAGES (never the current/previous one). Never touches volumes.
prune_images() {
  local repo="$1" keep_a="$2" keep_b="$3" n=0 ref
  while read -r ref; do
    [[ -z "$ref" || "$ref" == *"<none>"* ]] && continue
    n=$((n + 1))
    [[ "$ref" == "$keep_a" || "$ref" == "$keep_b" || $n -le $KEEP_IMAGES ]] && continue
    log "removing old image $ref"
    docker image rm "$ref" >/dev/null 2>&1 || true
  done < <(docker image ls "$repo" --format '{{.Repository}}:{{.Tag}}')
  docker image prune -f >/dev/null 2>&1 || true   # dangling layers only
}

record() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$STATE_DIR/history.log"; }
