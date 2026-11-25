import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb, dateOffset, newAccount, newAdmin, newMess, newPayment, newQrCode, newStudent, newSubscription, one, today,
} from '../helpers/db';

/** The dashboard and the admin student list are real SQL: test them on a real PostgreSQL (PGlite). */
let db: PGlite;
let t: string;

beforeAll(async () => {
  db = await createDb();
  t = await today(db);
}, 120_000);
afterAll(async () => db.close());

const d = (n: number) => dateOffset(db, t, n);

interface ListRow {
  id: string;
  full_name: string;
  student_code: string;
  is_active: boolean;
  subscription_status: string;
  subscription_end_date: string | null;
  total_count: string | number;
}

async function list(
  mess: string,
  o: { q?: string; active?: boolean; sub?: string; sort?: string; limit?: number; offset?: number; expiringBy?: string } = {},
): Promise<ListRow[]> {
  const { rows } = await db.query<ListRow>(
    `select id, full_name, student_code, is_active, subscription_status, subscription_end_date::text, total_count
       from admin_list_students($1, $2::date, $3, $4, $5, $6::date, $7, $8, $9)`,
    [mess, t, o.q ?? null, o.active ?? null, o.sub ?? null, o.expiringBy ?? (await d(2)), o.sort ?? 'name', o.limit ?? 100, o.offset ?? 0],
  );
  return rows;
}

describe('admin_list_students', () => {
  let mess: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    mess = await newMess(db);
    const acc = await newAccount(db, mess);
    const make = async (key: string, name: string, extra: Record<string, unknown> = {}) => {
      const id = await newStudent(db, mess, { active: extra.active !== false });
      await db.query('update students set full_name = $2, phone = $3 where id = $1', [id, name, (extra.phone as string) ?? null]);
      ids[key] = id;
      return id;
    };
    const sub = (student: string, start: string, end: string, status = 'active') =>
      newSubscription(db, { mess, student, account: acc, start, end, status });

    await sub(await make('amna', 'Amna Malik', { phone: '03001112222' }), await d(-5), await d(10)); // active
    await sub(await make('bilal', 'Bilal Ahmed'), await d(-28), await d(1)); // active, expiring
    await sub(await make('chand', 'Chand Bibi'), await d(-40), await d(-5), 'expired'); // expired
    await make('danish', 'Danish Khan'); // none
    await sub(await make('esha', 'Esha Noor', { active: false }), await d(-5), await d(10)); // disabled but covered
    await sub(await make('farah', 'Farah Ali'), await d(5), await d(34), 'scheduled'); // scheduled only
    // renewed: expired period + a current one -> "active" (the covering period wins)
    const gul = await make('gul', 'Gul Zaman');
    await sub(gul, await d(-70), await d(-41), 'expired');
    await sub(gul, await d(-10), await d(19));
    // cancelled only -> counts as none
    await sub(await make('hina', 'Hina Shah'), await d(-5), await d(24), 'cancelled');

    // another mess must never leak in
    const other = await newMess(db);
    await newStudent(db, other);
  });

  it('lists the mess students only, with the subscription state judged by dates', async () => {
    const rows = await list(mess);
    expect(rows).toHaveLength(8);
    const by = Object.fromEntries(rows.map((r) => [r.full_name, r]));
    expect(by['Amna Malik']).toMatchObject({ subscription_status: 'active', subscription_end_date: await d(10) });
    expect(by['Bilal Ahmed']).toMatchObject({ subscription_status: 'active', subscription_end_date: await d(1) });
    expect(by['Chand Bibi']).toMatchObject({ subscription_status: 'expired', subscription_end_date: await d(-5) });
    expect(by['Danish Khan']).toMatchObject({ subscription_status: 'none', subscription_end_date: null });
    expect(by['Farah Ali']).toMatchObject({ subscription_status: 'scheduled' });
    expect(by['Gul Zaman']).toMatchObject({ subscription_status: 'active', subscription_end_date: await d(19) });
    expect(by['Hina Shah']).toMatchObject({ subscription_status: 'none' }); // cancelled does not count
    expect(by['Esha Noor']).toMatchObject({ is_active: false, subscription_status: 'active' });
  });

  it.each([
    ['active', ['Amna Malik', 'Bilal Ahmed', 'Esha Noor', 'Gul Zaman']],
    ['expiring', ['Bilal Ahmed']],
    ['expired', ['Chand Bibi']],
    ['scheduled', ['Farah Ali']],
    ['none', ['Danish Khan', 'Hina Shah']],
  ])('filter subscription=%s', async (sub, names) => {
    expect((await list(mess, { sub })).map((r) => r.full_name)).toEqual(names);
  });

  it('filters by account status', async () => {
    expect((await list(mess, { active: false })).map((r) => r.full_name)).toEqual(['Esha Noor']);
    expect(await list(mess, { active: true })).toHaveLength(7);
  });

  it('combines filters', async () => {
    expect((await list(mess, { active: true, sub: 'active' })).map((r) => r.full_name)).toEqual(['Amna Malik', 'Bilal Ahmed', 'Gul Zaman']);
  });

  it('searches name, code and phone (case-insensitive, literal text: % and _ are not wildcards)', async () => {
    expect((await list(mess, { q: 'AMNA' })).map((r) => r.full_name)).toEqual(['Amna Malik']);
    expect((await list(mess, { q: '0300111' })).map((r) => r.full_name)).toEqual(['Amna Malik']);
    const code = (await list(mess, { q: 'danish' }))[0]!.student_code;
    expect((await list(mess, { q: code.toLowerCase() })).map((r) => r.full_name)).toContain('Danish Khan');
    expect(await list(mess, { q: '%' })).toHaveLength(0);
    expect(await list(mess, { q: 'zzz-nobody' })).toHaveLength(0);
  });

  it('sorts by name, code or newest, and pages with the total on every row', async () => {
    const byName = (await list(mess, { sort: 'name' })).map((r) => r.full_name);
    expect(byName).toEqual([...byName].sort());
    const byCode = (await list(mess, { sort: 'code' })).map((r) => r.student_code);
    expect(byCode).toEqual([...byCode].sort());

    const page2 = await list(mess, { limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
    expect(Number(page2[0]!.total_count)).toBe(8); // total of the filtered set, not of the page
    expect(page2.map((r) => r.full_name)).toEqual(byName.slice(3, 6));
  });

  it('"expiring" respects the cut-off date the API computes', async () => {
    expect((await list(mess, { sub: 'expiring', expiringBy: await d(0) })).map((r) => r.full_name)).toEqual([]);
    expect((await list(mess, { sub: 'expiring', expiringBy: await d(10) })).map((r) => r.full_name)).toEqual(['Amna Malik', 'Bilal Ahmed', 'Esha Noor']); // the account filter is separate
  });

  it('is only callable by the backend (service_role)', async () => {
    const { rows } = await db.query<{ r: string; ok: boolean }>(
      `select r, has_function_privilege(r, 'admin_list_students(uuid,date,text,boolean,text,date,text,integer,integer)', 'execute') as ok
         from unnest(array['anon','authenticated','service_role']) r`,
    );
    expect(Object.fromEntries(rows.map((x) => [x.r, x.ok]))).toEqual({ anon: false, authenticated: false, service_role: true });
  });
});

describe('admin_dashboard_counts', () => {
  it('computes every number of the admin home screen', async () => {
    const mess = await newMess(db);
    const acc = await newAccount(db, mess);
    const admin = await newAdmin(db, mess);
    const qr = await newQrCode(db, mess, admin, 'Table 1');
    const revoked = await newQrCode(db, mess, admin, 'Table 2');
    await db.query("update qr_codes set status='revoked', revoked_at=now(), revoked_by=$2, revoke_reason='Leaked' where id=$1", [revoked, admin]);

    const sub = (student: string, start: string, end: string, status = 'active') =>
      newSubscription(db, { mess, student, account: acc, start, end, status });

    const ali = await newStudent(db, mess); // active, ends in 3 days, not renewed -> expiring
    const aliSub = await sub(ali, await d(-26), await d(3));
    const bina = await newStudent(db, mess); // active, ends in 3 days, renewed -> NOT expiring
    await sub(bina, await d(-26), await d(3));
    await sub(bina, await d(4), await d(33), 'scheduled');
    const cara = await newStudent(db, mess); // active far from the end
    await sub(cara, await d(-3), await d(26));
    await sub(await newStudent(db, mess, { active: false }), await d(-3), await d(26)); // disabled: not counted
    await newStudent(db, mess); // no subscription
    await sub(await newStudent(db, mess), await d(-40), await d(-10), 'expired'); // expired: not counted

    // attendance today: Ali lunch + dinner, Cara lunch
    const mark = (student: string, subscription: string, meal: string) =>
      db.query(
        `insert into attendance (mess_id, student_id, subscription_id, qr_code_id, meal_type, attendance_date)
         values ($1,$2,$3,$4,$5,$6::date)`, [mess, student, subscription, qr, meal, t],
      );
    await mark(ali, aliSub, 'lunch');
    await mark(ali, aliSub, 'dinner');
    const caraSub = (await one<{ id: string }>(db, 'select id from subscriptions where student_id=$1', [cara])).id;
    await mark(cara, caraSub, 'lunch');
    // yesterday must not count as today
    await db.query(
      `insert into attendance (mess_id, student_id, subscription_id, qr_code_id, meal_type, attendance_date)
       values ($1,$2,$3,$4,'lunch',$5::date)`, [mess, ali, aliSub, qr, await d(-1)],
    );

    // payments: two approved this month (8500 each), one rejected, two pending
    const approver = await newAdmin(db, mess);
    for (const _ of [1, 2]) {
      const s = await newStudent(db, mess);
      const p = await newPayment(db, { mess, student: s, account: acc });
      await db.query('select approve_payment($1, $2)', [p, approver]);
    }
    await newPayment(db, { mess, student: await newStudent(db, mess), account: acc, status: 'rejected', reviewer: approver });
    await newPayment(db, { mess, student: await newStudent(db, mess), account: acc });
    await newPayment(db, { mess, student: await newStudent(db, mess), account: acc });

    const monthStart = `${t.slice(0, 7)}-01`;
    const monthNext = (await one<{ d: string }>(db, `select (($1::date) + interval '1 month')::date::text as d`, [monthStart])).d;
    const c = await one<Record<string, unknown>>(
      db,
      'select * from admin_dashboard_counts($1, $2::date, $3::date, $4::date, $5::date)',
      [mess, t, monthStart, monthNext, await d(6)],
    );

    expect(c).toMatchObject({
      lunch_today: 2,
      dinner_today: 1,
      pending_payments: 2,
      expiring_soon: 1, // only Ali: Bina has a renewal queued, Cara ends too late
      active_qr_codes: 1,
    });
    expect(Number(c.revenue_month)).toBe(17000);
    // students with an active subscription today: Ali, Bina, Cara + the two just approved
    expect(c.students_with_active_subscription).toBe(5);
    // enabled students: ali, bina, cara, none-sub, expired-sub, 2 approved, rejected, 2 pending = 10 (the disabled one is excluded)
    expect(c.active_students).toBe(10);
  });

  it('revenue only counts approved payments decided inside the month, in mess time', async () => {
    const mess = await newMess(db);
    const acc = await newAccount(db, mess);
    const admin = await newAdmin(db, mess);
    const s = await newStudent(db, mess);
    const old = await newPayment(db, { mess, student: s, account: acc, status: 'approved', reviewer: admin });
    await db.query("update payments set reviewed_at = (now() - interval '70 days') where id = $1", [old]);

    const monthStart = `${t.slice(0, 7)}-01`;
    const monthNext = (await one<{ d: string }>(db, `select (($1::date) + interval '1 month')::date::text as d`, [monthStart])).d;
    const c = await one<{ revenue_month: string }>(
      db, 'select revenue_month from admin_dashboard_counts($1, $2::date, $3::date, $4::date, $5::date)', [mess, t, monthStart, monthNext, t],
    );
    expect(Number(c.revenue_month)).toBe(0);
  });

  it('an empty mess returns zeros, not nulls', async () => {
    const mess = await newMess(db);
    const c = await one<Record<string, unknown>>(
      db, 'select * from admin_dashboard_counts($1, $2::date, $2::date, $2::date, $2::date)', [mess, t],
    );
    expect(Object.values(c).map(Number)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
