# Docker Setup

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build: `deps` → `build` (tsc) → `prod-deps` → `runtime`; plus `dev` for local hot reload |
| `.dockerignore` | Keeps secrets (`.env*`), `node_modules`, `dist`, `.git`, tests and docs out of the build context |
| `docker-compose.yml` | Local development (hot reload, uses your `.env`) |
| `deploy/docker-compose.prod.yml` | Production stack on the VPS |
| `deploy/ci/validate-image.sh` | Image checks used by CI (and locally) |

There is **no database or Redis container**: the app uses Supabase (hosted Postgres + Auth) over HTTPS
and Cloudinary for files. Nothing in the stack is stateful, so there are no volumes.

## Production image

- Base `node:22-alpine` (matches `.nvmrc`); final image ≈ 69 MB compressed / 282 MB on disk.
- Only production dependencies (`npm ci --omit=dev --ignore-scripts`) and compiled `dist/`.
- Runs as the non-root `node` user (uid 1000).
- `CMD ["node", "dist/server.js"]` — no npm/shell wrapper, so SIGTERM reaches the app, which stops cron
  jobs and drains connections (`src/server.ts`, 10 s limit). Compose adds `init: true` for zombie reaping.
- `HEALTHCHECK` calls `/health` (liveness, no DB call), so a Supabase blip never restarts the container.
  `/health/ready` (checks Supabase) is used by the deploy verification and monitoring instead.
- Layer caching: dependency layers are rebuilt only when `package.json`/`package-lock.json` change;
  source changes rebuild only the `build` stage (~10 s). npm's cache is a BuildKit cache mount.
- `GIT_SHA` build arg is stored as `APP_VERSION` env and an OCI label.

```bash
docker build --build-arg GIT_SHA=$(git rev-parse HEAD) -t mess-api:local .
bash deploy/ci/validate-image.sh mess-api:local
```

On Windows Git Bash prefix the second command with `MSYS_NO_PATHCONV=1`.

## Local development with Docker

```bash
cp .env.example .env        # dev Supabase/Cloudinary values
docker compose up --build   # http://localhost:8080/health
docker compose logs -f api
docker compose down
```

`src/` and `tests/` are mounted; `tsx watch` reloads on change (`CHOKIDAR_USEPOLLING` helps on
Windows/macOS). Plain `npm run dev` without Docker still works the same way.

## Running the production image locally (against your dev Supabase)

```bash
mkdir -p /tmp/mess-prodtest && cd /tmp/mess-prodtest
cp <repo>/deploy/docker-compose.prod.yml docker-compose.yml
grep -vE '^(NODE_ENV|ENABLE_JOBS)=' <repo>/.env > .env.production && echo ENABLE_JOBS=false >> .env.production
printf 'API_IMAGE=mess-api:local\nAPI_HOST_PORT=18090\n' > .env
docker compose up -d --wait
curl http://127.0.0.1:18090/health/ready
docker compose down
```

`ENABLE_JOBS=false` stops the test container from running cron jobs against a shared database.

## Verification results (2026-11-26, Docker 29.8 / Compose 5.5 on Windows)

| Check | Result |
|-------|--------|
| Image build (cold / warm cache) | OK / ~10 s |
| Non-root, no `.env`, no source/tests/devDependencies in image | PASS |
| Boots with `--read-only --cap-drop ALL --security-opt no-new-privileges` | PASS |
| Docker HEALTHCHECK → healthy | PASS |
| `/health` 200, `/api/v1` 200, protected route without token 401, unknown 404 | PASS |
| `/health/ready` → 503 with unreachable DB (dummy config) | PASS (as designed) |
| Real config: Supabase connected, Cloudinary connected, Mess found, `/health/ready` 200 | PASS |
| Logs are JSON (pino) | PASS |
| `docker stop` → SIGTERM handled, exit code 0 | PASS |
| `kill -9` of Node inside the container → auto-restart, healthy again | PASS |
| PostgreSQL data persistence | N/A — database is Supabase (hosted); no DB container or volume exists |

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Invalid environment configuration` then exit 1 | A variable is missing/invalid; the names are listed. Fix `.env.production`. |
| `unable to determine transport target for "pino-pretty"` | `NODE_ENV=development` in a production image. Use `production`. |
| Container `unhealthy`, logs fine | Something else holds the port inside? Check `docker inspect --format '{{json .State.Health}}' mess-api-1`. |
| `/health/ready` 503 | Supabase unreachable or wrong keys: `docker compose logs api \| grep -i supabase`. |
| Build hangs at `resolve image config` | Registry not reachable; retry, or check proxy/DNS of Docker Desktop. |
| Hot reload not picking up changes (Windows) | Restart `docker compose up`; polling is enabled but some editors write atomically. |
