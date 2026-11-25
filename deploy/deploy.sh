#!/usr/bin/env bash
# Deploy a new API image on the VPS.
#
#   ./deploy.sh ghcr.io/<owner>/<repo>:<git-sha>
#
# Order (the old container keeps serving until step 4):
#   1. pull the new image             -> failure: nothing changed
#   2. run pending DB migrations      -> failure: nothing changed (each migration is transactional)
#      (only if migrate.env exists; migrations must be backward compatible with the running image)
#   3. record the currently running image as the rollback target
#   4. replace the container, wait for its health check, verify readiness + stability
#   5. failure -> automatic rollback to the previous image, exit 1
#
# Never writes .env.production, never removes volumes or database data.
set -euo pipefail
LOG_TAG=deploy
# shellcheck source=deploy/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

NEW_IMAGE="${1:-}"
[[ "$NEW_IMAGE" =~ ^[a-z0-9./_:-]+:[A-Za-z0-9._-]+$ ]] || die "usage: deploy.sh <registry/repo:tag>"

acquire_lock
preflight

PREV_IMAGE="$(running_image)"
[[ -z "$PREV_IMAGE" ]] && PREV_IMAGE="$(state_get current_image)"
log "current: ${PREV_IMAGE:-<none>}  ->  new: $NEW_IMAGE"

if [[ "${SKIP_PULL:-0}" != 1 ]]; then
  log "pulling $NEW_IMAGE"
  docker pull --quiet "$NEW_IMAGE" >/dev/null || die "pull failed; nothing changed"
fi

if [[ -f "$APP_DIR/migrate.env" ]]; then
  log "running database migrations"
  "$APP_DIR/migrate.sh" up || die "migrations failed; the running app was NOT changed"
else
  log "migrate.env not present: skipping database migrations"
fi

if start_image "$NEW_IMAGE" && verify; then
  if [[ -n "$PREV_IMAGE" && "$PREV_IMAGE" != "$NEW_IMAGE" ]]; then state_set previous_image "$PREV_IMAGE"; fi
  state_set current_image "$NEW_IMAGE"
  record "DEPLOYED $NEW_IMAGE (previous: ${PREV_IMAGE:-none})"
  prune_images "${NEW_IMAGE%:*}" "$NEW_IMAGE" "$(state_get previous_image)"
  log "deployment successful: $NEW_IMAGE"
  exit 0
fi

log "deployment of $NEW_IMAGE FAILED"
compose logs --no-color --tail 80 "$SERVICE" >&2 || true
record "FAILED $NEW_IMAGE"

if [[ -n "$PREV_IMAGE" && "$PREV_IMAGE" != "$NEW_IMAGE" ]]; then
  log "rolling back to $PREV_IMAGE"
  if start_image "$PREV_IMAGE" && verify; then
    record "AUTO-ROLLBACK to $PREV_IMAGE"
    die "deployment failed; rolled back to $PREV_IMAGE (healthy)"
  fi
  record "AUTO-ROLLBACK to $PREV_IMAGE FAILED"
  die "deployment failed AND rollback to $PREV_IMAGE failed - manual action needed (docs/ROLLBACK_GUIDE.md)"
fi
die "deployment failed and there is no previous image to roll back to"
