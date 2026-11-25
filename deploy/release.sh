#!/usr/bin/env bash
# Runs ON THE VPS (GitHub Actions calls it after sending the new image):   /opt/mess-backend/release.sh mess-api:<commit>
# Starts the new image, waits until it is healthy, and if it is NOT healthy goes back to the old image by itself.
set -euo pipefail
cd /opt/mess-backend

NEW="$1"
OLD="$(grep -E '^IMAGE=' .env | cut -d= -f2- || true)"

set_image() {
  if grep -q '^IMAGE=' .env; then sed -i "s|^IMAGE=.*|IMAGE=$1|" .env; else echo "IMAGE=$1" >> .env; fi
}

wait_until_healthy() {
  for _ in $(seq 1 40); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' mess-api 2>/dev/null || echo none)" = "healthy" ] && return 0
    sleep 3
  done
  return 1
}

set_image "$NEW"
docker compose up -d --remove-orphans

if wait_until_healthy; then
  echo "OK: $NEW is running and healthy."
  docker image prune -af --filter "until=168h" >/dev/null || true   # delete images older than 7 days
  exit 0
fi

echo "FAILED: $NEW did not become healthy. Last log lines:"
docker logs --tail 60 mess-api || true
if [ -n "$OLD" ] && [ "$OLD" != "$NEW" ]; then
  echo "Going back to the previous version: $OLD"
  set_image "$OLD"
  docker compose up -d
fi
exit 1
