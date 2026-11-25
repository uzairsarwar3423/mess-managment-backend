# Rollback Guide

## What is tracked

On the VPS, `/opt/mess-backend/.deploy/`:

| File | Content |
|------|---------|
| `current_image` | image running now, e.g. `ghcr.io/<owner>/<repo>:<sha>` |
| `previous_image` | the image before it — the default rollback target |
| `history.log` | every DEPLOYED / FAILED / AUTO-ROLLBACK / ROLLBACK with UTC time |

The last 5 app images stay on disk (`KEEP_IMAGES`), plus current and previous, so a rollback normally
needs no registry access. Every image also stays in GHCR under its commit SHA.

## Automatic rollback (during deploy)

`deploy.sh` rolls back by itself if the new container does not become healthy within 120 s, if
`/health/ready` does not answer 200 within ~60 s, or if the container restarts during the 10 s stability
window. The job then fails (red) and says `rolled back to <image> (healthy)`. Verified locally with a
crashing image and with an image that is alive but not ready.

## Manual rollback

**From GitHub** (no SSH needed): Actions → **Rollback** → Run workflow →
- `image_tag` empty → previous image
- `image_tag` = a commit SHA → that version (`git log --oneline` or `history.log`)

**On the server:**

```bash
ssh deploy@<VPS_IP>
cd /opt/mess-backend
tail -20 .deploy/history.log
./rollback.sh                                          # previous image
./rollback.sh ghcr.io/<owner>/<repo>:<commit-sha>      # specific version
```

If the image is not on disk and must be pulled, log in first (any GitHub token with `read:packages`):
`echo <TOKEN> | docker login ghcr.io -u <github-user> --password-stdin`, then `docker logout ghcr.io` after.

`rollback.sh` uses the same lock as deploys, verifies health the same way, and if the target is
unhealthy it restores the version that was running. It never changes `.env.production` and never
touches the database.

## Database migrations are NOT rolled back

Rolling back the app does not undo migrations. Hence the rule for every migration:

**Expand → deploy → contract.** A migration must work with both the old and the new app version:

| Safe in one deploy | Needs two deploys |
|--------------------|-------------------|
| add a table / nullable column / column with default | drop or rename a column/table |
| add an index (`create index concurrently` is not allowed inside the runner's transaction; plain `create index` locks writes briefly — fine for this app's size) | make a column `NOT NULL` that old code may leave empty |
| `create or replace function` with the same signature | change a function's signature/return type |
| relax a constraint (e.g. 0010: `transaction_id` nullable) | tighten a constraint |

For the "two deploys" changes: deploy 1 adds the new thing and the code stops using the old one;
deploy 2 (after deploy 1 is confirmed good) removes the old thing. Then a rollback of deploy 2's code is
always safe.

If a migration itself must be undone: write a **new** forward migration that reverses it (e.g.
`0012_revert_xyz.sql`) and deploy it. Never edit or delete an applied migration file (`migrate.sh status`
warns when an applied file changed).

**Backups:** Supabase takes daily backups (Pro plan: point-in-time recovery). Before a risky migration,
take a manual backup: Supabase Dashboard → Database → Backups, or
`pg_dump` via the session-pooler URL.

## Emergency: everything is broken

```bash
cd /opt/mess-backend
docker compose ps
docker compose logs --tail 200 api
cat .deploy/history.log
./rollback.sh ghcr.io/<owner>/<repo>:<last-known-good-sha>
# last resort: start a known image directly
sed -i 's|^API_IMAGE=.*|API_IMAGE=ghcr.io/<owner>/<repo>:<sha>|' .env && docker compose up -d --wait
```

Nothing in these steps can delete data: there are no volumes, and the database is Supabase.

## Validated (local simulation, 2026-11-26)

| Test | Result |
|------|--------|
| Deploy v1 → v2, previous image recorded | PASS |
| Deploy crashing image → auto-rollback to v2, job exit 1 | PASS |
| Deploy alive-but-not-ready image → readiness fails → auto-rollback | PASS |
| `rollback.sh` → v2 → v1, state swapped | PASS |
| Two deploys started at once → serialized by flock (Linux) | PASS |
| `.env.production` unchanged after all of the above (sha256) | PASS |
