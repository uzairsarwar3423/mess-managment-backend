import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb, dateOffset, messId, newAccount, newAdmin, newMess, newPayment, newQrCode, newStudent, newSubscription, one, today,
} from '../helpers/db';

/**
 * These tests run the project's real SQL migrations on a real PostgreSQL (PGlite) and check that the
 * database itself enforces the business rules: they must hold even if application code has a bug.
 */
let db: PGlite;
let mess: string;
let account: string;
let admin: string;
let t: string; // business "today" in the mess time zone

beforeAll(async () => {
  db = await createDb();
  mess = await messId(db);
  account = await newAccount(db, mess);
  admin = await newAdmin(db, mess);
  t = await today(db);
}, 120_000);
afterAll(async () => db.close());

const rejectsWith = (p: Promise<unknown>, text: string | RegExp) =>
  expect(p).rejects.toThrow(typeof text === 'string' ? new RegExp(text) : text);

describe('migrations', () => {
  it('create every table, with row level security enabled on all of them', async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual([
      'admins', 'attendance', 'audit_logs', 'mess_settings', 'messes', 'notifications',
      'payment_accounts', 'payments', 'push_tokens', 'qr_codes', 'students', 'subscriptions',
    ]);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it('the seed creates the mess with the agreed defaults', async () => {
    const s = await one<Record<string, unknown>>(
      db,
      `select monthly_fee::text, subscription_days, lunch_start::text, lunch_end::text, dinner_start::text,
              dinner_end::text, geofence_enabled, geofence_radius_m, expiry_reminder_days
         from mess_settings where mess_id = $1`, [mess],
    );
    expect(s).toEqual({
      monthly_fee: '8500.00', subscription_days: 30, lunch_start: '10:00:00', lunch_end: '16:00:00',
      dinner_start: '16:45:00', dinner_end: '20:45:00', geofence_enabled: false, geofence_radius_m: 150, expiry_reminder_days: 3,
    });
  });

  it('students get a generated human-friendly code', async () => {
    const id = await newStudent(db, mess);
    const { student_code } = await one<{ student_code: string }>(db, 'select student_code from students where id = $1', [id]);
    expect(student_code).toMatch(/^S\d{5}$/);
  });
});

describe('mess_settings checks', () => {
  it('rejects overlapping meal windows and inverted windows', async () => {
    const m = await newMess(db);
    await rejectsWith(db.query("update mess_settings set lunch_end = '17:00' where mess_id = $1", [m]), 'ck_settings_no_overlap');
    await rejectsWith(db.query("update mess_settings set dinner_end = '16:00' where mess_id = $1", [m]), 'ck_settings_dinner_window');
    await rejectsWith(db.query("update mess_settings set lunch_start = '17:00' where mess_id = $1", [m]), 'ck_settings_lunch_window');
  });

  it('the geofence cannot be enabled without coordinates', async () => {
    const m = await newMess(db);
    await rejectsWith(db.query('update mess_settings set geofence_enabled = true where mess_id = $1', [m]), 'ck_settings_geofence');
    await db.query('update mess_settings set geofence_enabled = true, latitude = 31.52, longitude = 74.35 where mess_id = $1', [m]);
  });

  it('rejects a non-positive fee and out-of-range values', async () => {
    const m = await newMess(db);
    await rejectsWith(db.query('update mess_settings set monthly_fee = 0 where mess_id = $1', [m]), /monthly_fee/);
    await rejectsWith(db.query('update mess_settings set geofence_radius_m = 5 where mess_id = $1', [m]), /geofence_radius_m/);
  });
});

describe('payments', () => {
  it('BR-08: only one pending payment per student; a new one is fine after cancelling', async () => {
    const s = await newStudent(db, mess);
    const first = await newPayment(db, { mess, student: s, account });
    await rejectsWith(newPayment(db, { mess, student: s, account }), 'uq_payments_one_pending_per_student');
    await db.query("update payments set status = 'cancelled' where id = $1", [first]);
    await newPayment(db, { mess, student: s, account });
  });

  it('BR-10: a transaction id is unique per account (case-insensitive) while pending/approved', async () => {
    const a = await newStudent(db, mess);
    const b = await newStudent(db, mess);
    await newPayment(db, { mess, student: a, account, tid: 'AbC123456' });
    await rejectsWith(newPayment(db, { mess, student: b, account, tid: 'abc123456' }), 'uq_payments_transaction');

    // another receiving account: fine
    const other = await newAccount(db, mess, 'easypaisa');
    await newPayment(db, { mess, student: b, account: other, tid: 'abc123456' });
  });

  it('a rejected payment frees its transaction id', async () => {
    const a = await newStudent(db, mess);
    const b = await newStudent(db, mess);
    await newPayment(db, { mess, student: a, account, tid: 'REJECT0001', status: 'rejected', reviewer: admin });
    await newPayment(db, { mess, student: b, account, tid: 'REJECT0001' });
  });

  it('BR-18/consistency: a rejection needs a reason, and verdicts need a reviewer', async () => {
    const s = await newStudent(db, mess);
    await rejectsWith(
      db.query(
        `insert into payments (mess_id, student_id, payment_account_id, method, paid_to, amount, transaction_id,
           screenshot_public_id, screenshot_url, status, reviewed_by, reviewed_at)
         values ($1, $2, $3, 'jazzcash', '{}', 8500, 'NOREASON01', 'x/y/z', 'u', 'rejected', $4, now())`,
        [mess, s, account, admin],
      ),
      'ck_payments_rejection_reason',
    );
    await rejectsWith(
      db.query(
        `insert into payments (mess_id, student_id, payment_account_id, method, paid_to, amount, transaction_id,
           screenshot_public_id, screenshot_url, status)
         values ($1, $2, $3, 'jazzcash', '{}', 8500, 'NOREVIEW01', 'x/y/z', 'u', 'approved')`,
        [mess, s, account],
      ),
      'ck_payments_review_fields',
    );
  });

  it('validates method, transaction id format and amount', async () => {
    const s = await newStudent(db, mess);
    const bad = (extra: string) =>
      db.query(
        `insert into payments (mess_id, student_id, payment_account_id, method, paid_to, amount, transaction_id,
           screenshot_public_id, screenshot_url) values ($1, $2, $3, ${extra})`,
        [mess, s, account],
      );
    await rejectsWith(bad(`'paypal', '{}', 8500, 'ABCDEF123', 'p', 'u'`), 'ck_payments_method');
    await rejectsWith(bad(`'jazzcash', '{}', 8500, 'bad id!', 'p', 'u'`), 'ck_payments_txn');
    await rejectsWith(bad(`'jazzcash', '{}', 0, 'ABCDEF123', 'p', 'u'`), /amount/);
  });

  it('a payment account is never deleted while payments reference it (RESTRICT)', async () => {
    const acc = await newAccount(db, mess, 'nayapay');
    const s = await newStudent(db, mess);
    await newPayment(db, { mess, student: s, account: acc });
    await rejectsWith(db.query('delete from payment_accounts where id = $1', [acc]), /foreign key|violates/);
  });

  it('bank accounts must name the bank; unknown methods are refused', async () => {
    await rejectsWith(
      db.query("insert into payment_accounts (mess_id, method, account_title, account_number) values ($1, 'bank', 'Main Mess', 'PK36MEZN0000')", [mess]),
      'ck_payment_accounts_bank',
    );
    await rejectsWith(
      db.query("insert into payment_accounts (mess_id, method, account_title, account_number) values ($1, 'cash', 'Main Mess', '12345678')", [mess]),
      'ck_payment_accounts_method',
    );
    for (const method of ['easypaisa', 'jazzcash', 'nayapay', 'sadapay']) await newAccount(db, mess, method);
  });
});

describe('subscriptions', () => {
  it('no overlapping active/scheduled periods for one student (exclusion constraint)', async () => {
    const s = await newStudent(db, mess);
    const d = (n: number) => dateOffset(db, t, n);
    await newSubscription(db, { mess, student: s, account, start: await d(0), end: await d(29) });
    await rejectsWith(
      newSubscription(db, { mess, student: s, account, start: await d(20), end: await d(49), status: 'scheduled' }),
      'ex_subscriptions_no_overlap',
    );
    // back-to-back is fine (renewal), and overlap with expired/cancelled rows is allowed
    await newSubscription(db, { mess, student: s, account, start: await d(30), end: await d(59), status: 'scheduled' });
    await newSubscription(db, { mess, student: s, account, start: await d(0), end: await d(29), status: 'cancelled' });
    await newSubscription(db, { mess, student: s, account, start: await d(5), end: await d(10), status: 'expired' });
  });

  it('a different student may cover the same dates', async () => {
    const a = await newStudent(db, mess);
    const b = await newStudent(db, mess);
    const range = { start: await dateOffset(db, t, 0), end: await dateOffset(db, t, 29) };
    await newSubscription(db, { mess, student: a, account, ...range });
    await newSubscription(db, { mess, student: b, account, ...range });
  });

  it('end date cannot precede start date; a payment backs at most one subscription', async () => {
    const s = await newStudent(db, mess);
    await rejectsWith(
      newSubscription(db, { mess, student: s, account, start: await dateOffset(db, t, 5), end: await dateOffset(db, t, 1) }),
      'ck_subscriptions_dates',
    );
    const sub = await newSubscription(db, { mess, student: s, account, start: await dateOffset(db, t, 0), end: await dateOffset(db, t, 29) });
    const { payment_id } = await one<{ payment_id: string }>(db, 'select payment_id from subscriptions where id = $1', [sub]);
    await rejectsWith(
      db.query(
        `insert into subscriptions (mess_id, student_id, payment_id, start_date, end_date, status, amount)
         values ($1, $2, $3, $4::date, $5::date, 'expired', 8500)`,
        [mess, s, payment_id, await dateOffset(db, t, -90), await dateOffset(db, t, -61)],
      ),
      /subscriptions_payment_id_key|unique/,
    );
  });
});

describe('approve_payment() (BR-05, BR-11, BR-12, BR-19)', () => {
  const approve = (payment: string, by: string) =>
    one<Record<string, unknown>>(db, `select id, status, start_date::text, end_date::text, amount::text, payment_id from approve_payment($1, $2)`, [payment, by]);

  it('first approval: 30 days starting today, payment approved, audit row written', async () => {
    const s = await newStudent(db, mess);
    const p = await newPayment(db, { mess, student: s, account, tid: 'APPROVE0001' });
    const sub = await approve(p, admin);

    expect(sub).toMatchObject({
      status: 'active', start_date: t, end_date: await dateOffset(db, t, 29), amount: '8500.00', payment_id: p,
    });
    const pay = await one<Record<string, unknown>>(db, 'select status, reviewed_by from payments where id = $1', [p]);
    expect(pay).toEqual({ status: 'approved', reviewed_by: admin });

    const audit = await one<Record<string, unknown>>(
      db, "select action, actor_id, actor_role, entity_id, metadata->>'subscription_id' as sub from audit_logs where entity_id = $1", [p],
    );
    expect(audit).toMatchObject({ action: 'payment.approve', actor_id: admin, actor_role: 'admin', sub: sub.id });
  });

  it('renewal during an active period is scheduled for the day after it ends (no gap, no overlap)', async () => {
    const s = await newStudent(db, mess);
    const first = await newPayment(db, { mess, student: s, account });
    const a = await approve(first, admin);
    const second = await newPayment(db, { mess, student: s, account });
    const b = await approve(second, admin);

    expect(b.status).toBe('scheduled');
    expect(b.start_date).toBe(await dateOffset(db, a.end_date as string, 1));
    expect(b.end_date).toBe(await dateOffset(db, a.end_date as string, 30));

    // a third renewal chains after the scheduled one
    const third = await newPayment(db, { mess, student: s, account });
    const c = await approve(third, admin);
    expect(c.start_date).toBe(await dateOffset(db, b.end_date as string, 1));
  });

  it('after the previous period ended, the new one starts today', async () => {
    const s = await newStudent(db, mess);
    await newSubscription(db, { mess, student: s, account, start: await dateOffset(db, t, -40), end: await dateOffset(db, t, -3), status: 'expired' });
    const p = await newPayment(db, { mess, student: s, account });
    const sub = await approve(p, admin);
    expect(sub).toMatchObject({ status: 'active', start_date: t });
  });

  it('refuses a payment that is not pending (double approval, rejected, cancelled)', async () => {
    const s = await newStudent(db, mess);
    const p = await newPayment(db, { mess, student: s, account });
    await approve(p, admin);
    await rejectsWith(approve(p, admin), 'PAYMENT_NOT_PENDING');

    const rejected = await newPayment(db, { mess, student: await newStudent(db, mess), account, status: 'rejected', reviewer: admin });
    await rejectsWith(approve(rejected, admin), 'PAYMENT_NOT_PENDING');
    const cancelled = await newPayment(db, { mess, student: await newStudent(db, mess), account, status: 'cancelled' });
    await rejectsWith(approve(cancelled, admin), 'PAYMENT_NOT_PENDING');
  });

  it('only an active admin of the same mess may approve', async () => {
    const s = await newStudent(db, mess);
    const p = await newPayment(db, { mess, student: s, account });
    const disabled = await newAdmin(db, mess, { active: false });
    const otherMess = await newMess(db);
    const outsider = await newAdmin(db, otherMess);

    await rejectsWith(approve(p, disabled), 'ADMIN_NOT_AUTHORIZED');
    await rejectsWith(approve(p, outsider), 'ADMIN_NOT_AUTHORIZED');
    await rejectsWith(approve(p, s), 'ADMIN_NOT_AUTHORIZED'); // a student id is not an admin
    const still = await one<{ status: string }>(db, 'select status from payments where id = $1', [p]);
    expect(still.status).toBe('pending'); // nothing changed
    expect((await db.query('select 1 from subscriptions where payment_id = $1', [p])).rows).toHaveLength(0);
  });

  it('unknown payment id', async () => {
    await rejectsWith(approve('00000000-0000-4000-8000-000000000000', admin), 'PAYMENT_NOT_FOUND');
  });

  it('the subscription uses the amount snapshot of the payment, not the current fee', async () => {
    const s = await newStudent(db, mess);
    const p = await newPayment(db, { mess, student: s, account });
    await db.query('update payments set amount = 7000 where id = $1', [p]);
    expect((await approve(p, admin)).amount).toBe('7000.00');
  });

  it('only the backend (service_role) may execute it', async () => {
    const { rows } = await db.query<{ role: string; ok: boolean }>(
      `select r as role, has_function_privilege(r, 'approve_payment(uuid, uuid)', 'execute') as ok
         from unnest(array['anon', 'authenticated', 'service_role']) r`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.role, r.ok]))).toEqual({ anon: false, authenticated: false, service_role: true });
  });
});

describe('attendance (BR-03, BR-04, BR-06)', () => {
  async function enrolled() {
    const student = await newStudent(db, mess);
    const sub = await newSubscription(db, { mess, student, account, start: await dateOffset(db, t, -5), end: await dateOffset(db, t, 24) });
    const qr = await newQrCode(db, mess, admin);
    return { student, sub, qr };
  }
  const mark = (e: { student: string; sub: string; qr: string }, meal: string, date = t) =>
    db.query(
      `insert into attendance (mess_id, student_id, subscription_id, qr_code_id, meal_type, attendance_date, source)
       values ($1, $2, $3, $4, $5, $6::date, 'qr')`,
      [mess, e.student, e.sub, e.qr, meal, date],
    );

  it('BR-06: the same student cannot have two Lunches (or two Dinners) on one date', async () => {
    const e = await enrolled();
    await mark(e, 'lunch');
    await rejectsWith(mark(e, 'lunch'), 'uq_attendance_student_date_meal');
    await mark(e, 'dinner'); // BR-02: a different meal is fine
    await rejectsWith(mark(e, 'dinner'), 'uq_attendance_student_date_meal');
    await mark(e, 'lunch', await dateOffset(db, t, -1)); // another day is fine
  });

  it('two simultaneous inserts: exactly one wins', async () => {
    const e = await enrolled();
    const results = await Promise.allSettled([mark(e, 'lunch'), mark(e, 'lunch'), mark(e, 'lunch')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const { n } = await one<{ n: number }>(db, 'select count(*)::int as n from attendance where student_id = $1', [e.student]);
    expect(n).toBe(1);
  });

  it('BR-04 at database level: the subscription must belong to the student and cover the date', async () => {
    const e = await enrolled();
    const other = await newStudent(db, mess);
    await rejectsWith(mark({ ...e, student: other }, 'lunch'), 'ATTENDANCE_NOT_COVERED_BY_SUBSCRIPTION');
    await rejectsWith(mark(e, 'lunch', await dateOffset(db, t, 25)), 'ATTENDANCE_NOT_COVERED_BY_SUBSCRIPTION'); // after end
    await rejectsWith(mark(e, 'lunch', await dateOffset(db, t, -6)), 'ATTENDANCE_NOT_COVERED_BY_SUBSCRIPTION'); // before start

    const cancelled = await newSubscription(db, {
      mess, student: other, account, start: await dateOffset(db, t, -5), end: await dateOffset(db, t, 24), status: 'cancelled',
    });
    await rejectsWith(mark({ student: other, sub: cancelled, qr: e.qr }, 'lunch'), 'ATTENDANCE_NOT_COVERED_BY_SUBSCRIPTION');
  });

  it('boundaries are inclusive: first and last day of the subscription are allowed', async () => {
    const e = await enrolled();
    await mark(e, 'lunch', await dateOffset(db, t, -5));
    await mark(e, 'lunch', await dateOffset(db, t, 24));
  });

  it('meal type, source consistency and history preservation', async () => {
    const e = await enrolled();
    await rejectsWith(mark(e, 'brunch'), 'ck_attendance_meal');
    // a QR scan needs its code; a manual entry needs its author
    await rejectsWith(
      db.query(`insert into attendance (mess_id, student_id, subscription_id, meal_type, attendance_date, source)
                values ($1, $2, $3, 'lunch', $4::date, 'qr')`, [mess, e.student, e.sub, t]),
      'ck_attendance_source_fields',
    );
    await rejectsWith(
      db.query(`insert into attendance (mess_id, student_id, subscription_id, meal_type, attendance_date, source)
                values ($1, $2, $3, 'lunch', $4::date, 'manual')`, [mess, e.student, e.sub, t]),
      'ck_attendance_source_fields',
    );
    await mark(e, 'lunch');
    // history is protected: students and subscriptions with attendance cannot be deleted
    await rejectsWith(db.query('delete from students where id = $1', [e.student]), /foreign key|violates/);
    await rejectsWith(db.query('delete from subscriptions where id = $1', [e.sub]), /foreign key|violates/);
    await rejectsWith(db.query('delete from qr_codes where id = $1', [e.qr]), /foreign key|violates/);
  });

  it('marked_at is set by the database clock', async () => {
    const e = await enrolled();
    await mark(e, 'lunch');
    const { drift } = await one<{ drift: number }>(
      db, 'select abs(extract(epoch from (now() - marked_at)))::float as drift from attendance where student_id = $1', [e.student],
    );
    expect(drift).toBeLessThan(5);
  });
});

describe('qr_codes', () => {
  it('active labels are unique (case-insensitive) per mess; revoking frees the label', async () => {
    const m = await newMess(db);
    const a = await newAdmin(db, m);
    const id = await newQrCode(db, m, a, 'Table 1');
    await rejectsWith(newQrCode(db, m, a, 'table 1'), 'uq_qr_label_active');
    await newQrCode(db, await newMess(db), await newAdmin(db, await newMess(db)), 'Table 1'); // another mess is fine

    await db.query("update qr_codes set status = 'revoked', revoked_at = now(), revoked_by = $2, revoke_reason = 'Leaked' where id = $1", [id, a]);
    await newQrCode(db, m, a, 'Table 1');
  });

  it('a revoked code must carry who/when/why; an active one must not', async () => {
    const a = await newAdmin(db, mess);
    const id = await newQrCode(db, mess, a);
    await rejectsWith(db.query("update qr_codes set status = 'revoked' where id = $1", [id]), 'ck_qr_revoked');
    await rejectsWith(db.query("update qr_codes set revoked_at = now() where id = $1", [id]), 'ck_qr_revoked');
  });
});

describe('subscription status job', () => {
  it('refresh_subscription_statuses expires finished periods and activates scheduled ones that started', async () => {
    const m = await newMess(db);
    const acc = await newAccount(db, m);
    const s = await newStudent(db, m);
    const ended = await newSubscription(db, { mess: m, student: s, account: acc, start: await dateOffset(db, t, -40), end: await dateOffset(db, t, -10) });
    const started = await newSubscription(db, { mess: m, student: s, account: acc, start: await dateOffset(db, t, -2), end: await dateOffset(db, t, 27), status: 'scheduled' });
    const future = await newSubscription(db, { mess: m, student: s, account: acc, start: await dateOffset(db, t, 28), end: await dateOffset(db, t, 57), status: 'scheduled' });
    const lastDay = await newSubscription(db, { mess: m, student: await newStudent(db, m), account: acc, start: await dateOffset(db, t, -29), end: t });

    const { n } = await one<{ n: number }>(db, 'select refresh_subscription_statuses() as n');
    expect(n).toBeGreaterThanOrEqual(2);

    const status = async (id: string) => (await one<{ status: string }>(db, 'select status from subscriptions where id = $1', [id])).status;
    expect(await status(ended)).toBe('expired');
    expect(await status(started)).toBe('active');
    expect(await status(future)).toBe('scheduled');
    expect(await status(lastDay)).toBe('active'); // end date inclusive (BR-13)
  });
});

describe('audit_logs', () => {
  it('is append-only: update and delete are refused', async () => {
    await db.query("insert into audit_logs (action, metadata) values ('test.event', '{}')");
    await rejectsWith(db.query("update audit_logs set action = 'x' where action = 'test.event'"), 'append-only');
    await rejectsWith(db.query("delete from audit_logs where action = 'test.event'"), 'append-only');
  });
});

describe('read functions used by the API', () => {
  it('eligible_attendance_status lists active students with coverage and whether they marked', async () => {
    const m = await newMess(db);
    const acc = await newAccount(db, m);
    const a = await newAdmin(db, m);
    const qr = await newQrCode(db, m, a);
    const covered = (s: string) => newSubscription(db, { mess: m, student: s, account: acc, start: t, end: t });

    const marked = await newStudent(db, m);
    const notMarked = await newStudent(db, m);
    const noSub = await newStudent(db, m);
    const disabled = await newStudent(db, m, { active: false });
    const markedSub = await covered(marked);
    await covered(notMarked);
    await covered(disabled);
    void noSub;
    await db.query(
      `insert into attendance (mess_id, student_id, subscription_id, qr_code_id, meal_type, attendance_date)
       values ($1, $2, $3, $4, 'lunch', $5::date)`, [m, marked, markedSub, qr, t],
    );

    const lunch = (await db.query<{ student_id: string; marked: boolean }>('select student_id, marked from eligible_attendance_status($1, $2::date, $3)', [m, t, 'lunch'])).rows;
    expect(lunch.map((r) => r.student_id).sort()).toEqual([marked, notMarked].sort()); // no subscription / disabled: excluded
    expect(Object.fromEntries(lunch.map((r) => [r.student_id, r.marked]))).toEqual({ [marked]: true, [notMarked]: false });

    const dinner = (await db.query<{ marked: boolean }>('select marked from eligible_attendance_status($1, $2::date, $3)', [m, t, 'dinner'])).rows;
    expect(dinner.every((r) => !r.marked)).toBe(true);
  });

  it('monthly_attendance_marks gives totals and the day-by-day marks', async () => {
    const m = await newMess(db);
    const acc = await newAccount(db, m);
    const a = await newAdmin(db, m);
    const qr = await newQrCode(db, m, a);
    const s = await newStudent(db, m);
    const idle = await newStudent(db, m); // covered by a subscription, never attended
    const cancelledOnly = await newStudent(db, m);
    const sub = await newSubscription(db, { mess: m, student: s, account: acc, start: '2026-03-01', end: '2026-03-30', status: 'expired' });
    await newSubscription(db, { mess: m, student: idle, account: acc, start: '2026-03-05', end: '2026-04-03', status: 'expired' });
    await newSubscription(db, { mess: m, student: cancelledOnly, account: acc, start: '2026-03-01', end: '2026-03-30', status: 'cancelled' });

    const mark = (date: string, meal: string) =>
      db.query(
        `insert into attendance (mess_id, student_id, subscription_id, qr_code_id, meal_type, attendance_date)
         values ($1, $2, $3, $4, $5, $6::date)`, [m, s, sub, qr, meal, date],
      );
    await mark('2026-03-01', 'lunch');
    await mark('2026-03-01', 'dinner');
    await mark('2026-03-02', 'lunch');
    await mark('2026-03-05', 'dinner');

    const rows = (await db.query<Record<string, unknown>>(
      'select student_id, lunch_count, dinner_count, total_count, marks from monthly_attendance_marks($1, $2::date)', [m, '2026-03-01'],
    )).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.student_id as string, r]));

    expect(byId[s]).toMatchObject({ lunch_count: 2, dinner_count: 2, total_count: 4, marks: { '01': 'LD', '02': 'L', '05': 'D' } });
    expect(byId[idle]).toMatchObject({ lunch_count: 0, dinner_count: 0, total_count: 0, marks: {} }); // appears with zeros
    expect(byId[cancelledOnly]).toBeUndefined(); // cancelled coverage and no attendance: not listed

    // a month with no activity lists nobody who has no coverage in it
    const may = (await db.query('select * from monthly_attendance_marks($1, $2::date)', [m, '2026-05-01'])).rows;
    expect(may).toHaveLength(0);
  });

  it('qr_scan_stats counts scans per code', async () => {
    const m = await newMess(db);
    const acc = await newAccount(db, m);
    const a = await newAdmin(db, m);
    const busy = await newQrCode(db, m, a, 'Busy');
    const quiet = await newQrCode(db, m, a, 'Quiet');
    const s = await newStudent(db, m);
    const sub = await newSubscription(db, { mess: m, student: s, account: acc, start: await dateOffset(db, t, -2), end: await dateOffset(db, t, 27) });
    for (const [date, meal] of [[t, 'lunch'], [t, 'dinner'], [await dateOffset(db, t, -1), 'lunch']]) {
      await db.query(
        `insert into attendance (mess_id, student_id, subscription_id, qr_code_id, meal_type, attendance_date)
         values ($1, $2, $3, $4, $5, $6::date)`, [m, s, sub, busy, meal, date],
      );
    }
    const rows = (await db.query<{ qr_code_id: string; scans_today: number; scans_total: number; last_scan_at: unknown }>(
      'select * from qr_scan_stats($1, $2::date)', [m, t],
    )).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.qr_code_id, r]));
    expect(byId[busy]).toMatchObject({ scans_today: 2, scans_total: 3 });
    expect(byId[busy]?.last_scan_at).toBeTruthy();
    expect(byId[quiet]).toMatchObject({ scans_today: 0, scans_total: 0, last_scan_at: null });
  });

  it('report_monthly_attendance and report_overview run and add up', async () => {
    const m = await newMess(db);
    const acc = await newAccount(db, m);
    const a = await newAdmin(db, m);
    const s = await newStudent(db, m);
    const p = await newPayment(db, { mess: m, student: s, account: acc });
    await db.query('select approve_payment($1, $2)', [p, a]);

    const month = `${t.slice(0, 7)}-01`;
    const overview = (await one<{ o: Record<string, unknown> }>(db, 'select report_overview($1, $2::date) as o', [m, month])).o;
    expect(overview).toMatchObject({ month: t.slice(0, 7), payments_approved: 1, payments_rejected: 0, lunch_total: 0, dinner_total: 0 });
    expect(Number(overview.revenue)).toBe(8500);
    expect(overview.daily).toEqual([]);

    const report = (await db.query('select * from report_monthly_attendance($1, $2::date)', [m, month])).rows;
    expect(report).toHaveLength(1); // the student with a subscription overlapping the month
  });
});

describe('row level security (defence in depth)', () => {
  async function asUser<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
    await db.exec('begin');
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await db.exec('set local role authenticated');
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec('rollback');
    }
  }

  it('a student sees only their own rows and cannot write anything', async () => {
    const m = await newMess(db);
    const acc = await newAccount(db, m);
    const a = await newStudent(db, m);
    const b = await newStudent(db, m);
    await newPayment(db, { mess: m, student: a, account: acc });
    await newPayment(db, { mess: m, student: b, account: acc });

    expect(await asUser<{ id: string }>(a, 'select id from students')).toEqual([{ id: a }]);
    expect(await asUser(a, 'select id from payments')).toHaveLength(1);
    await expect(asUser(a, 'update students set full_name = $1', ['Hacked'])).rejects.toThrow(/permission denied/); // no write grant at all
    await expect(asUser(a, "insert into audit_logs (action) values ('x')")).rejects.toThrow(/permission denied|row-level/);
    await expect(asUser(a, 'select * from push_tokens')).rejects.toThrow(/permission denied/);
  });

  it('admins see their mess; only super admins read admins and the audit log; other messes stay invisible', async () => {
    const m = await newMess(db);
    const other = await newMess(db);
    const acc = await newAccount(db, m);
    const plain = await newAdmin(db, m);
    const boss = await newAdmin(db, m, { role: 'super_admin' });
    const s = await newStudent(db, m);
    await newStudent(db, other);
    await newPayment(db, { mess: m, student: s, account: acc });
    await db.query("insert into audit_logs (mess_id, action) values ($1, 'seen.by.boss')", [m]);

    expect(await asUser(plain, 'select id from students')).toHaveLength(1);
    expect(await asUser(plain, 'select id from payments')).toHaveLength(1);
    expect(await asUser(plain, 'select id from audit_logs')).toHaveLength(0);
    expect(await asUser(plain, 'select id from admins')).toHaveLength(1); // only themselves
    expect(await asUser(boss, 'select id from admins')).toHaveLength(2);
    expect((await asUser<{ action: string }>(boss, 'select action from audit_logs')).map((r) => r.action)).toContain('seen.by.boss');
  });

  it('anon has no access at all', async () => {
    await db.exec('begin');
    try {
      await db.exec('set local role anon');
      await expect(db.query('select * from students')).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec('rollback');
    }
  });
});
