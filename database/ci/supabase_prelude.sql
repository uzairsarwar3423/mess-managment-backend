-- Minimal stand-in for what Supabase provides before our migrations run (roles + auth schema).
-- Used ONLY by CI / local migration-runner tests on a plain Postgres. Never run this on Supabase.
-- Keep in sync with SUPABASE_PRELUDE in tests/helpers/db.ts.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to authenticated;
grant select on auth.users to authenticated;
