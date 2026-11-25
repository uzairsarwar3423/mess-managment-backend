#!/usr/bin/env bash
# Roll the API back to an earlier image.
#
#   ./rollback.sh                 -> previous image (from .deploy/previous_image)
#   ./rollback.sh <image:tag>     -> a specific image (see .deploy/history.log or `docker image ls`)
#
# Database migrations are NOT reverted (see docs/ROLLBACK_GUIDE.md). Never touches .env.production.
set -euo pipefail
LOG_TAG=rollback
# shellcheck source=deploy/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

acquire_lock
preflight

CURRENT="$(running_image)"
[[ -z "$CURRENT" ]] && CURRENT="$(state_get current_image)"
TARGET="${1:-$(state_get previous_image)}"
[[ -n "$TARGET" ]] || die "no previous image recorded; pass one explicitly: rollback.sh <image:tag>"
[[ "$TARGET" != "$CURRENT" ]] || die "$TARGET is already running"

if ! docker image inspect "$TARGET" >/dev/null 2>&1; then
  log "$TARGET not on disk, pulling"
  docker pull --quiet "$TARGET" >/dev/null || die "cannot pull $TARGET (registry login needed? see docs/ROLLBACK_GUIDE.md)"
fi

log "rolling back: ${CURRENT:-<none>} -> $TARGET"
if start_image "$TARGET" && verify; then
  state_set current_image "$TARGET"
  [[ -n "$CURRENT" ]] && state_set previous_image "$CURRENT"
  record "ROLLBACK to $TARGET (from ${CURRENT:-none})"
  log "rollback successful: $TARGET"
  exit 0
fi

record "ROLLBACK to $TARGET FAILED"
if [[ -n "$CURRENT" ]]; then
  log "rollback target unhealthy; restoring $CURRENT"
  start_image "$CURRENT" && verify && die "rollback failed; $CURRENT restored and healthy"
fi
die "rollback failed - manual action needed (docs/ROLLBACK_GUIDE.md)"
