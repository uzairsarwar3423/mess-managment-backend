import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { citext } from '@electric-sql/pglite/contrib/citext';

/**
 * Real PostgreSQL (PGlite, in-process WASM) with a minimal stand-in for Supabase's `auth` schema and
 * roles, running the project's REAL migration files. Lets us test constraints, triggers, SQL
 * functions and RLS without a Supabase project.
 */
const SUPABASE_PRELUDE = `
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
`;

const DB_DIR = join(__dirname, '..', '..', 'database');

export async function createDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { btree_gist, citext } });
  await db.exec(SUPABASE_PRELUDE);
  const files = readdirSync(join(DB_DIR, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(DB_DIR, 'migrations', file), 'utf8'));
  }
  await db.exec(readFileSync(join(DB_DIR, 'seed', '0007_seed_default_mess.sql'), 'utf8'));
  return db;
}

let counter = 0;
const next = (): number => ++counter;

type Row = Record<string, unknown>;
const one = async <T = Row>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> =>
  (await db.query<T>(sql, params)).rows[0] as T;

export async function messId(db: PGlite): Promise<string> {
  return (await one<{ id: string }>(db, "select id from messes where code = 'main'")).id;
}

export async function newMess(db: PGlite): Promise<string> {
  const n = next();
  const { id } = await one<{ id: string }>(db, 'insert into messes (name, code) values ($1, $2) returning id', [`Mess ${n}`, `mess-${n}`]);
  await db.query('insert into mess_settings (mess_id) values ($1)', [id]);
  return id;
}

export async function newAuthUser(db: PGlite): Promise<string> {
  const { id } = await one<{ id: string }>(db, 'insert into auth.users (email) values ($1) returning id', [`u${next()}@example.com`]);
  return id;
}

export async function newStudent(db: PGlite, mess: string, opts: { active?: boolean } = {}): Promise<string> {
  const id = await newAuthUser(db);
  await db.query('insert into students (id, mess_id, email, full_name, is_active) values ($1, $2, $3, $4, $5)', [
    id, mess, `student${next()}@example.com`, `Student ${counter}`, opts.active ?? true,
  ]);
  return id;
}

export async function newAdmin(
  db: PGlite,
  mess: string,
  opts: { role?: 'admin' | 'super_admin'; active?: boolean } = {},
): Promise<string> {
  const id = await newAuthUser(db);
  await db.query('insert into admins (id, mess_id, email, full_name, role, is_active) values ($1, $2, $3, $4, $5, $6)', [
    id, mess, `admin${next()}@example.com`, `Admin ${counter}`, opts.role ?? 'admin', opts.active ?? true,
  ]);
  return id;
}

export async function newAccount(db: PGlite, mess: string, method = 'jazzcash'): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    `insert into payment_accounts (mess_id, method, account_title, account_number, bank_name)
     values ($1, $2, 'Main Mess', '03111234567', $3) returning id`,
    [mess, method, method === 'bank' ? 'Meezan Bank' : null],
  );
  return id;
}

export interface PaymentInput {
  mess: string;
  student: string;
  account: string;
  tid?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewer?: string;
  reason?: string;
}

/** Inserts a payment directly (bypassing the API). Approved/rejected need a reviewer. */
export async function newPayment(db: PGlite, p: PaymentInput): Promise<string> {
  const status = p.status ?? 'pending';
  const reviewed = status === 'approved' || status === 'rejected';
  const { id } = await one<{ id: string }>(
    db,
    `insert into payments
       (mess_id, student_id, payment_account_id, method, paid_to, amount, transaction_id,
        screenshot_public_id, screenshot_url, status, rejection_reason, reviewed_by, reviewed_at)
     values ($1, $2, $3, 'jazzcash', '{"account_title":"Main Mess"}'::jsonb, 8500, $4,
             $5, 'https://res.cloudinary.com/x', $6, $7, $8, $9)
     returning id`,
    [
      p.mess, p.student, p.account, p.tid ?? `TID${String(next()).padStart(8, '0')}`,
      `mess-dev/payments/${p.student}/${next()}`, status,
      status === 'rejected' ? (p.reason ?? 'Amount does not match') : null,
      reviewed ? p.reviewer : null, reviewed ? new Date() : null,
    ],
  );
  return id;
}

/**
 * A subscription with explicit dates. It needs a payment row (payment_id is NOT NULL UNIQUE); a
 * `cancelled` dummy payment never collides with the one-pending / unique-TID rules.
 */
export async function newSubscription(
  db: PGlite,
  s: { mess: string; student: string; account: string; start: string; end: string; status?: string },
): Promise<string> {
  const payment = await newPayment(db, { mess: s.mess, student: s.student, account: s.account, status: 'cancelled' });
  const status = s.status ?? 'active';
  const { id } = await one<{ id: string }>(
    db,
    `insert into subscriptions (mess_id, student_id, payment_id, start_date, end_date, status, amount, cancelled_at)
     values ($1, $2, $3, $4::date, $5::date, $6, 8500, $7) returning id`,
    [s.mess, s.student, payment, s.start, s.end, status, status === 'cancelled' ? new Date() : null],
  );
  return id;
}

export async function newQrCode(db: PGlite, mess: string, admin: string, label = `Table ${next()}`): Promise<string> {
  const { id } = await one<{ id: string }>(
    db, 'insert into qr_codes (mess_id, label, created_by) values ($1, $2, $3) returning id', [mess, label, admin],
  );
  return id;
}

/** Business "today" exactly as the SQL functions compute it. */
export async function today(db: PGlite, tz = 'Asia/Karachi'): Promise<string> {
  return (await one<{ d: string }>(db, `select (now() at time zone $1)::date::text as d`, [tz])).d;
}

export async function dateOffset(db: PGlite, base: string, days: number): Promise<string> {
  return (await one<{ d: string }>(db, `select ($1::date + $2::int)::text as d`, [base, days])).d;
}

export { one };
