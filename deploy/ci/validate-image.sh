#!/usr/bin/env bash
# shellcheck disable=SC2015  # `check && pass || fail` is intended: pass() only prints and always succeeds
# Validates a built API image the way production runs it. Used by CI and for local checks:
#   bash deploy/ci/validate-image.sh mess-api:local
# Uses dummy configuration only (no real Supabase/Cloudinary needed).
set -euo pipefail
IMAGE="${1:?usage: validate-image.sh <image>}"
NAME="mess-api-validate-$$"
PORT="${VALIDATE_PORT:-18080}"
pass() { printf '  PASS  %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; docker logs "$NAME" 2>&1 | tail -40 || true; docker rm -f "$NAME" >/dev/null 2>&1 || true; exit 1; }
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

echo "== static checks"
uid="$(docker run --rm --entrypoint id "$IMAGE" -u)"
[[ "$uid" != 0 ]] && pass "runs as non-root (uid $uid)" || fail "image runs as root"

listing="$(docker run --rm --entrypoint sh "$IMAGE" -c 'ls -A /app; ls /app/node_modules')"
grep -qE '^\.env' <<<"$listing" && fail ".env file found in image" || pass "no .env files in /app"
grep -qxE 'src|tests|\.git' <<<"$listing" && fail "source/tests/.git copied into image" || pass "no source, tests or .git in image"
grep -qxE 'typescript|vitest|tsx|pino-pretty' <<<"$listing" && fail "devDependencies present" || pass "no devDependencies"

pm="$(docker run --rm --entrypoint sh "$IMAGE" -c 'ls /usr/local/lib/node_modules 2>/dev/null; command -v npm npx yarn corepack' || true)"
[[ -z "$pm" ]] && pass "no package managers (npm/npx/yarn/corepack) in runtime image" || fail "package managers present: $pm"

size="$(docker image inspect "$IMAGE" --format '{{.Size}}')"
pass "image size $((size / 1024 / 1024)) MB"

echo "== runtime checks (production hardening flags, dummy env)"
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  -e NODE_ENV=production -e ENABLE_JOBS=false -e LOG_LEVEL=info \
  -e SUPABASE_URL=https://example.supabase.co -e SUPABASE_ANON_KEY=dummy -e SUPABASE_SERVICE_ROLE_KEY=dummy \
  -e CLOUDINARY_CLOUD_NAME=dummy -e CLOUDINARY_API_KEY=dummy -e CLOUDINARY_API_SECRET=dummy \
  -e QR_SIGNING_SECRET=ci-dummy-secret-ci-dummy-secret-ci-dummy-secret \
  "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$NAME")"
  [[ "$status" == healthy ]] && break
  [[ "$(docker inspect --format '{{.State.Running}}' "$NAME")" == true ]] || fail "container exited"
  sleep 2
done
[[ "$status" == healthy ]] && pass "Docker HEALTHCHECK healthy" || fail "health status: $status"

code() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$1"; }
[[ "$(code /health)" == 200 ]] && pass "GET /health -> 200" || fail "/health"
[[ "$(code /api/v1)" == 200 ]] && pass "GET /api/v1 -> 200" || fail "/api/v1"
[[ "$(code /api/v1/admin/me)" == 401 ]] && pass "GET /api/v1/admin/me without token -> 401" || fail "auth guard"
[[ "$(code /nope)" == 404 ]] && pass "unknown route -> 404" || fail "404 handler"
[[ "$(code /health/ready)" == 503 ]] && pass "GET /health/ready -> 503 with unreachable DB (as designed)" || fail "/health/ready should be 503 with dummy Supabase"
docker logs "$NAME" 2>&1 | head -1 | grep -q '^{' && pass "logs are JSON (pino, production mode)" || fail "logs not JSON"

echo "== graceful shutdown"
start=$(date +%s)
docker stop -t 15 "$NAME" >/dev/null
took=$(( $(date +%s) - start ))
exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$NAME")"
docker logs "$NAME" 2>&1 | grep -q '"signal":"SIGTERM"' && pass "SIGTERM reached the app" || fail "app did not log SIGTERM"
[[ "$exit_code" == 0 ]] && pass "exit code 0 after ${took}s" || fail "exit code $exit_code after ${took}s"
echo "image OK: $IMAGE"
