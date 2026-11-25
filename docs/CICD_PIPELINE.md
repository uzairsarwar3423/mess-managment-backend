# CI/CD Pipeline (GitHub Actions)

```
 PR / push (non-main)          push to main (or "Run workflow")
        │                                │
        ▼                                ▼
   ci.yml ────────────────────► deploy.yml
   ├─ test         (typecheck, 475 tests, build)      job: ci       (calls ci.yml — all must pass)
   ├─ audit        (npm audit, prod deps, high+)      job: publish  (build runtime image, push to GHCR
   ├─ infra-lint   (hadolint, shellcheck, compose)                    ghcr.io/<owner>/<repo>:<commit-sha> + :main)
   ├─ migrations   (runner on real Postgres 17)       job: deploy   (SSH -> VPS deploy.sh, verify,
   └─ docker       (build, validate-image.sh, Trivy)                  public health check, summary)

 rollback.yml — manual: Actions > Rollback > Run workflow (empty = previous image, or a commit SHA)
```

## Workflows

### `ci.yml`
Triggers: every pull request, pushes to any branch except `main`, and `workflow_call` (from deploy).

| Job | What it checks |
|-----|----------------|
| **test** | `npm ci` (lockfile-exact, integrity hashes), `npm audit signatures` (registry signatures), `npm run typecheck` (strict tsc — the project's lint gate; there is no ESLint config), unit + integration tests, PGlite database tests (serially — they run real migrations in WASM Postgres and are memory hungry), `npm run build` |
| **audit** | `npm audit --omit=dev --audit-level=high` |
| **infra-lint** | hadolint on `Dockerfile`, shellcheck on `deploy/**/*.sh`, `docker compose config` on both compose files |
| **migrations** | Runs `deploy/migrate.sh up` on a Postgres 17 service with a Supabase stand-in (`database/ci/supabase_prelude.sql`), then again to prove it is a no-op |
| **docker** | Builds the `runtime` target (GitHub Actions layer cache), runs `deploy/ci/validate-image.sh` (non-root, no `.env`, no source/devDeps, boots read-only with dropped capabilities, endpoints, graceful SIGTERM), Trivy scan — fixable HIGH/CRITICAL fail the build |

### `deploy.yml`
Triggers: push to `main`, manual run. `ci` must pass before anything is built or deployed.

1. **publish** — builds the image once and pushes `ghcr.io/<owner>/<repo>:<full-commit-sha>` (immutable,
   used for deploy/rollback) and `:main` (convenience). Uses the job's `GITHUB_TOKEN` (`packages: write`).
2. **deploy** — environment `production`, `concurrency: production` (never two at once, never cancelled
   midway):
   - writes the SSH key and **pinned host key** (`StrictHostKeyChecking yes`);
   - uploads only `docker-compose.yml`, `*.sh` and `migrations/` — **never env files**;
   - logs the VPS into GHCR with the job's short-lived token (stdin, not argv) and logs out afterwards;
   - runs `deploy.sh <image>` (pull → migrations → replace → verify → auto-rollback on failure);
   - checks `https://mess.rapto.cloud/health/ready` from the internet;
   - writes a job summary with the server's deploy history.

### `rollback.yml`
Manual. Same SSH/registry handling, runs `rollback.sh [ghcr.io/...:<sha>]`, then the public health check.

## One-time GitHub configuration

**Settings → Secrets and variables → Actions → Secrets**

| Secret | Value |
|--------|-------|
| `VPS_HOST` | VPS IP or SSH hostname (the real IP, not `mess.rapto.cloud`, which is behind Cloudflare and does not pass SSH) |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | private key from [VPS_SETUP.md](VPS_SETUP.md) step 2 (whole file incl. BEGIN/END lines) |
| `VPS_KNOWN_HOSTS` | output of `ssh-keyscan -p <port> <VPS_IP>` |

**Variables**

| Variable | Value |
|----------|-------|
| `PRODUCTION_URL` | `https://mess.rapto.cloud` |
| `VPS_PORT` | only if SSH is not on 22 |
| `DEPLOY_PATH` | only if not `/opt/mess-backend` |

**Settings → Environments → New environment `production`** (created automatically on first run; create it
yourself to add protection rules, e.g. *Required reviewers* for manual approval, or *Deployment branches:
main only*).

**Branch protection (recommended):** Settings → Branches → `main` → require a pull request and the
status checks *Typecheck, test, build*, *Dependency vulnerabilities*, *Lint Dockerfile, shell scripts,
compose*, *Migration runner on real Postgres*, *Docker image build + validation*.

**GHCR:** no extra token. After the first publish the package is private and linked to the repo; the
deploy job's token can pull it. Keep it private.

## Secrets hygiene

- Secrets are only passed through `env:` and written to files with `printf`; no `set -x`, nothing echoed.
- `VPS_HOST`/`VPS_USER` are secrets so GitHub masks them in logs.
- The registry token reaches the server over SSH stdin and is removed with `docker logout`.
- No third-party SSH actions — plain OpenSSH, fewer supply-chain dependencies.

## Visibility

- **Actions tab**: each run, with the deployment summary (image, commit, last 5 history lines, container status).
- **Environments → production**: deployment history with the URL.
- Failed workflow runs email the person who pushed (GitHub default notifications).
- Server side: `/opt/mess-backend/.deploy/history.log`.

## Validation status

| Item | Status |
|------|--------|
| Image build, validate-image.sh (13 checks), deploy/rollback/migrate scripts | Executed locally — all pass (see [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md#test-results)) |
| Workflow YAML on GitHub, GHCR push, SSH deploy, Trivy, hadolint, shellcheck | **Not yet run** — happens on the first push; requires the secrets above and a prepared VPS |

## Troubleshooting

| Failure | Fix |
|---------|-----|
| `Host key verification failed` | `VPS_KNOWN_HOSTS` missing/outdated: re-run `ssh-keyscan`. |
| `Permission denied (publickey)` | Public key not in `~deploy/.ssh/authorized_keys`, or wrong `VPS_USER`. |
| `denied: permission_denied` on pull | Package not linked to the repo: Packages → package settings → *Manage Actions access* → add this repo (read). |
| `missing .env.production` | Create it on the VPS ([ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md)). |
| `another deploy/rollback is still running` | A deploy holds the lock; wait. Stale lock is impossible (flock is released when the process exits). |
| Trivy fails | A fixable CVE in the base image or a dependency: rebuild (newer `node:22-alpine`) or `npm update <pkg>`. |
| `npm audit` fails | `npm audit --omit=dev`, then update the package. |
| Deploy says "rolled back" | The new image failed health/readiness. See the logs printed in the job; fix and push again. |
