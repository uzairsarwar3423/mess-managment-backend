import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/AppError';
import { setClock } from '../../src/lib/clock';

const m = vi.hoisted(() => ({
  payments: {
    insert: vi.fn(), hasPendingPayment: vi.fn(), isAssetUsed: vi.fn(), findForStudent: vi.fn(), findForAdmin: vi.fn(),
    listForStudent: vi.fn(), listForAdmin: vi.fn(), cancelPending: vi.fn(), rejectPending: vi.fn(), approve: vi.fn(),
    findDuplicateSignals: vi.fn(),
  },
  accounts: { list: vi.fn(), findById: vi.fn(), insert: vi.fn(), update: vi.fn() },
  settings: { findMess: vi.fn(), findSettings: vi.fn(), updateSettings: vi.fn() },
  notifications: { notifyStudent: vi.fn() },
  audit: { insert: vi.fn() },
  students: { findById: vi.fn(), insert: vi.fn(), searchIds: vi.fn() },
  admins: { findById: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
  cld: {
    api: { resource: vi.fn() },
    uploader: { destroy: vi.fn() },
    utils: { api_sign_request: vi.fn() },
    url: vi.fn(),
  },
}));

vi.mock('../../src/modules/payments/payments.repository', () => m.payments);
vi.mock('../../src/modules/settings/paymentAccounts.repository', () => m.accounts);
vi.mock('../../src/modules/settings/settings.repository', () => m.settings);
vi.mock('../../src/modules/notifications/notifications.service', () => m.notifications);
vi.mock('../../src/modules/audit/audit.repository', () => m.audit);
vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);
vi.mock('../../src/lib/cloudinary', () => ({ getCloudinary: () => m.cld }));

import { createApp } from '../../src/app';

const app = createApp({ readinessCheck: async () => undefined });
const MESS = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const OTHER = '55555555-5555-4555-8555-555555555555';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const PAYMENT = '66666666-6666-4666-8666-666666666666';
const PUBLIC_ID = `mess-dev/payments/${USER}/0a1b2c3d-aaaa-bbbb-cccc-123456789abc`;

const settingsRow = () => ({
  mess_id: MESS, monthly_fee: 8500, currency: 'PKR', subscription_days: 30,
  lunch_start: '10:00:00', lunch_end: '16:00:00', dinner_start: '16:45:00', dinner_end: '20:45:00',
  expiry_reminder_days: 3, payment_instructions: null, geofence_enabled: false, latitude: null, longitude: null,
  geofence_radius_m: 150, updated_at: '2026-11-25T00:00:00Z',
});
const accountRow = (over: Record<string, unknown> = {}) => ({
  id: ACCOUNT, mess_id: MESS, method: 'jazzcash', account_title: 'Main Mess', account_number: '03111234567',
  bank_name: null, merchant_name: 'Main Mess Kitchen', instructions: null, display_order: 0, is_active: true,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...over,
});
const resource = (over: Record<string, unknown> = {}) => ({
  public_id: PUBLIC_ID, secure_url: `https://res.cloudinary.com/test/image/authenticated/${PUBLIC_ID}.jpg`,
  etag: 'etag123', bytes: 400_000, format: 'jpg', width: 1080, height: 2200, type: 'authenticated',
  created_at: new Date().toISOString(), ...over,
});
const paymentRow = (over: Record<string, unknown> = {}) => ({
  id: PAYMENT, mess_id: MESS, student_id: USER, payment_account_id: ACCOUNT, method: 'jazzcash',
  paid_to: { account_title: 'Main Mess', account_number: '03111234567', bank_name: null, merchant_name: 'Main Mess Kitchen' },
  amount: 8500, transaction_id: 'T24112500123', screenshot_public_id: PUBLIC_ID,
  screenshot_url: 'https://res.cloudinary.com/x', screenshot_etag: 'etag123', screenshot_bytes: 400_000,
  status: 'pending', rejection_reason: null, submitted_at: '2026-11-25T06:00:00Z', reviewed_by: null, reviewed_at: null,
  student: { id: USER, student_code: 'S00042', full_name: 'Ali Khan', phone: '03001234567', email: 'ali@example.com' },
  reviewer: null, subscription: null, ...over,
});
const subscriptionRow = () => ({
  id: '77777777-7777-4777-8777-777777777777', mess_id: MESS, student_id: USER, payment_id: PAYMENT,
  start_date: '2026-11-25', end_date: '2026-12-24', status: 'active', amount: 8500, created_at: '2026-11-25T07:00:00Z',
});

type Who = 'student' | 'admin' | 'super_admin';
function loginAs(who: Who, id = USER): void {
  m.verify.verifyAccessToken.mockResolvedValue({ sub: id, email: 'x@example.com' });
  if (who === 'student') {
    m.students.findById.mockResolvedValue({ id, mess_id: MESS, email: 'x@example.com', is_active: true });
    m.admins.findById.mockResolvedValue(null);
  } else {
    m.admins.findById.mockResolvedValue({ id, mess_id: MESS, email: 'x@example.com', role: who, is_active: true, full_name: 'Boss', phone: null, created_at: '2026-11-01T00:00:00Z' });
    m.students.findById.mockResolvedValue(null);
  }
}
const api = (method: 'get' | 'post', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', 'Bearer some.jwt.token');

beforeEach(() => {
  vi.resetAllMocks();
  setClock(() => new Date('2026-11-25T07:00:00Z'));
  m.settings.findMess.mockResolvedValue({ id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' });
  m.settings.findSettings.mockResolvedValue(settingsRow());
  m.audit.insert.mockResolvedValue(undefined);
  m.notifications.notifyStudent.mockResolvedValue(undefined);
  m.cld.url.mockImplementation((id: string) => `https://res.cloudinary.com/test/image/authenticated/s--SIG--/${id}`);
  m.cld.utils.api_sign_request.mockReturnValue('signature-value');
  m.cld.uploader.destroy.mockResolvedValue({ result: 'ok' });
  m.payments.hasPendingPayment.mockResolvedValue(false);
  m.payments.isAssetUsed.mockResolvedValue(false);
  m.accounts.findById.mockResolvedValue(accountRow());
});
afterEach(() => setClock(null));

// =====================================================================================================
describe('POST /uploads/signature', () => {
  it('returns server-chosen signed fields for a payment screenshot', async () => {
    loginAs('student');
    const res = await api('post', '/uploads/signature').send({ purpose: 'payment_screenshot' });
    expect(res.status).toBe(200);

    const [params, secret] = m.cld.utils.api_sign_request.mock.calls[0]!;
    expect(secret).toBe('test-secret');
    expect(Object.keys(params).sort()).toEqual(['allowed_formats', 'overwrite', 'public_id', 'timestamp', 'type', 'upload_preset']);
    expect(params).toMatchObject({ overwrite: 'false', type: 'authenticated', upload_preset: 'mess_payments_signed', allowed_formats: 'jpg,jpeg,png,webp' });
    expect(params.public_id).toMatch(new RegExp(`^mess-dev/payments/${USER}/[0-9a-f-]{36}$`));

    expect(res.body.data.upload_url).toBe('https://api.cloudinary.com/v1_1/test-cloud/image/upload');
    expect(res.body.data.fields).toMatchObject({ api_key: 'test-key', signature: 'signature-value', ...params });
    expect(res.body.data.max_bytes).toBe(2 * 1024 * 1024);
    expect(JSON.stringify(res.body)).not.toContain('test-secret'); // the API secret never leaves the server
  });

  it('profile images are public assets in the profiles folder', async () => {
    loginAs('student');
    await api('post', '/uploads/signature').send({ purpose: 'profile_image' });
    const [params] = m.cld.utils.api_sign_request.mock.calls[0]!;
    expect(params).toMatchObject({ type: 'upload', upload_preset: 'mess_profiles_signed' });
    expect(params.public_id).toContain(`/profiles/${USER}/`);
  });

  it('rejects unknown purposes and extra fields; admins cannot upload in v1', async () => {
    loginAs('student');
    expect((await api('post', '/uploads/signature').send({ purpose: 'video' })).status).toBe(400);
    expect((await api('post', '/uploads/signature').send({ purpose: 'payment_screenshot', folder: '../x' })).status).toBe(400);
    loginAs('admin');
    expect((await api('post', '/uploads/signature').send({ purpose: 'payment_screenshot' })).status).toBe(403);
  });
});

// =====================================================================================================
describe('POST /student/payments', () => {
  const body = () => ({ payment_account_id: ACCOUNT, transaction_id: 'T24112500123', screenshot_public_id: PUBLIC_ID });
  const submit = (b: object = body()) => api('post', '/student/payments').send(b);

  beforeEach(() => {
    loginAs('student');
    m.cld.api.resource.mockResolvedValue(resource());
    m.payments.insert.mockImplementation(async (p) => paymentRow({ ...p, id: PAYMENT, status: 'pending' }));
  });

  it('creates a pending payment with server-set amount, derived method and a paid_to snapshot', async () => {
    const res = await submit();
    expect(res.status).toBe(201);

    expect(m.payments.insert).toHaveBeenCalledWith({
      mess_id: MESS, student_id: USER, payment_account_id: ACCOUNT, method: 'jazzcash',
      paid_to: { account_title: 'Main Mess', account_number: '03111234567', bank_name: null, merchant_name: 'Main Mess Kitchen' },
      amount: '8500.00', transaction_id: 'T24112500123',
      screenshot_public_id: PUBLIC_ID, screenshot_url: resource().secure_url, screenshot_etag: 'etag123', screenshot_bytes: 400_000,
    });
    expect(res.body.data).toMatchObject({ id: PAYMENT, amount: '8500.00', method: 'jazzcash', status: 'pending' });
    expect(res.body.data.screenshot_url).toContain('s--SIG--'); // signed URL, not the raw secure_url
    expect(m.cld.api.resource).toHaveBeenCalledWith(PUBLIC_ID, { resource_type: 'image', type: 'authenticated' });
  });

  it.each([
    ['amount', { amount: 1 }],
    ['method', { method: 'bank' }],
    ['status', { status: 'approved' }],
    ['student_id', { student_id: OTHER }],
  ])('rejects a smuggled %s field (BR-09)', async (_l, extra) => {
    const res = await submit({ ...body(), ...extra });
    expect(res.status).toBe(400);
    expect(m.payments.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['too-short transaction id', { transaction_id: 'abc' }],
    ['transaction id with symbols', { transaction_id: 'T2411;DROP' }],
    ['bad account id', { payment_account_id: 'nope' }],
    ['tiny public id', { screenshot_public_id: 'x' }],
  ])('rejects %s', async (_l, patch) => {
    expect((await submit({ ...body(), ...patch })).status).toBe(400);
  });

  it('stops at an existing pending payment before touching Cloudinary (BR-08)', async () => {
    m.payments.hasPendingPayment.mockResolvedValue(true);
    const res = await submit();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PENDING_PAYMENT_EXISTS');
    expect(m.cld.api.resource).not.toHaveBeenCalled();
  });

  it('refuses inactive, unknown or other-mess accounts', async () => {
    m.accounts.findById.mockResolvedValue(accountRow({ is_active: false }));
    expect((await submit()).body.error.code).toBe('INVALID_PAYMENT_ACCOUNT');
    m.accounts.findById.mockResolvedValue(null);
    expect((await submit()).body.error.code).toBe('INVALID_PAYMENT_ACCOUNT');
    expect(m.accounts.findById).toHaveBeenCalledWith(ACCOUNT, MESS);
  });

  it("refuses another student's folder without touching or deleting their asset", async () => {
    const res = await submit({ ...body(), screenshot_public_id: `mess-dev/payments/${OTHER}/0a1b2c3d-aaaa-bbbb-cccc-123456789abc` });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_UPLOAD');
    expect(m.cld.api.resource).not.toHaveBeenCalled();
    expect(m.cld.uploader.destroy).not.toHaveBeenCalled();
  });

  it('refuses a profile-folder asset used as a payment screenshot', async () => {
    const res = await submit({ ...body(), screenshot_public_id: `mess-dev/profiles/${USER}/0a1b2c3d-aaaa-bbbb-cccc-123456789abc` });
    expect(res.body.error.code).toBe('INVALID_UPLOAD');
  });

  it('refuses a screenshot that is already attached to another payment', async () => {
    m.payments.isAssetUsed.mockResolvedValue(true);
    expect((await submit()).body.error.code).toBe('INVALID_UPLOAD');
    expect(m.payments.insert).not.toHaveBeenCalled();
  });

  it('refuses and deletes assets with a wrong format, too large size or odd dimensions', async () => {
    for (const bad of [{ format: 'gif' }, { bytes: 3_000_000 }, { width: 10, height: 20 }]) {
      m.cld.uploader.destroy.mockClear();
      m.cld.api.resource.mockResolvedValue(resource(bad));
      const res = await submit();
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_UPLOAD');
      expect(m.cld.uploader.destroy).toHaveBeenCalledWith(PUBLIC_ID, { resource_type: 'image', type: 'authenticated', invalidate: true });
    }
    expect(m.payments.insert).not.toHaveBeenCalled();
  });

  it('refuses a stale upload, a missing asset and an asset of the wrong delivery type', async () => {
    m.cld.api.resource.mockResolvedValue(resource({ created_at: '2026-11-25T01:00:00Z' })); // 6 h before the frozen clock
    expect((await submit()).body.error.code).toBe('INVALID_UPLOAD');
    m.cld.api.resource.mockRejectedValue({ error: { http_code: 404, message: 'not found' } });
    expect((await submit()).body.error.code).toBe('INVALID_UPLOAD');
    m.cld.api.resource.mockResolvedValue(resource({ type: 'upload' }));
    expect((await submit()).body.error.code).toBe('INVALID_UPLOAD');
  });

  it('reports Cloudinary outages as 503 (nothing stored)', async () => {
    m.cld.api.resource.mockRejectedValue(new Error('network'));
    const res = await submit();
    expect(res.status).toBe(503);
    expect(m.payments.insert).not.toHaveBeenCalled();
  });

  it('maps a reused transaction id and cleans up the uploaded image', async () => {
    m.payments.insert.mockRejectedValue(new AppError('DUPLICATE_TRANSACTION'));
    const res = await submit();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(m.cld.uploader.destroy).toHaveBeenCalledWith(PUBLIC_ID, expect.objectContaining({ type: 'authenticated' }));
  });

  it('only students can submit', async () => {
    loginAs('admin');
    expect((await submit()).status).toBe(403);
  });
});

// =====================================================================================================
describe('student reads and cancel', () => {
  beforeEach(() => loginAs('student'));

  it('lists own payments with paging meta', async () => {
    m.payments.listForStudent.mockResolvedValue({ rows: [paymentRow(), paymentRow({ id: 'p2', status: 'approved', subscription: { id: 'sub1' } })], total: 45 });
    const res = await api('get', '/student/payments?status=approved&page=2&limit=20');
    expect(res.status).toBe(200);
    expect(m.payments.listForStudent).toHaveBeenCalledWith(USER, 'approved', 20, 39);
    expect(res.body.meta).toEqual({ page: 2, limit: 20, total: 45, total_pages: 3 });
    expect(res.body.data[1].subscription_id).toBe('sub1');
    expect(res.body.data[0].student).toBeUndefined();
  });

  it('rejects an invalid status filter', async () => {
    expect((await api('get', '/student/payments?status=bogus')).status).toBe(400);
  });

  it("a payment of another student is NOT_FOUND (queries are scoped to the caller)", async () => {
    m.payments.findForStudent.mockResolvedValue(null);
    const res = await api('get', `/student/payments/${PAYMENT}`);
    expect(res.status).toBe(404);
    expect(m.payments.findForStudent).toHaveBeenCalledWith(PAYMENT, USER);
  });

  it('shows the rejection reason and reviewer name', async () => {
    m.payments.findForStudent.mockResolvedValue(
      paymentRow({ status: 'rejected', rejection_reason: 'Amount mismatch', reviewer: { id: 'a', full_name: 'Sara' }, reviewed_at: '2026-11-25T08:00:00Z' }),
    );
    const res = await api('get', `/student/payments/${PAYMENT}`);
    expect(res.body.data).toMatchObject({ status: 'rejected', rejection_reason: 'Amount mismatch', reviewed_by_name: 'Sara' });
  });

  it('cancels a pending payment', async () => {
    m.payments.cancelPending.mockResolvedValue(paymentRow({ status: 'cancelled' }));
    const res = await api('post', `/student/payments/${PAYMENT}/cancel`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    expect(m.payments.cancelPending).toHaveBeenCalledWith(PAYMENT, USER);
  });

  it('cannot cancel a reviewed payment, or one that does not exist', async () => {
    m.payments.cancelPending.mockResolvedValue(null);
    m.payments.findForStudent.mockResolvedValueOnce(paymentRow({ status: 'approved' }));
    expect((await api('post', `/student/payments/${PAYMENT}/cancel`).send({})).body.error.code).toBe('PAYMENT_NOT_PENDING');
    m.payments.findForStudent.mockResolvedValueOnce(null);
    expect((await api('post', `/student/payments/${PAYMENT}/cancel`).send({})).status).toBe(404);
  });
});

// =====================================================================================================
describe('admin review queue', () => {
  beforeEach(() => loginAs('admin', OTHER));

  it('defaults to the pending queue and scopes to the admin mess', async () => {
    m.payments.listForAdmin.mockResolvedValue({ rows: [paymentRow()], total: 1 });
    const res = await api('get', '/admin/payments');
    expect(res.status).toBe(200);
    expect(m.payments.listForAdmin).toHaveBeenCalledWith({
      messId: MESS, status: 'pending', method: undefined, paymentAccountId: undefined, q: undefined, studentId: undefined,
      from: 0, to: 19,
    });
    expect(res.body.data[0]).toEqual({
      id: PAYMENT, student: { id: USER, student_code: 'S00042', full_name: 'Ali Khan' }, amount: '8500.00', method: 'jazzcash',
      transaction_id: 'T24112500123', status: 'pending', submitted_at: '2026-11-25T06:00:00Z', reviewed_at: null,
    });
  });

  it('supports history (status=all), filters, search and mess-time date ranges', async () => {
    m.payments.listForAdmin.mockResolvedValue({ rows: [], total: 0 });
    const res = await api('get', `/admin/payments?status=all&method=bank&q=ali&from=2026-11-01&to=2026-11-30&payment_account_id=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(m.payments.listForAdmin).toHaveBeenCalledWith(expect.objectContaining({
      status: 'all', method: 'bank', q: 'ali', paymentAccountId: ACCOUNT,
      fromIso: '2026-10-31T19:00:00.000Z',   // 1 Nov 00:00 Karachi
      toIso: '2026-11-30T19:00:00.000Z',     // exclusive: start of 1 Dec Karachi
    }));
  });

  it('validates query parameters', async () => {
    expect((await api('get', '/admin/payments?status=weird')).status).toBe(400);
    expect((await api('get', '/admin/payments?from=2026-13-40')).status).toBe(400);
    expect((await api('get', '/admin/payments?limit=1000')).status).toBe(400);
  });

  it('detail includes the permanent signed screenshot URL, paid_to and duplicate hints', async () => {
    m.payments.findForAdmin.mockResolvedValue(paymentRow());
    m.payments.findDuplicateSignals.mockResolvedValue({
      sameTransaction: [{ id: 'old', status: 'rejected', student_name: 'Bilal' }],
      sameScreenshot: [],
    });
    const res = await api('get', `/admin/payments/${PAYMENT}`);
    expect(res.status).toBe(200);
    expect(m.payments.findForAdmin).toHaveBeenCalledWith(PAYMENT, MESS);
    expect(res.body.data.screenshot_url).toContain('s--SIG--');
    expect(res.body.data.screenshot_url_expires_at).toBeUndefined();
    expect(res.body.data.paid_to.account_number).toBe('03111234567');
    expect(res.body.data.student).toMatchObject({ phone: '03001234567', email: 'ali@example.com' });
    expect(res.body.data.duplicate_signals).toEqual({
      same_transaction_id: [{ payment_id: 'old', status: 'rejected', student_name: 'Bilal' }],
      same_screenshot: [],
    });
  });

  it("a payment from another mess is NOT_FOUND", async () => {
    m.payments.findForAdmin.mockResolvedValue(null);
    expect((await api('get', `/admin/payments/${PAYMENT}`)).status).toBe(404);
  });

  it('students cannot use admin routes', async () => {
    loginAs('student');
    expect((await api('get', '/admin/payments')).status).toBe(403);
    expect((await api('post', `/admin/payments/${PAYMENT}/approve`).send({})).status).toBe(403);
  });
});

// =====================================================================================================
describe('POST /admin/payments/:id/approve (any admin, D-24)', () => {
  beforeEach(() => loginAs('admin', OTHER));

  it('approves through the SQL function, notifies the student and returns the subscription', async () => {
    m.payments.findForAdmin
      .mockResolvedValueOnce(paymentRow())
      .mockResolvedValueOnce(paymentRow({ status: 'approved', reviewed_at: '2026-11-25T07:00:00Z' }));
    m.payments.approve.mockResolvedValue(subscriptionRow());

    const res = await api('post', `/admin/payments/${PAYMENT}/approve`).send({});
    expect(res.status).toBe(200);
    expect(m.payments.approve).toHaveBeenCalledWith(PAYMENT, OTHER);
    expect(res.body.data.payment).toEqual({ id: PAYMENT, status: 'approved', reviewed_at: '2026-11-25T07:00:00Z' });
    expect(res.body.data.subscription).toMatchObject({
      status: 'active', start_date: '2026-11-25', end_date: '2026-12-24', amount: '8500.00', days_remaining: 30, is_expiring_soon: false,
    });
    expect(m.notifications.notifyStudent).toHaveBeenCalledWith(expect.objectContaining({
      studentId: USER, type: 'payment_approved', body: 'Your subscription is active until 24 Dec 2026.',
      data: { payment_id: PAYMENT, subscription_id: subscriptionRow().id },
    }));
    // The audit row is written inside the SQL function (same transaction), not by the service.
    expect(m.audit.insert).not.toHaveBeenCalled();
  });

  it('does not call the SQL function for a payment outside the admin mess', async () => {
    m.payments.findForAdmin.mockResolvedValue(null);
    expect((await api('post', `/admin/payments/${PAYMENT}/approve`).send({})).status).toBe(404);
    expect(m.payments.approve).not.toHaveBeenCalled();
  });

  it('tells the losing admin who already decided, and when', async () => {
    m.payments.findForAdmin
      .mockResolvedValueOnce(paymentRow())
      .mockResolvedValueOnce(paymentRow({ status: 'approved', reviewed_at: '2026-11-25T06:59:00Z', reviewer: { id: 'x', full_name: 'Sara' } }));
    m.payments.approve.mockRejectedValue(new AppError('PAYMENT_NOT_PENDING'));
    const res = await api('post', `/admin/payments/${PAYMENT}/approve`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_NOT_PENDING');
    expect(res.body.error.details).toEqual({ status: 'approved', reviewed_by: 'Sara', reviewed_at: '2026-11-25T06:59:00Z' });
    expect(m.notifications.notifyStudent).not.toHaveBeenCalled();
  });

  it('propagates "admin not authorized" from the SQL function', async () => {
    m.payments.findForAdmin.mockResolvedValue(paymentRow());
    m.payments.approve.mockRejectedValue(new AppError('FORBIDDEN'));
    expect((await api('post', `/admin/payments/${PAYMENT}/approve`).send({})).status).toBe(403);
  });

  it('a notification failure cannot undo or fail an approval', async () => {
    m.payments.findForAdmin.mockResolvedValue(paymentRow());
    m.payments.approve.mockResolvedValue(subscriptionRow());
    m.notifications.notifyStudent.mockResolvedValue(undefined); // notifyStudent itself never throws
    expect((await api('post', `/admin/payments/${PAYMENT}/approve`).send({})).status).toBe(200);
  });

  it('rejects a body with extra fields (e.g. a smuggled amount)', async () => {
    expect((await api('post', `/admin/payments/${PAYMENT}/approve`).send({ amount: 1 })).status).toBe(400);
    expect(m.payments.approve).not.toHaveBeenCalled();
  });
});

// =====================================================================================================
describe('POST /admin/payments/:id/reject', () => {
  beforeEach(() => loginAs('admin', OTHER));
  const reject = (reason: unknown = 'Amount does not match') => api('post', `/admin/payments/${PAYMENT}/reject`).send({ reason });

  it('rejects with a reason, audits it and notifies the student (BR-18, BR-19)', async () => {
    m.payments.findForAdmin.mockResolvedValue(paymentRow());
    m.payments.rejectPending.mockResolvedValue(paymentRow({ status: 'rejected', reviewed_at: '2026-11-25T07:00:00Z' }));

    const res = await reject();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: PAYMENT, status: 'rejected', rejection_reason: 'Amount does not match', reviewed_at: '2026-11-25T07:00:00Z' });
    expect(m.payments.rejectPending).toHaveBeenCalledWith(PAYMENT, MESS, OTHER, 'Amount does not match', '2026-11-25T07:00:00.000Z');

    expect(m.audit.insert.mock.calls[0]![0]).toMatchObject({
      action: 'payment.reject', entity_id: PAYMENT, actor_id: OTHER, actor_role: 'admin',
      metadata: { student_id: USER, reason: 'Amount does not match', transaction_id: 'T24112500123', amount: '8500' },
    });
    expect(m.notifications.notifyStudent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'payment_rejected', body: 'Reason: Amount does not match', data: { payment_id: PAYMENT },
    }));
  });

  it.each([['null', null], ['too short', 'no'], ['too long', 'x'.repeat(301)], ['not a string', 5]])(
    'requires a proper reason (%s)',
    async (_l, reason) => {
      const res = await reject(reason);
      expect(res.status).toBe(400);
      expect(m.payments.rejectPending).not.toHaveBeenCalled();
    },
  );

  it('loses gracefully when someone else decided first', async () => {
    m.payments.findForAdmin
      .mockResolvedValueOnce(paymentRow())
      .mockResolvedValueOnce(paymentRow({ status: 'approved', reviewed_at: '2026-11-25T06:59:00Z', reviewer: { id: 'x', full_name: 'Sara' } }));
    m.payments.rejectPending.mockResolvedValue(null);
    const res = await reject();
    expect(res.status).toBe(409);
    expect(res.body.error.details.reviewed_by).toBe('Sara');
    expect(m.audit.insert).not.toHaveBeenCalled();
    expect(m.notifications.notifyStudent).not.toHaveBeenCalled();
  });

  it('is scoped to the admin mess', async () => {
    m.payments.findForAdmin.mockResolvedValue(null);
    expect((await reject()).status).toBe(404);
    expect(m.payments.rejectPending).not.toHaveBeenCalled();
  });
});
