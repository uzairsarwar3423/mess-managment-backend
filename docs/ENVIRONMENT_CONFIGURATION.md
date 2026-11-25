# Environment & Secrets

## Principle

| Where | File | Who writes it | In git? |
|-------|------|---------------|---------|
| Your machine | `.env` (copy of `.env.example`) | you | **no** (`.gitignore`) |
| VPS | `/opt/mess-backend/.env.production` | you, by hand | **no**, never leaves the server |
| VPS | `/opt/mess-backend/migrate.env` (optional) | you, by hand | no |
| VPS | `/opt/mess-backend/.env` (`API_IMAGE=` only) | `deploy.sh` | no |
| GitHub | Actions secrets (SSH key, host) | you | encrypted by GitHub |

- **CI/CD never reads, writes or replaces `.env.production`.** The deploy job uploads only
  `docker-compose.yml`, the `*.sh` scripts and `migrations/` (see `.github/workflows/deploy.yml`,
  step "Upload deployment files").
- `deploy.sh` refuses to run if `/opt/mess-backend/.env` contains anything besides
  `API_IMAGE`/`API_HOST_PORT`, so a secret typed there by mistake is never overwritten.
- Secrets are never baked into images: `.dockerignore` excludes `.env*`, and CI checks the built image
  for `.env` files (`deploy/ci/validate-image.sh`).
- The app validates every variable at startup with zod (`src/config/env.ts`) and exits with a list of
  the bad variable **names** (never values) if anything is missing or invalid:
  ```
  Invalid environment configuration:
    - SUPABASE_URL: Invalid URL
    - QR_SIGNING_SECRET: QR_SIGNING_SECRET must be at least 32 characters
  ```
  In production this shows in `docker compose logs api`, and the deploy fails health checks and rolls back.

## Variables

| Variable | Required | Production value / notes |
|----------|----------|--------------------------|
| `NODE_ENV` | – | Forced to `production` by the compose file. **Never `development` in the image**: it loads `pino-pretty`, which is not installed there. |
| `PORT` | – | Forced to `8080` inside the container. Host port: `API_HOST_PORT` in `/opt/mess-backend/.env` (default 8080). |
| `LOG_LEVEL` | – | `info` (`debug` temporarily for troubleshooting). |
| `APP_TIMEZONE` | – | `Asia/Karachi`; cron schedules use it. |
| `TRUST_PROXY_HOPS` | yes (prod) | **`2`** for mess.rapto.cloud (Cloudflare + Nginx). `1` if Cloudflare proxy is turned off. `0` locally. Wrong value = rate limits see a proxy IP instead of the user's. |
| `CORS_ORIGINS` | – | Empty (native apps only) unless a browser app needs access. |
| `ENABLE_JOBS` | – | `true` — exactly one production instance runs the cron jobs. Set `false` on any extra/test instance. |
| `DEFAULT_MESS_ID` | – | Optional; found automatically when there is one mess. |
| `SUPABASE_URL` | yes | Production project URL. |
| `SUPABASE_ANON_KEY` | yes | Production anon/publishable key. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Secret.** Bypasses RLS. |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | yes | `_API_SECRET` is **secret**. |
| `CLOUDINARY_PRESET_PAYMENTS` / `_PROFILES` | – | Optional presets. |
| `CLOUDINARY_ROOT_FOLDER` | – | `mess-prod` (keeps prod uploads apart from `mess-dev`). |
| `UPLOAD_MAX_BYTES` | – | Default 2 MB. |
| `QR_SIGNING_SECRET` | yes | **Secret**, ≥ 32 chars. Changing it invalidates every printed QR code. |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | – | Defaults 60000 / 100. |
| `EXPO_ACCESS_TOKEN` | – | Optional. |

Generate a QR secret: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## Creating `.env.production` on the VPS

```bash
ssh deploy@<VPS_IP>
cd /opt/mess-backend
umask 077
nano .env.production          # paste the variables above with PRODUCTION values
chmod 600 .env.production
```

Use **separate** Supabase and Cloudinary projects (or at least separate keys/folders) for dev and prod.

## Changing a secret

Edit the file, then recreate the container (same image, new env):

```bash
cd /opt/mess-backend && nano .env.production
docker compose up -d --force-recreate --wait api
curl -s http://127.0.0.1:8080/health/ready
```

No CI run is needed and the next deploy keeps your change.

## `migrate.env` (optional)

libpq variables for the migration runner (`deploy/migrate.env.example`). Use Supabase's **Session
pooler** connection (IPv4, port 5432) — not the transaction pooler (6543). The password appears only as
an environment variable inside a short-lived container, never on a command line.

## Local development

```bash
cp .env.example .env     # Windows: copy .env.example .env
# fill in DEV values
npm run dev              # or: docker compose up --build
```

## If a secret leaks

1. Rotate it at the provider (Supabase → API keys; Cloudinary → API keys; new QR secret).
2. Update `.env.production`, recreate the container (above).
3. If it was committed to git: rotating is mandatory; rewriting history is not enough.
