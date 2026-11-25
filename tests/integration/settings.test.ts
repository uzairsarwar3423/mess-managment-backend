import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  settings: { findMess: vi.fn(), findSettings: vi.fn(), updateSettings: vi.fn() },
  accounts: { list: vi.fn(), findById: vi.fn(), insert: vi.fn(), update: vi.fn() },
  payments: { hasPendingPayment: vi.fn() },
  audit: { insert: vi.fn() },
  students: { findById: vi.fn(), insert: vi.fn() },
  admins: { findById: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
}));

vi.mock('../../src/modules/settings/settings.repository', () => m.settings);
vi.mock('../../src/modules/settings/paymentAccounts.repository', () => m.accounts);
vi.mock('../../src/modules/payments/payments.repository', () => m.payments);
vi.mock('../../src/modules/audit/audit.repository', () => m.audit);
vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);

import { createApp } from '../../src/app';

const app = createApp({ readinessCheck: async () => undefined });
const MESS = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';

const mess = { id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' };
const settingsRow = (over: Record<string, unknown> = {}) => ({
  mess_id: MESS,
  monthly_fee: 8500,
  currency: 'PKR',
  subscription_days: 30,
  lunch_start: '10:00:00',
  lunch_end: '16:00:00',
  dinner_start: '16:45:00',
  dinner_end: '20:45:00',
  expiry_reminder_days: 3,
  payment_instructions: null,
  geofence_enabled: false,
  latitude: null,
  longitude: null,
  geofence_radius_m: 150,
  updated_at: '2026-11-25T00:00:00Z',
  ...over,
});
const accountRow = (over: Record<string, unknown> = {}) => ({
  id: ACCOUNT,
  mess_id: MESS,
  method: 'easypaisa',
  account_title: 'Main Mess',
  account_number: '03001234567',
  bank_name: null,
  merchant_name: null,
  instructions: null,
  display_order: 0,
  is_active: true,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...over,
});

type Who = 'student' | 'admin' | 'super_admin';
function loginAs(who: Who): void {
  m.verify.verifyAccessToken.mockResolvedValue({ sub: USER, email: 'x@example.com' });
  if (who === 'student') {
    m.students.findById.mockResolvedValue({ id: USER, mess_id: MESS, email: 'x@example.com', is_active: true });
    m.admins.findById.mockResolvedValue(null);
  } else {
    m.admins.findById.mockResolvedValue({ id: USER, mess_id: MESS, email: 'x@example.com', role: who, is_active: true, full_name: 'Boss', phone: null, created_at: '2026-11-01T00:00:00Z' });
    m.students.findById.mockResolvedValue(null);
  }
}
const api = (method: 'get' | 'patch' | 'post', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', 'Bearer some.jwt.token');

beforeEach(() => {
  vi.resetAllMocks();
  m.settings.findMess.mockResolvedValue(mess);
  m.settings.findSettings.mockResolvedValue(settingsRow());
  m.audit.insert.mockResolvedValue(undefined);
});

describe('role guards at the mount points', () => {
  it('rejects unauthenticated calls', async () => {
    expect((await request(app).get('/api/v1/admin/settings')).status).toBe(401);
    expect((await request(app).get('/api/v1/student/payment-instructions')).status).toBe(401);
  });

  it('students cannot reach admin routes and admins cannot reach student routes', async () => {
    loginAs('student');
    expect((await api('get', '/admin/settings')).status).toBe(403);
    expect((await api('get', '/admin/payment-accounts')).status).toBe(403);
    loginAs('admin');
    expect((await api('get', '/student/payment-instructions')).status).toBe(403);
  });

  it('plain admins can read but not change settings or accounts (super admin only)', async () => {
    loginAs('admin');
    expect((await api('get', '/admin/settings')).status).toBe(200);
    expect((await api('patch', '/admin/settings').send({ monthly_fee: 9000 })).status).toBe(403);
    expect((await api('post', '/admin/payment-accounts').send({})).status).toBe(403);
    expect((await api('patch', `/admin/payment-accounts/${ACCOUNT}`).send({ is_active: false })).status).toBe(403);
    expect(m.settings.updateSettings).not.toHaveBeenCalled();
    expect(m.accounts.insert).not.toHaveBeenCalled();
  });
});

describe('GET /admin/settings and /admin/me', () => {
  it('returns the documented shape', async () => {
    loginAs('admin');
    const res = await api('get', '/admin/settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      mess: { id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' },
      monthly_fee: '8500.00',
      currency: 'PKR',
      subscription_days: 30,
      meal_windows: { lunch: { start: '10:00', end: '16:00' }, dinner: { start: '16:45', end: '20:45' } },
      expiry_reminder_days: 3,
      payment_instructions: null,
      geofence: { enabled: false, latitude: null, longitude: null, radius_m: 150 },
      updated_at: '2026-11-25T00:00:00Z',
    });
  });

  it('fails clearly when the seed was not run', async () => {
    loginAs('admin');
    m.settings.findSettings.mockResolvedValue(null);
    const res = await api('get', '/admin/settings');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('GET /admin/me returns the caller', async () => {
    loginAs('super_admin');
    const res = await api('get', '/admin/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: USER, role: 'super_admin' });
  });
});

describe('PATCH /admin/settings', () => {
  it('updates the fee and writes before/after to the audit log', async () => {
    loginAs('super_admin');
    m.settings.updateSettings.mockResolvedValue(settingsRow({ monthly_fee: 9000 }));
    const res = await api('patch', '/admin/settings').send({ monthly_fee: 9000 });

    expect(res.status).toBe(200);
    expect(res.body.data.monthly_fee).toBe('9000.00');
    expect(m.settings.updateSettings).toHaveBeenCalledWith(MESS, { monthly_fee: '9000.00' }, USER);
    const entry = m.audit.insert.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: 'settings.update', actor_id: USER, actor_role: 'super_admin', mess_id: MESS });
    expect(entry.metadata).toEqual({ before: { monthly_fee: '8500.00' }, after: { monthly_fee: '9000.00' } });
  });

  it('does nothing (no write, no audit) when nothing actually changes', async () => {
    loginAs('super_admin');
    const res = await api('patch', '/admin/settings').send({ subscription_days: 30 });
    expect(res.status).toBe(200);
    expect(m.settings.updateSettings).not.toHaveBeenCalled();
    expect(m.audit.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['empty body', {}],
    ['unknown field', { monthly_fee: 9000, currency: 'USD' }],
    ['negative fee', { monthly_fee: -1 }],
    ['bad time', { meal_windows: { lunch: { start: '25:00', end: '26:00' } } }],
    ['overlapping windows', { meal_windows: { lunch: { start: '10:00', end: '17:00' } } }],
    ['geofence without a location', { geofence: { enabled: true } }],
  ])('rejects %s', async (_label, body) => {
    loginAs('super_admin');
    const res = await api('patch', '/admin/settings').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(m.settings.updateSettings).not.toHaveBeenCalled();
  });

  it('turns the geofence on together with the mess location', async () => {
    loginAs('super_admin');
    m.settings.updateSettings.mockResolvedValue(
      settingsRow({ geofence_enabled: true, latitude: 31.52, longitude: 74.35, geofence_radius_m: 150 }),
    );
    const res = await api('patch', '/admin/settings').send({ geofence: { enabled: true, latitude: 31.52, longitude: 74.35 } });
    expect(res.status).toBe(200);
    expect(m.settings.updateSettings).toHaveBeenCalledWith(
      MESS,
      { geofence_enabled: true, latitude: 31.52, longitude: 74.35 },
      USER,
    );
    expect(res.body.data.geofence).toEqual({ enabled: true, latitude: 31.52, longitude: 74.35, radius_m: 150 });
  });

  it('a failed audit write fails the request (admin write actions must be recorded)', async () => {
    loginAs('super_admin');
    m.settings.updateSettings.mockResolvedValue(settingsRow({ monthly_fee: 9000 }));
    m.audit.insert.mockRejectedValue(new Error('db down'));
    const res = await api('patch', '/admin/settings').send({ monthly_fee: 9000 });
    expect(res.status).toBe(500);
  });
});

describe('payment accounts (admin)', () => {
  it('lists active accounts by default and all with include_inactive=true', async () => {
    loginAs('admin');
    m.accounts.list.mockResolvedValue([accountRow(), accountRow({ id: 'x', is_active: false })]);
    const res = await api('get', '/admin/payment-accounts');
    expect(res.status).toBe(200);
    expect(m.accounts.list).toHaveBeenLastCalledWith(MESS, false);
    expect(res.body.data[0]).toMatchObject({ id: ACCOUNT, method: 'easypaisa', display_order: 0, is_active: true });

    await api('get', '/admin/payment-accounts?include_inactive=true');
    expect(m.accounts.list).toHaveBeenLastCalledWith(MESS, true);

    expect((await api('get', '/admin/payment-accounts?include_inactive=maybe')).status).toBe(400);
  });

  it('creates an EasyPaisa account and audits it', async () => {
    loginAs('super_admin');
    m.accounts.insert.mockResolvedValue(accountRow());
    const res = await api('post', '/admin/payment-accounts').send({
      method: 'easypaisa',
      account_title: 'Main Mess',
      account_number: '0300-1234567',
    });
    expect(res.status).toBe(201);
    expect(m.accounts.insert).toHaveBeenCalledWith({
      mess_id: MESS,
      method: 'easypaisa',
      account_title: 'Main Mess',
      account_number: '0300-1234567',
      bank_name: null,
      merchant_name: null,
      instructions: null,
      display_order: 0,
      created_by: USER,
    });
    expect(m.audit.insert.mock.calls[0]![0]).toMatchObject({ action: 'payment_account.create', entity_id: ACCOUNT });
  });

  it('accepts all five methods and rejects anything else', async () => {
    loginAs('super_admin');
    m.accounts.insert.mockResolvedValue(accountRow());
    for (const method of ['easypaisa', 'jazzcash', 'nayapay', 'sadapay']) {
      const res = await api('post', '/admin/payment-accounts').send({ method, account_title: 'Main Mess', account_number: '03001234567' });
      expect(res.status).toBe(201);
    }
    const bank = await api('post', '/admin/payment-accounts').send({ method: 'bank', account_title: 'Main Mess', account_number: 'PK36MEZN0000001234567890', bank_name: 'Meezan Bank' });
    expect(bank.status).toBe(201);
    const bad = await api('post', '/admin/payment-accounts').send({ method: 'paypal', account_title: 'Main Mess', account_number: '03001234567' });
    expect(bad.status).toBe(400);
  });

  it('requires the bank name for bank accounts', async () => {
    loginAs('super_admin');
    const res = await api('post', '/admin/payment-accounts').send({ method: 'bank', account_title: 'Main Mess', account_number: 'PK36MEZN0000001234567890' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Bank name/);
    expect(m.accounts.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['short number', { account_number: '12' }],
    ['symbols in number', { account_number: '0300<script>' }],
    ['extra field', { is_active: false }],
  ])('rejects %s', async (_l, patch) => {
    loginAs('super_admin');
    const res = await api('post', '/admin/payment-accounts').send({ method: 'jazzcash', account_title: 'Main Mess', account_number: '03001234567', ...patch });
    expect(res.status).toBe(400);
  });

  it('hides an account (is_active=false) with a before/after audit entry', async () => {
    loginAs('super_admin');
    m.accounts.findById.mockResolvedValue(accountRow());
    m.accounts.update.mockResolvedValue(accountRow({ is_active: false }));
    const res = await api('patch', `/admin/payment-accounts/${ACCOUNT}`).send({ is_active: false });
    expect(res.status).toBe(200);
    expect(m.accounts.update).toHaveBeenCalledWith(ACCOUNT, MESS, { is_active: false });
    expect(m.audit.insert.mock.calls[0]![0].metadata).toEqual({ before: { is_active: true }, after: { is_active: false } });
  });

  it('checks the bank rule on the merged result when the method changes', async () => {
    loginAs('super_admin');
    m.accounts.findById.mockResolvedValue(accountRow());
    const res = await api('patch', `/admin/payment-accounts/${ACCOUNT}`).send({ method: 'bank' });
    expect(res.status).toBe(400);
    expect(m.accounts.update).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown account and 400 for a bad id', async () => {
    loginAs('super_admin');
    m.accounts.findById.mockResolvedValue(null);
    expect((await api('patch', `/admin/payment-accounts/${ACCOUNT}`).send({ is_active: false })).status).toBe(404);
    expect((await api('patch', '/admin/payment-accounts/not-a-uuid').send({ is_active: false })).status).toBe(400);
  });

  it('scopes lookups to the caller\'s mess', async () => {
    loginAs('super_admin');
    m.accounts.findById.mockResolvedValue(null);
    await api('patch', `/admin/payment-accounts/${ACCOUNT}`).send({ is_active: false });
    expect(m.accounts.findById).toHaveBeenCalledWith(ACCOUNT, MESS);
  });
});

describe('GET /student/payment-instructions', () => {
  it('returns the fee, only the student-safe account fields, and the pending flag', async () => {
    loginAs('student');
    m.accounts.list.mockResolvedValue([
      accountRow({ merchant_name: 'Main Mess Kitchen' }),
      accountRow({ id: 'b', method: 'bank', bank_name: 'Meezan Bank', account_number: 'PK36MEZN0000001234567890', display_order: 1 }),
    ]);
    m.payments.hasPendingPayment.mockResolvedValue(true);

    const res = await api('get', '/student/payment-instructions');
    expect(res.status).toBe(200);
    expect(m.accounts.list).toHaveBeenCalledWith(MESS, false); // active only
    expect(m.payments.hasPendingPayment).toHaveBeenCalledWith(USER);
    expect(res.body.data).toMatchObject({
      monthly_fee: '8500.00',
      currency: 'PKR',
      subscription_days: 30,
      instructions: null,
      has_pending_payment: true,
    });
    expect(res.body.data.accounts).toHaveLength(2);
    expect(res.body.data.accounts[0]).toEqual({
      id: ACCOUNT,
      method: 'easypaisa',
      account_title: 'Main Mess',
      account_number: '03001234567',
      bank_name: null,
      merchant_name: 'Main Mess Kitchen',
      instructions: null,
    });
    expect(res.body.data.accounts[0].is_active).toBeUndefined();
    expect(res.body.data.accounts[0].display_order).toBeUndefined();
  });
});
