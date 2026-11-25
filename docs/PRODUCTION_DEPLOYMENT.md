# Production Deployment

Production: **https://mess.rapto.cloud** → Cloudflare → Nginx (VPS) → `127.0.0.1:8080` → container `mess-api-1`.
Database: Supabase (hosted). Files: Cloudinary. Nothing stateful runs on the VPS.

## Checklist for the first deployment

1. VPS prepared — [VPS_SETUP.md](VPS_SETUP.md) steps 1–7.
2. `/opt/mess-backend/.env.production` filled with **production** values, `TRUST_PROXY_HOPS=2` —
   [ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md).
3. Production Supabase database set up (all_in_one.sql once, first super admin) — `SETUP-SUPABASE.md`.
4. Optional: `migrate.env` + one-time **baseline** (below).
5. GitHub secrets/variables set — [CICD_PIPELINE.md](CICD_PIPELINE.md).
6. Commit and push to `main` (or Actions → Deploy → Run workflow).
7. Verify:
   ```bash
   curl -s https://mess.rapto.cloud/health/ready   # {"success":true,"data":{"status":"ready"}}
   curl -s https://mess.rapto.cloud/api/v1         # {"success":true,"data":{"name":"mess-api","version":"v1"}}
   ```

## How a deployment works

`deploy.sh <image>` on the VPS (run by GitHub Actions):

| Step | On failure |
|------|-----------|
| take the deploy lock (`flock`) | waits up to 5 min, then fails — nothing changed |
| preflight: docker, compose file, `.env.production` exists, `.env` holds no secrets | fails — nothing changed |
| `docker pull` new image (old container keeps serving) | fails — nothing changed |
| migrations (only if `migrate.env` exists), each in its own transaction | fails — app unchanged, failed migration fully rolled back |
| replace the container, wait for Docker health check (≤120 s) | auto-rollback to the previous image |
| verify `/health/ready` (Supabase reachable), host port, 10 s stability | auto-rollback to the previous image |
| record state + history, prune images older than the last 5 | — |

**Downtime:** one container is replaced in place, so there is a gap of a few seconds (old one drains
for up to 10 s, new one boots in ~2–5 s). A zero-downtime blue/green setup is possible but is not worth
its complexity for one instance that must also be the only one running cron jobs (`ENABLE_JOBS`).
Deploy outside meal times if that gap matters. Cloudflare returns a 502 during the gap; the apps retry.

## Database migrations

Migrations are the `.sql` files in `database/migrations/`, applied in file-name order by
`deploy/migrate.sh` (shipped to `/opt/mess-backend/`). History is stored in
`deploy_meta.schema_migrations` (not exposed through the Supabase API).

### Enable automatic migrations (optional)

```bash
ssh deploy@<VPS_IP>
cd /opt/mess-backend
cp /dev/null migrate.env && chmod 600 migrate.env && nano migrate.env   # see deploy/migrate.env.example
./migrate.sh status
```

**One-time baseline.** The production database was created with `database/all_in_one.sql`, which already
contains migrations up to `0010`. Record that, without running anything:

```bash
./migrate.sh baseline 0010_payment_transaction_id_optional
./migrate.sh status          # all "applied (baseline)", 0 pending
```

If you forget, `migrate.sh up` refuses ("database already has tables but no migration history") instead
of re-running `0002_core_tables.sql`.

From then on every deploy applies new migration files before switching the app. Without `migrate.env`,
deploys skip migrations and you apply new files in the Supabase SQL editor by hand, as before.

### Writing migrations

- New file, next number: `database/migrations/0011_<what>.sql`. Never edit an applied file.
- Must be **backward compatible** with the version currently running (expand → deploy → contract — see
  [ROLLBACK_GUIDE.md](ROLLBACK_GUIDE.md#database-migrations-are-not-rolled-back)).
- No `begin;`/`commit;` in the file (the runner wraps each file in a transaction), no
  `create index concurrently`.
- Also add it to `database/all_in_one.sql` (fresh setups) — CI's `tests/db` run all files on PGlite, and
  the *migrations* CI job runs them on Postgres 17.

## Day-to-day operations

```bash
cd /opt/mess-backend
docker compose ps                         # state + health
docker compose logs -f --tail 100 api     # JSON logs (pipe through `npx pino-pretty` locally to read)
docker compose logs api | grep '"level":50'   # errors only (pino level 50 = error, 60 = fatal)
docker stats --no-stream                  # CPU / memory
cat .deploy/history.log                   # deployments
tail .deploy/monitor.log                  # monitor runs
journalctl -t mess-monitor --since today  # alerts
docker compose restart api                # restart (same image, same env)
docker compose up -d --force-recreate --wait api   # after editing .env.production
```

## Monitoring (what exists and why)

| Concern | Mechanism |
|---------|-----------|
| Process crash | `restart: unless-stopped` (verified: `kill -9` → restarted, healthy) |
| Hung process | Docker HEALTHCHECK marks it unhealthy → `monitor.sh` (cron, 5 min) restarts it |
| Dependency outage | `monitor.sh` checks `/health/ready`; alert to syslog + optional webhook |
| Restart loops | `monitor.sh` alerts when the restart count rises |
| Disk / memory | `monitor.sh` alerts at 85 % disk / 90 % memory; Docker logs capped at 5×10 MB; image pruning keeps 5 |
| Container limits | 1 CPU, 512 MB memory, V8 heap 384 MB |
| Whole VPS / DNS / TLS down | external uptime monitor on `https://mess.rapto.cloud/health/ready` (UptimeRobot/Better Stack free tier) |
| Deploy result | GitHub Actions run + summary + email on failure; `history.log` |

No Prometheus/Grafana/ELK: for one container these cost more than they give.

## Test results

Executed on 2026-11-26 on Windows 10 + Docker Desktop 29.8 (Compose 5.5), plus a Debian Linux harness
(bash 5.2, util-linux flock, Compose 5.8) driving the same Docker daemon.

**Code baseline:** typecheck OK, build OK, 475/475 tests pass (DB tests must run serially:
`npx vitest run tests/db --no-file-parallelism`; in parallel, PGlite workers crash on Windows),
`npm audit` 0 vulnerabilities.

**Image:** see [DOCKER_SETUP.md](DOCKER_SETUP.md#verification-results-2026-11-26-docker-298--compose-55-on-windows) — 13/13 checks pass;
real Supabase + Cloudinary connected through the production compose file; crash recovery verified.

**Migration runner** (Postgres 16 container + Supabase stand-in):

| Test | Result |
|------|--------|
| Fresh DB: `up` applies 0001…0010 (9 files) | PASS |
| Second `up` | PASS — 0 applied |
| DB built from `all_in_one.sql`: `up` refuses | PASS |
| `baseline 0010…` then `status` | PASS — 9 baselined, 0 pending |
| New good migration applied; failing migration rolled back (no partial table), stays pending | PASS |

**Deploy scripts:** see [ROLLBACK_GUIDE.md](ROLLBACK_GUIDE.md#validated-local-simulation-2026-11-26) —
deploy, upgrade, auto-rollback (crash and not-ready), manual rollback, `.env` guard, secrets file untouched,
concurrent deploys serialized, real registry pull.

**Not executed yet (needs your VPS / GitHub):** the GitHub Actions run itself, GHCR push, SSH deploy to the
VPS, Nginx/TLS, public health check, Trivy/hadolint/shellcheck (they run in CI).
