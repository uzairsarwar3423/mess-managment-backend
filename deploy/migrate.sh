#!/usr/bin/env bash
# Tracked SQL migration runner for the Supabase Postgres database.
#
#   migrate.sh status                 list applied / pending migrations
#   migrate.sh up                     apply pending migrations, each in its own transaction
#   migrate.sh baseline <version>     record every migration <= <version> as applied WITHOUT running it
#                                     (one time, for a database built from database/all_in_one.sql)
#
# Connection: libpq PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE) read from
# $MIGRATE_ENV_FILE (default: migrate.env next to this script). They are passed to the container as
# environment variables, so no password ever appears on a command line or in `ps` output.
#
# psql runs in a throwaway postgres:17-alpine container, so the VPS needs only Docker.
# History lives in deploy_meta.schema_migrations (a schema the Supabase REST API does not expose).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$SCRIPT_DIR/migrations}"
MIGRATE_ENV_FILE="${MIGRATE_ENV_FILE:-$SCRIPT_DIR/migrate.env}"
PSQL_IMAGE="${PSQL_IMAGE:-postgres:17-alpine}"
DOCKER_NETWORK="${MIGRATE_DOCKER_NETWORK:-}"

log() { printf '[migrate] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

[[ -d "$MIGRATIONS_DIR" ]] || die "migrations directory not found: $MIGRATIONS_DIR"
[[ -f "$MIGRATE_ENV_FILE" ]] || die "connection file not found: $MIGRATE_ENV_FILE (see docs/ENVIRONMENT_CONFIGURATION.md)"

psql_run() {
  # Extra args go to psql; SQL may be piped on stdin.
  local net=()
  [[ -n "$DOCKER_NETWORK" ]] && net=(--network "$DOCKER_NETWORK")
  docker run --rm -i "${net[@]}" --env-file "$MIGRATE_ENV_FILE" \
    -e PGAPPNAME=mess-migrate -e PGCONNECT_TIMEOUT=15 -e 'PGOPTIONS=-c client_min_messages=warning' \
    "$PSQL_IMAGE" psql -X -q -v ON_ERROR_STOP=1 "$@"
}

ensure_meta() {
  psql_run <<'SQL'
create schema if not exists deploy_meta;
create table if not exists deploy_meta.schema_migrations (
  version     text primary key,
  checksum    text not null,
  applied_at  timestamptz not null default now(),
  applied_by  text not null default current_user,
  baselined   boolean not null default false
);
revoke all on schema deploy_meta from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema deploy_meta from anon, authenticated';
  end if;
end $$;
SQL
}

migration_files() { find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -printf '%f\n' | sort; }
version_of() { basename "$1" .sql; }
checksum_of() { sha256sum "$MIGRATIONS_DIR/$1" | cut -d' ' -f1; }
applied_versions() { psql_run -At -c 'select version from deploy_meta.schema_migrations order by version'; }

cmd_status() {
  ensure_meta
  local applied; applied="$(psql_run -At -F '|' -c 'select version, checksum, baselined from deploy_meta.schema_migrations')"
  local pending=0 f v line sum
  while read -r f; do
    v="$(version_of "$f")"
    line="$(grep -E "^${v}\|" <<<"$applied" || true)"
    if [[ -z "$line" ]]; then
      printf '  pending   %s\n' "$v"; pending=$((pending + 1))
    else
      sum="$(cut -d'|' -f2 <<<"$line")"
      if [[ "$sum" != "$(checksum_of "$f")" ]]; then
        printf '  applied   %s  (WARNING: file changed since it was applied)\n' "$v"
      else
        printf '  applied   %s%s\n' "$v" "$([[ "$(cut -d'|' -f3 <<<"$line")" == t ]] && echo '  (baseline)')"
      fi
    fi
  done < <(migration_files)
  log "$pending pending"
}

cmd_up() {
  ensure_meta
  local applied; applied="$(applied_versions)"
  if [[ -z "$applied" ]]; then
    # Safety net: a database that already has the schema but no history was built with all_in_one.sql.
    # Running 0002 against it would fail half-way at best. Make the operator baseline it explicitly.
    local has_schema; has_schema="$(psql_run -At -c "select to_regclass('public.messes') is not null")"
    [[ "$has_schema" == "t" ]] && die "database already has tables but no migration history. Run: migrate.sh baseline <last version already applied>"
  fi
  local count=0 f v sum
  while read -r f; do
    v="$(version_of "$f")"
    grep -qxF "$v" <<<"$applied" && continue
    sum="$(checksum_of "$f")"
    log "applying $v"
    {
      printf 'begin;\n'
      printf "do \$l\$ begin perform pg_advisory_xact_lock(hashtext('mess-migrations')); end \$l\$;\n"
      printf "do \$m\$ begin if exists (select 1 from deploy_meta.schema_migrations where version = '%s') then raise exception 'migration %s was applied concurrently'; end if; end \$m\$;\n" "$v" "$v"
      cat "$MIGRATIONS_DIR/$f"
      printf "\n;insert into deploy_meta.schema_migrations (version, checksum) values ('%s', '%s');\n" "$v" "$sum"
      printf 'commit;\n'
    } | psql_run || die "migration $v failed and was rolled back; nothing after it was applied"
    count=$((count + 1))
  done < <(migration_files)
  log "done: $count migration(s) applied"
}

cmd_baseline() {
  local target="${1:-}"
  [[ -n "$target" ]] || die "usage: migrate.sh baseline <version>  (e.g. 0010_payment_transaction_id_optional)"
  migration_files | sed 's/\.sql$//' | grep -qxF "$target" || die "unknown migration version: $target"
  ensure_meta
  local f v sql=''
  while read -r f; do
    v="$(version_of "$f")"
    [[ "$v" > "$target" ]] && break
    sql+="insert into deploy_meta.schema_migrations (version, checksum, baselined) values ('$v', '$(checksum_of "$f")', true) on conflict (version) do nothing;"$'\n'
  done < <(migration_files)
  printf 'begin;\n%scommit;\n' "$sql" | psql_run
  log "baselined up to $target"
}

case "${1:-}" in
  status)   cmd_status ;;
  up)       cmd_up ;;
  baseline) shift; cmd_baseline "$@" ;;
  *) echo "usage: $0 status | up | baseline <version>" >&2; exit 2 ;;
esac
