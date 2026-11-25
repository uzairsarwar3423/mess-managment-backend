import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { expect, it } from 'vitest';

/** The single file a human pastes into the Supabase SQL editor must run cleanly on an empty database. */
it('database/all_in_one.sql runs on an empty database and returns the mess id', async () => {
  const db = new PGlite({ extensions: { btree_gist, citext } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  const results = await db.exec(readFileSync(join(__dirname, '..', '..', 'database', 'all_in_one.sql'), 'utf8'));
  const last = results.at(-1)!;
  expect(last.fields[0]!.name).toBe('COPY_THIS_INTO_DEFAULT_MESS_ID');
  expect(String(last.rows[0]!['COPY_THIS_INTO_DEFAULT_MESS_ID'])).toMatch(/^[0-9a-f-]{36}$/);

  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
  );
  expect(rows[0]!.n).toBe(12);
  await db.close();
}, 120_000);
