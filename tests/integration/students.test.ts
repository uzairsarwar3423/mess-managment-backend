import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/AppError';
import { setClock } from '../../src/lib/clock';

const m = vi.hoisted(() => ({
  students: {
    findById: vi.fn(), findInMess: vi.fn(), insert: vi.fn(), updateProfile: vi.fn(), setProfileImage: vi.fn(),
    setActive: vi.fn(), searchIds: vi.fn(), listForAdmin: vi.fn(),
  },
  admins: { findById: vi.fn() },
  subs: { listRecentNonCancelled: vi.fn(), listForStudent: vi.fn(), findCovering: vi.fn(), listOverlapping: vi.fn() },
  att: { listForStudentRange: vi.fn(), history: vi.fn() },
  payments: { findLatestForStudent: vi.fn(), listForAdmin: vi.fn(), hasPendingPayment: vi.fn() },
  notif: { countUnread: vi.fn(), insert: vi.fn() },
  settings: { findMess: vi.fn(), findSettings: vi.fn() },
  authRepo: { setBanned: vi.fn() },
  audit: { insert: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
  reports: { dashboardCounts: vi.fn() },
  cld: { api: { resource: vi.fn() }, uploader: { destroy: vi.fn() }, utils: { api_sign_request: vi.fn() }, url: vi.fn() },
}));

vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/subscriptions/subscriptions.repository', () => m.subs);
vi.mock('../../src/modules/attendance/attendance.repository', () => m.att);
vi.mock('../../src/modules/payments/payments.repository', () => m.payments);
vi.mock('../../src/modules/notifications/notifications.repository', () => m.notif);
vi.mock('../../src/modules/settings/settings.repository', () => m.settings);
vi.mock('../../src/modules/auth/auth.repository', () => m.authRepo);
vi.mock('../../src/modules/audit/audit.repository', () => m.audit);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);
vi.mock('../../src/modules/reports/reports.repository', () => m.reports);
vi.mock('../../src/lib/cloudinary', () => ({ getCloudinary: () => m.cld }));

import { createApp } from '../../src/app';

const app = createApp({ readinessCheck: async () => undefined });
const MESS = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const ADMIN = '55555555-5555-4555-8555-555555555555';
const OTHER_STUDENT = '66666666-6666-4666-8666-666666666666';
const AVATAR = `mess-dev/profiles/${USER}/0a1b2c3d-aaaa-bbbb-cccc-123456789abc`;
const TODAY = '2026-11-25';

const settingsRow = () => ({
  mess_id: MESS, monthly_fee: 8500, currency: 'PKR', subscription_days: 30,
  lunch_start: '10:00:00', lunch_end: '16:00:00', dinner_start: '16:45:00', dinner_end: '20:45:00',
  expiry_reminder_days: 3, payment_instructions: null, geofence_enabled: false, latitude: null, longitude: null,
  geofence_radius_m: 150, updated_at: 'x',
});
const studentRow = (over: Record<string, unknown> = {}) => ({
  id: USER, mess_id: MESS, student_code: 'S00042', email: 'ali@example.com', full_name: 'Ali Khan', phone: '03001234567',
  roll_number: '21-CS-045', profile_image_url: null, profile_image_public_id: null, is_active: true, created_at: '2026-11-01T09:00:00Z', ...over,
});
const subRow = (over: Record<string, unknown> = {}) => ({
  id: 'sub1', mess_id: MESS, student_id: USER, payment_id: 'p1', start_date: '2026-11-10', end_date: '2026-12-09',
  status: 'active', amount: 8500, created_at: '2026-11-10T00:00:00Z', ...over,
});

type Who = 'student' | 'admin' | 'super_admin';
function loginAs(who: Who, id = who === 'student' ? USER : ADMIN): void {
  m.verify.verifyAccessToken.mockResolvedValue({ sub: id, email: 'x@example.com' });
  if (who === 'student') {
    m.students.findById.mockResolvedValue(studentRow({ id }));
    m.admins.findById.mockResolvedValue(null);
  } else {
    m.admins.findById.mockResolvedValue({ id, mess_id: MESS, email: 'x@example.com', role: who, is_active: true, full_name: 'Boss', phone: null, created_at: 'x' });
    m.students.findById.mockResolvedValue(null);
  }
}
const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', 'Bearer t');

beforeEach(() => {
  vi.resetAllMocks();
  setClock(() => new Date('2026-11-25T07:00:00Z'));
  m.settings.findMess.mockResolvedValue({ id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' });
  m.settings.findSettings.mockResolvedValue(settingsRow());
  m.audit.insert.mockResolvedValue(undefined);
  m.cld.url.mockImplementation((id: string) => `https://res.cloudinary.com/test/${id}`);
  m.cld.uploader.destroy.mockResolvedValue({ result: 'ok' });
});
afterEach(() => setClock(null));

// =====================================================================================================
describe('student profile', () => {
  beforeEach(() => loginAs('student'));

  it('GET /student/me returns the DTO without internal columns', async () => {
    const res = await api('get', '/student/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: USER, student_code: 'S00042', email: 'ali@example.com', full_name: 'Ali Khan', phone: '03001234567',
      roll_number: '21-CS-045', profile_image_url: null, is_active: true, created_at: '2026-11-01T09:00:00Z',
    });
  });

  it('PATCH /student/me changes only the allowed fields', async () => {
    m.students.updateProfile.mockResolvedValue(studentRow({ full_name: 'Ali Raza', roll_number: null }));
    const res = await api('patch', '/student/me').send({ full_name: 'Ali Raza', roll_number: null });
    expect(res.status).toBe(200);
    expect(m.students.updateProfile).toHaveBeenCalledWith(USER, { full_name: 'Ali Raza', roll_number: null });
    expect(res.body.data.full_name).toBe('Ali Raza');
  });

  it.each([
    ['email', { email: 'new@example.com' }],
    ['is_active', { is_active: false }],
    ['role', { role: 'admin' }],
    ['student_code', { student_code: 'S99999' }],
    ['empty body', {}],
    ['bad phone', { phone: '123' }],
    ['short name', { full_name: 'A' }],
  ])('rejects %s', async (_l, body) => {
    expect((await api('patch', '/student/me').send(body)).status).toBe(400);
    expect(m.students.updateProfile).not.toHaveBeenCalled();
  });

  describe('profile image', () => {
    const resource = (over: Record<string, unknown> = {}) => ({
      public_id: AVATAR, secure_url: `https://res.cloudinary.com/test/image/upload/${AVATAR}.jpg`, bytes: 90_000, format: 'jpg',
      width: 512, height: 512, type: 'upload', created_at: new Date().toISOString(), ...over,
    });

    it('verifies the upload, stores its public URL and deletes the previous avatar', async () => {
      m.students.findById.mockResolvedValue(studentRow({ profile_image_public_id: 'old/public/id' }));
      m.cld.api.resource.mockResolvedValue(resource());
      m.students.setProfileImage.mockResolvedValue(studentRow({ profile_image_url: resource().secure_url }));

      const res = await api('put', '/student/me/profile-image').send({ public_id: AVATAR });
      expect(res.status).toBe(200);
      expect(m.cld.api.resource).toHaveBeenCalledWith(AVATAR, { resource_type: 'image', type: 'upload' });
      expect(m.students.setProfileImage).toHaveBeenCalledWith(USER, { url: resource().secure_url, publicId: AVATAR });
      expect(m.cld.uploader.destroy).toHaveBeenCalledWith('old/public/id', { resource_type: 'image', type: 'upload', invalidate: true });
      expect(res.body.data.profile_image_url).toBe(resource().secure_url);
      expect(res.body.data.profile_image_public_id).toBeUndefined();
    });

    it("refuses someone else's folder and a payment screenshot used as an avatar", async () => {
      const other = await api('put', '/student/me/profile-image').send({ public_id: `mess-dev/profiles/${OTHER_STUDENT}/0a1b2c3d-aaaa-bbbb-cccc-123456789abc` });
      expect(other.body.error.code).toBe('INVALID_UPLOAD');
      const shot = await api('put', '/student/me/profile-image').send({ public_id: `mess-dev/payments/${USER}/0a1b2c3d-aaaa-bbbb-cccc-123456789abc` });
      expect(shot.body.error.code).toBe('INVALID_UPLOAD');
      expect(m.cld.api.resource).not.toHaveBeenCalled();
      expect(m.students.setProfileImage).not.toHaveBeenCalled();
    });

    it('rejects (and deletes) an avatar above 1 MB', async () => {
      m.cld.api.resource.mockResolvedValue(resource({ bytes: 2_000_000 }));
      const res = await api('put', '/student/me/profile-image').send({ public_id: AVATAR });
      expect(res.status).toBe(400);
      expect(m.cld.uploader.destroy).toHaveBeenCalledWith(AVATAR, expect.objectContaining({ type: 'upload' }));
      expect(m.students.setProfileImage).not.toHaveBeenCalled();
    });

    it('does not delete the asset when the same image is re-attached', async () => {
      m.students.findById.mockResolvedValue(studentRow({ profile_image_public_id: AVATAR }));
      m.cld.api.resource.mockResolvedValue(resource());
      m.students.setProfileImage.mockResolvedValue(studentRow());
      await api('put', '/student/me/profile-image').send({ public_id: AVATAR });
      expect(m.cld.uploader.destroy).not.toHaveBeenCalled();
    });

    it('DELETE removes the avatar and its Cloudinary asset', async () => {
      m.students.findById.mockResolvedValue(studentRow({ profile_image_public_id: AVATAR, profile_image_url: 'u' }));
      m.students.setProfileImage.mockResolvedValue(studentRow());
      const res = await api('delete', '/student/me/profile-image');
      expect(res.status).toBe(200);
      expect(m.students.setProfileImage).toHaveBeenCalledWith(USER, null);
      expect(m.cld.uploader.destroy).toHaveBeenCalledWith(AVATAR, expect.objectContaining({ type: 'upload' }));
    });
  });
});

// =====================================================================================================
describe('GET /student/dashboard', () => {
  beforeEach(() => {
    loginAs('student');
    m.subs.listRecentNonCancelled.mockResolvedValue([subRow()]);
    m.att.listForStudentRange.mockImplementation(async (_s: string, from: string) =>
      from === TODAY
        ? [{ meal_type: 'lunch', marked_at: '2026-11-25T06:55:00Z' }]
        : [
            { meal_type: 'lunch', marked_at: 'a' }, { meal_type: 'dinner', marked_at: 'b' },
            { meal_type: 'lunch', marked_at: 'c' }, { meal_type: 'lunch', marked_at: '2026-11-25T06:55:00Z' },
          ],
    );
    m.payments.findLatestForStudent.mockResolvedValue({ id: 'pay1', status: 'rejected', submitted_at: '2026-11-20T00:00:00Z', rejection_reason: 'Blurry' });
    m.notif.countUnread.mockResolvedValue(2);
  });

  it('aggregates subscription, today, latest payment, month summary and unread count', async () => {
    const res = await api('get', '/student/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      server_date: TODAY,
      student: { id: USER, full_name: 'Ali Khan', student_code: 'S00042', profile_image_url: null },
      subscription: { status_summary: 'active', current: { id: 'sub1', days_remaining: 15 }, next: null },
      today: { date: TODAY, current_meal: 'lunch', location_required: false, lunch: { marked: true }, dinner: { marked: false } },
      latest_payment: { id: 'pay1', status: 'rejected', rejection_reason: 'Blurry' },
      month_summary: { month: '2026-11', lunch_count: 3, dinner_count: 1 },
      unread_notifications: 2,
    });
    expect(m.notif.countUnread).toHaveBeenCalledWith(USER);
  });

  it('works for a brand-new student (no subscription, no payments, nothing marked)', async () => {
    m.subs.listRecentNonCancelled.mockResolvedValue([]);
    m.att.listForStudentRange.mockResolvedValue([]);
    m.payments.findLatestForStudent.mockResolvedValue(null);
    m.notif.countUnread.mockResolvedValue(0);
    const res = await api('get', '/student/dashboard');
    expect(res.body.data).toMatchObject({
      subscription: { status_summary: 'none', current: null },
      latest_payment: null,
      month_summary: { lunch_count: 0, dinner_count: 0 },
      unread_notifications: 0,
    });
  });

  it('is only for students', async () => {
    loginAs('admin');
    expect((await api('get', '/student/dashboard')).status).toBe(403);
  });
});

// =====================================================================================================
describe('admin: student list and detail', () => {
  beforeEach(() => loginAs('admin'));

  const listRow = (over: Record<string, unknown> = {}) => ({
    id: USER, student_code: 'S00042', email: 'ali@example.com', full_name: 'Ali Khan', phone: '03001234567', roll_number: null,
    profile_image_url: null, is_active: true, created_at: '2026-11-01T09:00:00Z', subscription_status: 'active',
    subscription_end_date: '2026-11-26', total_count: 41, ...over,
  });

  it('lists with filters translated for the SQL function and the paging meta from the total', async () => {
    m.students.listForAdmin.mockResolvedValue({ rows: [listRow()], total: 41 });
    const res = await api('get', '/admin/students?q=ali&status=active&subscription=expiring&sort=code&page=2&limit=20');
    expect(res.status).toBe(200);
    expect(m.students.listForAdmin).toHaveBeenCalledWith({
      messId: MESS, today: TODAY, q: 'ali', active: true, subscription: 'expiring',
      expiringBy: '2026-11-27', // today + (3 reminder days - 1)
      sort: 'code', limit: 20, offset: 20,
    });
    expect(res.body.meta).toEqual({ page: 2, limit: 20, total: 41, total_pages: 3 });
    expect(res.body.data[0]).toMatchObject({ student_code: 'S00042', subscription_status: 'active', subscription_expiring_soon: true });
    expect(res.body.data[0].total_count).toBeUndefined();
  });

  it('status=disabled maps to is_active=false; no filters means null/undefined', async () => {
    m.students.listForAdmin.mockResolvedValue({ rows: [], total: 0 });
    await api('get', '/admin/students?status=disabled');
    expect(m.students.listForAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ active: false, sort: 'name', offset: 0, limit: 20 }));
    await api('get', '/admin/students');
    expect(m.students.listForAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ active: undefined, subscription: undefined, q: undefined }));
  });

  it.each(['status=weird', 'subscription=maybe', 'sort=height', 'q=a', 'limit=1000'])('rejects %s', async (qs) => {
    expect((await api('get', `/admin/students?${qs}`)).status).toBe(400);
  });

  it('students cannot list students', async () => {
    loginAs('student');
    expect((await api('get', '/admin/students')).status).toBe(403);
  });

  it('detail: profile + subscription state + latest payment + this month', async () => {
    m.students.findInMess.mockResolvedValue(studentRow());
    m.subs.listRecentNonCancelled.mockResolvedValue([subRow()]);
    m.payments.findLatestForStudent.mockResolvedValue({ id: 'pay1', status: 'approved', submitted_at: 'x', rejection_reason: null });
    m.att.listForStudentRange.mockResolvedValue([{ meal_type: 'lunch', marked_at: 'a' }, { meal_type: 'dinner', marked_at: 'b' }]);

    const res = await api('get', `/admin/students/${USER}`);
    expect(res.status).toBe(200);
    expect(m.students.findInMess).toHaveBeenCalledWith(USER, MESS);
    expect(res.body.data).toMatchObject({
      id: USER, full_name: 'Ali Khan', subscription_status: 'active', current_subscription: { id: 'sub1' },
      latest_payment: { id: 'pay1', status: 'approved' }, month_attendance: { month: '2026-11', lunch_count: 1, dinner_count: 1 },
    });
  });

  it("a student of another mess (or an unknown id) is NOT_FOUND on every student route", async () => {
    m.students.findInMess.mockResolvedValue(null);
    for (const path of ['', '/subscriptions', '/payments', '/attendance?month=2026-11']) {
      expect((await api('get', `/admin/students/${USER}${path}`)).status).toBe(404);
    }
    expect((await api('patch', `/admin/students/${USER}/status`).send({ is_active: false, reason: 'Left the mess' })).status).toBe(404);
    expect((await api('get', '/admin/students/not-a-uuid')).status).toBe(400);
  });
});

describe('admin: student sub-resources', () => {
  beforeEach(() => {
    loginAs('admin');
    m.students.findInMess.mockResolvedValue(studentRow());
  });

  it('subscriptions history', async () => {
    m.subs.listForStudent.mockResolvedValue({ rows: [subRow(), subRow({ id: 'old', start_date: '2026-09-01', end_date: '2026-09-30' })], total: 2 });
    const res = await api('get', `/admin/students/${USER}/subscriptions?limit=10`);
    expect(res.status).toBe(200);
    expect(m.subs.listForStudent).toHaveBeenCalledWith(USER, 0, 9);
    expect(res.body.data.map((s: { status: string }) => s.status)).toEqual(['active', 'expired']);
  });

  it("payments: the student's whole history by default, scoped to that student", async () => {
    m.payments.listForAdmin.mockResolvedValue({ rows: [], total: 0 });
    const res = await api('get', `/admin/students/${USER}/payments`);
    expect(res.status).toBe(200);
    expect(m.payments.listForAdmin).toHaveBeenCalledWith(expect.objectContaining({ messId: MESS, studentId: USER, status: 'all' }));
    await api('get', `/admin/students/${USER}/payments?status=rejected`);
    expect(m.payments.listForAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'rejected', studentId: USER }));
  });

  it('attendance: ?month gives the calendar, a date range gives paged history', async () => {
    m.subs.listOverlapping.mockResolvedValue([{ id: 'sub1', start_date: '2026-11-10', end_date: '2026-12-09', status: 'active' }]);
    m.att.listForStudentRange.mockResolvedValue([]);
    const cal = await api('get', `/admin/students/${USER}/attendance?month=2026-11`);
    expect(cal.status).toBe(200);
    expect(cal.body.data.days).toHaveLength(30);
    expect(m.att.listForStudentRange).toHaveBeenCalledWith(USER, '2026-11-01', '2026-11-30');

    m.att.history.mockResolvedValue({ rows: [{ id: 'a1', meal_type: 'lunch', attendance_date: '2026-11-24', marked_at: 'x', source: 'qr' }], total: 1 });
    const his = await api('get', `/admin/students/${USER}/attendance?from=2026-11-01&to=2026-11-25&meal_type=lunch`);
    expect(his.status).toBe(200);
    expect(m.att.history).toHaveBeenCalledWith(USER, '2026-11-01', '2026-11-25', 'lunch', 0, 19);
    expect(his.body.meta.total).toBe(1);
  });

  it('attendance: month and range together, or a range over 366 days, are refused', async () => {
    expect((await api('get', `/admin/students/${USER}/attendance?month=2026-11&from=2026-11-01`)).status).toBe(400);
    expect((await api('get', `/admin/students/${USER}/attendance?from=2024-01-01&to=2026-11-25`)).status).toBe(400);
  });
});

// =====================================================================================================
describe('PATCH /admin/students/:id/status (BR-16, BR-19)', () => {
  const setStatus = (body: object) => api('patch', `/admin/students/${USER}/status`).send(body);
  beforeEach(() => {
    loginAs('admin');
    m.students.findInMess.mockResolvedValue(studentRow());
    m.students.setActive.mockResolvedValue(studentRow({ is_active: false }));
    m.authRepo.setBanned.mockResolvedValue(undefined);
  });

  it('deactivates with a reason: audit entry, auth ban, response', async () => {
    const res = await setStatus({ is_active: false, reason: 'Left the hostel' });
    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
    expect(m.students.setActive).toHaveBeenCalledWith(USER, MESS, false);
    expect(m.authRepo.setBanned).toHaveBeenCalledWith(USER, true);
    expect(m.audit.insert.mock.calls[0]![0]).toMatchObject({
      action: 'student.deactivate', entity_id: USER, actor_id: ADMIN, metadata: { reason: 'Left the hostel', student_code: 'S00042' },
    });
  });

  it('re-activates a disabled student and lifts the ban', async () => {
    m.students.findInMess.mockResolvedValue(studentRow({ is_active: false }));
    m.students.setActive.mockResolvedValue(studentRow());
    const res = await setStatus({ is_active: true });
    expect(res.status).toBe(200);
    expect(m.authRepo.setBanned).toHaveBeenCalledWith(USER, false);
    expect(m.audit.insert.mock.calls[0]![0].action).toBe('student.activate');
  });

  it('a reason is mandatory for deactivation', async () => {
    expect((await setStatus({ is_active: false })).status).toBe(400);
    expect((await setStatus({ is_active: false, reason: 'no' })).status).toBe(400);
    expect((await setStatus({ is_active: 'no' })).status).toBe(400);
    expect((await setStatus({ is_active: true, role: 'admin' })).status).toBe(400);
    expect(m.students.setActive).not.toHaveBeenCalled();
  });

  it('does nothing (no write, no audit) when the status is already as requested', async () => {
    const res = await setStatus({ is_active: true });
    expect(res.status).toBe(200);
    expect(m.students.setActive).not.toHaveBeenCalled();
    expect(m.audit.insert).not.toHaveBeenCalled();
  });

  it('the profile flag is what blocks the API: a failing Supabase ban call does not undo it', async () => {
    m.authRepo.setBanned.mockRejectedValue(new AppError('SERVICE_UNAVAILABLE'));
    expect((await setStatus({ is_active: false, reason: 'Left the hostel' })).status).toBe(200);
    expect(m.audit.insert).toHaveBeenCalled();
  });

  it('students cannot change anyone\'s status', async () => {
    loginAs('student');
    expect((await setStatus({ is_active: false, reason: 'Left the hostel' })).status).toBe(403);
  });
});

// =====================================================================================================
describe('GET /admin/dashboard', () => {
  beforeEach(() => loginAs('admin'));

  it('is wired to the admin_dashboard_counts SQL function with mess-local dates', async () => {
    // The SQL itself is tested on a real PostgreSQL in tests/db/dashboard.test.ts; here the repository is stubbed.
    m.reports.dashboardCounts.mockResolvedValue({
      lunch_today: 120, dinner_today: 0, active_students: 152, students_with_active_subscription: 148, pending_payments: 4,
      expiring_soon: 9, revenue_month: 1105000, active_qr_codes: 12,
    });
    const res = await api('get', '/admin/dashboard');
    expect(res.status).toBe(200);
    expect(m.reports.dashboardCounts).toHaveBeenCalledWith({
      messId: MESS, date: TODAY, monthStart: '2026-11-01', monthNext: '2026-12-01', expiringBy: '2026-12-01',
    });
    expect(res.body.data).toEqual({
      server_time: '2026-11-25T07:00:00.000Z', date: TODAY,
      meals_today: { lunch: 120, dinner: 0 }, active_students: 152, students_with_active_subscription: 148,
      pending_payments: 4, expiring_within_7_days: 9, revenue_this_month: '1105000.00', active_qr_codes: 12,
    });
  });

  it('students cannot see it', async () => {
    loginAs('student');
    expect((await api('get', '/admin/dashboard')).status).toBe(403);
  });
});
