import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/AppError';
import { setClock } from '../../src/lib/clock';

const m = vi.hoisted(() => ({
  subs: {
    findCovering: vi.fn(), listOverlapping: vi.fn(), listRecentNonCancelled: vi.fn(), listForStudent: vi.fn(),
    listForAdmin: vi.fn(), findDetailForAdmin: vi.fn(), findByIdForMess: vi.fn(), cancel: vi.fn(),
    countStartingAfter: vi.fn(), refreshStatuses: vi.fn(), findEndingOn: vi.fn(),
  },
  settings: { findMess: vi.fn(), findSettings: vi.fn(), updateSettings: vi.fn() },
  notifications: { notifyStudent: vi.fn() },
  audit: { insert: vi.fn() },
  students: { findById: vi.fn(), insert: vi.fn(), searchIds: vi.fn() },
  admins: { findById: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
}));

vi.mock('../../src/modules/subscriptions/subscriptions.repository', () => m.subs);
vi.mock('../../src/modules/settings/settings.repository', () => m.settings);
vi.mock('../../src/modules/notifications/notifications.service', () => m.notifications);
vi.mock('../../src/modules/audit/audit.repository', () => m.audit);
vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);

import { createApp } from '../../src/app';

const app = createApp({ readinessCheck: async () => undefined });
const MESS = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const ADMIN = '55555555-5555-4555-8555-555555555555';
const SUB = '77777777-7777-4777-8777-777777777777';
const TODAY = '2026-11-25';

const settingsRow = () => ({
  mess_id: MESS, monthly_fee: 8500, currency: 'PKR', subscription_days: 30,
  lunch_start: '10:00:00', lunch_end: '16:00:00', dinner_start: '16:45:00', dinner_end: '20:45:00',
  expiry_reminder_days: 3, payment_instructions: null, geofence_enabled: false, latitude: null, longitude: null,
  geofence_radius_m: 150, updated_at: 'x',
});
const sub = (over: Record<string, unknown> = {}) => ({
  id: SUB, mess_id: MESS, student_id: USER, payment_id: 'p1', start_date: '2026-11-10', end_date: '2026-12-09',
  status: 'active', amount: 8500, created_at: '2026-11-10T00:00:00Z', cancelled_at: null, cancelled_by: null,
  cancel_reason: null, student: { id: USER, student_code: 'S00042', full_name: 'Ali Khan' }, ...over,
});

type Who = 'student' | 'admin' | 'super_admin';
function loginAs(who: Who, id = USER): void {
  m.verify.verifyAccessToken.mockResolvedValue({ sub: id, email: 'x@example.com' });
  if (who === 'student') {
    m.students.findById.mockResolvedValue({ id, mess_id: MESS, email: 'x@example.com', is_active: true });
    m.admins.findById.mockResolvedValue(null);
  } else {
    m.admins.findById.mockResolvedValue({ id, mess_id: MESS, email: 'x@example.com', role: who, is_active: true, full_name: 'Boss', phone: null, created_at: 'x' });
    m.students.findById.mockResolvedValue(null);
  }
}
const api = (method: 'get' | 'post', path: string) => request(app)[method](`/api/v1${path}`).set('Authorization', 'Bearer t');

beforeEach(() => {
  vi.resetAllMocks();
  setClock(() => new Date('2026-11-25T07:00:00Z'));
  m.settings.findMess.mockResolvedValue({ id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' });
  m.settings.findSettings.mockResolvedValue(settingsRow());
  m.audit.insert.mockResolvedValue(undefined);
  m.notifications.notifyStudent.mockResolvedValue(undefined);
});
afterEach(() => setClock(null));

// =====================================================================================================
describe('GET /student/subscription', () => {
  beforeEach(() => loginAs('student'));
  const state = async () => (await api('get', '/student/subscription')).body.data;

  it('"none" for a student who never subscribed', async () => {
    m.subs.listRecentNonCancelled.mockResolvedValue([]);
    expect(await state()).toEqual({ server_date: TODAY, status_summary: 'none', current: null, next: null, last_expired: null });
  });

  it('"active" with days remaining counted from the server date', async () => {
    m.subs.listRecentNonCancelled.mockResolvedValue([sub()]);
    const d = await state();
    expect(d.status_summary).toBe('active');
    expect(d.current).toMatchObject({ id: SUB, status: 'active', end_date: '2026-12-09', days_remaining: 15, is_expiring_soon: false, amount: '8500.00' });
    expect(m.subs.listRecentNonCancelled).toHaveBeenCalledWith(USER);
  });

  it('"expiring_soon" within the reminder window (3 days incl. today)', async () => {
    m.subs.listRecentNonCancelled.mockResolvedValue([sub({ end_date: '2026-11-27' })]);
    const d = await state();
    expect(d.status_summary).toBe('expiring_soon');
    expect(d.current).toMatchObject({ days_remaining: 3, is_expiring_soon: true });
  });

  it('the last day still counts as active (BR-13)', async () => {
    m.subs.listRecentNonCancelled.mockResolvedValue([sub({ end_date: TODAY })]);
    expect(await state()).toMatchObject({ status_summary: 'expiring_soon', current: { days_remaining: 1, status: 'active' } });
  });

  it('is judged by DATES: a period that ended yesterday is expired even if the nightly job has not run', async () => {
    m.subs.listRecentNonCancelled.mockResolvedValue([sub({ status: 'active', start_date: '2026-10-01', end_date: '2026-11-24' })]);
    const d = await state();
    expect(d.status_summary).toBe('expired');
    expect(d.current).toBeNull();
    expect(d.last_expired).toMatchObject({ status: 'expired', days_remaining: 0, is_expiring_soon: false });
  });

  it('a scheduled renewal whose start date arrived is already active (job lag the other way)', async () => {
    m.subs.listRecentNonCancelled.mockResolvedValue([sub({ status: 'scheduled', start_date: TODAY, end_date: '2026-12-24' })]);
    expect(await state()).toMatchObject({ status_summary: 'active', current: { status: 'active', days_remaining: 30 } });
  });

  it('"scheduled" when only a future period exists; current + next when both do', async () => {
    const future = sub({ id: 'next', status: 'scheduled', start_date: '2026-12-10', end_date: '2027-01-08' });
    m.subs.listRecentNonCancelled.mockResolvedValue([future]);
    expect(await state()).toMatchObject({ status_summary: 'scheduled', current: null, next: { id: 'next', days_remaining: 30 } });

    m.subs.listRecentNonCancelled.mockResolvedValue([future, sub()]);
    expect(await state()).toMatchObject({ status_summary: 'active', current: { id: SUB }, next: { id: 'next', status: 'scheduled' } });
  });

  it('picks the most recent expired period', async () => {
    m.subs.listRecentNonCancelled.mockResolvedValue([
      sub({ id: 'old', start_date: '2026-08-01', end_date: '2026-08-30', status: 'expired' }),
      sub({ id: 'recent', start_date: '2026-10-01', end_date: '2026-10-30', status: 'expired' }),
    ]);
    expect((await state()).last_expired.id).toBe('recent');
  });

  it('is only for students', async () => {
    loginAs('admin', ADMIN);
    expect((await api('get', '/student/subscription')).status).toBe(403);
  });
});

describe('GET /student/subscriptions (history)', () => {
  it('pages the history and shows effective statuses', async () => {
    loginAs('student');
    m.subs.listForStudent.mockResolvedValue({
      rows: [sub(), sub({ id: 'c', status: 'cancelled', cancelled_at: 'x' }), sub({ id: 'old', status: 'active', start_date: '2026-09-01', end_date: '2026-09-30' })],
      total: 45,
    });
    const res = await api('get', '/student/subscriptions?page=2&limit=20');
    expect(res.status).toBe(200);
    expect(m.subs.listForStudent).toHaveBeenCalledWith(USER, 20, 39);
    expect(res.body.meta).toEqual({ page: 2, limit: 20, total: 45, total_pages: 3 });
    expect(res.body.data.map((s: { status: string }) => s.status)).toEqual(['active', 'cancelled', 'expired']);
    expect(res.body.data[1].days_remaining).toBe(0);
  });
});

// =====================================================================================================
describe('admin subscriptions', () => {
  beforeEach(() => loginAs('admin', ADMIN));

  it('lists with the student and cancellation details', async () => {
    m.subs.listForAdmin.mockResolvedValue({ rows: [sub()], total: 1 });
    const res = await api('get', '/admin/subscriptions');
    expect(res.status).toBe(200);
    expect(m.subs.listForAdmin).toHaveBeenCalledWith({
      messId: MESS, today: TODAY, status: undefined, expiringBy: undefined, q: undefined, from: 0, to: 19,
    });
    expect(res.body.data[0]).toMatchObject({
      id: SUB, status: 'active', student: { id: USER, student_code: 'S00042', full_name: 'Ali Khan' },
      cancelled_at: null, cancel_reason: null, days_remaining: 15,
    });
  });

  it('passes filters: status, expiring window (as a date), search', async () => {
    m.subs.listForAdmin.mockResolvedValue({ rows: [], total: 0 });
    await api('get', '/admin/subscriptions?expiring_within_days=7&q=ali&page=2&limit=10');
    expect(m.subs.listForAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ expiringBy: '2026-12-02', q: 'ali', from: 10, to: 19 }));
    await api('get', '/admin/subscriptions?status=expired');
    expect(m.subs.listForAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'expired' }));
  });

  it.each(['status=weird', 'expiring_within_days=0', 'expiring_within_days=31', 'q=a', 'limit=500'])('rejects %s', async (qs) => {
    expect((await api('get', `/admin/subscriptions?${qs}`)).status).toBe(400);
  });

  it('detail adds the payment summary and attendance count', async () => {
    m.subs.findDetailForAdmin.mockResolvedValue({
      row: sub(),
      payment: { id: 'p1', transaction_id: 'T123', method: 'jazzcash', amount: 8500, reviewed_at: '2026-11-10T00:00:00Z' },
      attendanceCount: 31,
    });
    const res = await api('get', `/admin/subscriptions/${SUB}`);
    expect(res.status).toBe(200);
    expect(m.subs.findDetailForAdmin).toHaveBeenCalledWith(SUB, MESS);
    expect(res.body.data).toMatchObject({ id: SUB, attendance_count: 31, payment: { transaction_id: 'T123', amount: '8500.00' } });
  });

  it('detail of another mess or an unknown id is 404', async () => {
    m.subs.findDetailForAdmin.mockResolvedValue(null);
    expect((await api('get', `/admin/subscriptions/${SUB}`)).status).toBe(404);
    expect((await api('get', '/admin/subscriptions/nope')).status).toBe(400);
  });

  it('students cannot reach admin routes', async () => {
    loginAs('student');
    expect((await api('get', '/admin/subscriptions')).status).toBe(403);
    expect((await api('post', `/admin/subscriptions/${SUB}/cancel`).send({ reason: 'Because' })).status).toBe(403);
  });
});

describe('POST /admin/subscriptions/:id/cancel (any admin, D-24)', () => {
  const cancel = (reason: unknown = 'Admitted by mistake') => api('post', `/admin/subscriptions/${SUB}/cancel`).send({ reason });
  beforeEach(() => {
    loginAs('admin', ADMIN);
    m.subs.findByIdForMess.mockResolvedValue(sub());
    m.subs.cancel.mockResolvedValue(sub({ status: 'cancelled', cancelled_at: '2026-11-25T07:00:00Z', cancel_reason: 'Admitted by mistake' }));
    m.subs.countStartingAfter.mockResolvedValue(0);
  });

  it('cancels, audits with the previous status, and tells the student', async () => {
    const res = await cancel();
    expect(res.status).toBe(200);
    expect(m.subs.cancel).toHaveBeenCalledWith(SUB, MESS, ADMIN, 'Admitted by mistake', '2026-11-25T07:00:00.000Z');
    expect(res.body.data.subscription).toMatchObject({ status: 'cancelled', cancel_reason: 'Admitted by mistake', days_remaining: 0 });
    expect(res.body.data.later_periods).toBe(0);

    expect(m.audit.insert.mock.calls[0]![0]).toMatchObject({
      action: 'subscription.cancel', entity_id: SUB, actor_id: ADMIN,
      metadata: { student_id: USER, reason: 'Admitted by mistake', previous_status: 'active', start_date: '2026-11-10', end_date: '2026-12-09' },
    });
    expect(m.notifications.notifyStudent).toHaveBeenCalledWith(expect.objectContaining({
      studentId: USER, type: 'general', title: 'Subscription cancelled', body: 'Your subscription was cancelled: Admitted by mistake',
    }));
  });

  it('warns when a renewal is queued behind the cancelled period (gap)', async () => {
    m.subs.countStartingAfter.mockResolvedValue(1);
    const res = await cancel();
    expect(res.body.data.later_periods).toBe(1);
    expect(m.subs.countStartingAfter).toHaveBeenCalledWith(USER, '2026-12-09');
  });

  it('can cancel a scheduled period too', async () => {
    m.subs.findByIdForMess.mockResolvedValue(sub({ status: 'scheduled', start_date: '2026-12-10', end_date: '2027-01-08' }));
    expect((await cancel()).status).toBe(200);
    expect(m.audit.insert.mock.calls[0]![0].metadata.previous_status).toBe('scheduled');
  });

  it.each([
    ['already cancelled', sub({ status: 'cancelled' })],
    ['already expired', sub({ status: 'expired', end_date: '2026-11-01' })],
    ['expired by date although the stored status still says active', sub({ status: 'active', end_date: '2026-11-24' })],
  ])('refuses a subscription that is %s', async (_l, row) => {
    m.subs.findByIdForMess.mockResolvedValue(row);
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBSCRIPTION_NOT_CANCELLABLE');
    expect(m.subs.cancel).not.toHaveBeenCalled();
    expect(m.audit.insert).not.toHaveBeenCalled();
  });

  it('loses gracefully when another admin cancelled first', async () => {
    m.subs.cancel.mockResolvedValue(null);
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(m.audit.insert).not.toHaveBeenCalled();
  });

  it('needs a real reason and a subscription of this mess', async () => {
    expect((await cancel('no')).status).toBe(400);
    expect((await cancel(null)).status).toBe(400);
    expect((await api('post', `/admin/subscriptions/${SUB}/cancel`).send({ reason: 'Valid reason', extra: 1 })).status).toBe(400);
    m.subs.findByIdForMess.mockResolvedValue(null);
    expect((await cancel()).status).toBe(404);
    expect(m.subs.findByIdForMess).toHaveBeenCalledWith(SUB, MESS);
  });

  it('a failed audit write fails the request', async () => {
    m.audit.insert.mockRejectedValue(new AppError('INTERNAL_ERROR'));
    expect((await cancel()).status).toBe(500);
  });
});
