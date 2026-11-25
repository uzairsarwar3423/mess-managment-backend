import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/AppError';

const m = vi.hoisted(() => ({
  admins: {
    findById: vi.fn(), findInMess: vi.fn(), list: vi.fn(), insert: vi.fn(), update: vi.fn(),
    countActiveSuperAdmins: vi.fn(), namesByIds: vi.fn(),
  },
  students: { findById: vi.fn() },
  authRepo: { createVerifiedUser: vi.fn(), deleteUser: vi.fn(), setBanned: vi.fn() },
  auditRepo: { insert: vi.fn(), list: vi.fn() },
  settings: { findMess: vi.fn(), findSettings: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
}));
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/auth/auth.repository', () => m.authRepo);
vi.mock('../../src/modules/audit/audit.repository', () => m.auditRepo);
vi.mock('../../src/modules/settings/settings.repository', () => m.settings);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);

import { createApp } from '../../src/app';

const app = createApp({ readinessCheck: async () => undefined });
const MESS = '11111111-1111-4111-8111-111111111111';
const BOSS = '55555555-5555-4555-8555-555555555555';
const OTHER = '66666666-6666-4666-8666-666666666666';

const row = (over: Record<string, unknown> = {}) => ({
  id: OTHER, mess_id: MESS, email: 'sara@example.com', full_name: 'Sara', phone: null, role: 'admin', is_active: true, created_at: 'x', ...over,
});

function loginAs(role: 'admin' | 'super_admin'): void {
  m.verify.verifyAccessToken.mockResolvedValue({ sub: BOSS, email: 'boss@example.com' });
  m.admins.findById.mockResolvedValue(row({ id: BOSS, role, full_name: 'Boss' }));
  m.students.findById.mockResolvedValue(null);
}
const api = (method: 'get' | 'post' | 'patch', path: string) => request(app)[method](`/api/v1/admin${path}`).set('Authorization', 'Bearer t');

beforeEach(() => {
  vi.resetAllMocks();
  m.auditRepo.insert.mockResolvedValue(undefined);
  m.settings.findMess.mockResolvedValue({ id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' });
  m.settings.findSettings.mockResolvedValue({
    mess_id: MESS, monthly_fee: 8500, currency: 'PKR', subscription_days: 30, lunch_start: '10:00:00', lunch_end: '16:00:00',
    dinner_start: '16:45:00', dinner_end: '20:45:00', expiry_reminder_days: 3, payment_instructions: null,
    geofence_enabled: false, latitude: null, longitude: null, geofence_radius_m: 150, updated_at: 'x',
  });
  loginAs('super_admin');
});

describe('only a super admin manages admins (BR-17)', () => {
  it('plain admins and students are refused on every management route', async () => {
    loginAs('admin');
    expect((await api('get', '/admins')).status).toBe(403);
    expect((await api('post', '/admins').send({})).status).toBe(403);
    expect((await api('patch', `/admins/${OTHER}`).send({ is_active: false })).status).toBe(403);
    expect((await api('get', '/audit-logs')).status).toBe(403);
    expect((await api('get', '/me')).status).toBe(200); // /me stays open to every admin
    expect(m.authRepo.createVerifiedUser).not.toHaveBeenCalled();
  });
});

describe('POST /admin/admins', () => {
  const body = { full_name: 'Sara Khan', email: 'Sara@Example.com', role: 'admin', temporary_password: 'Temp12345' };

  it('creates a verified login + the admins row, and audits it without the password', async () => {
    m.authRepo.createVerifiedUser.mockResolvedValue(OTHER);
    m.admins.insert.mockResolvedValue(row({ full_name: 'Sara Khan' }));
    const res = await api('post', '/admins').send(body);
    expect(res.status).toBe(201);
    expect(m.authRepo.createVerifiedUser).toHaveBeenCalledWith('sara@example.com', 'Temp12345'); // email lower-cased
    expect(m.admins.insert).toHaveBeenCalledWith({ id: OTHER, mess_id: MESS, email: 'sara@example.com', full_name: 'Sara Khan', phone: null, role: 'admin', created_by: BOSS });
    const entry = m.auditRepo.insert.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: 'admin.create', entity_id: OTHER, actor_id: BOSS });
    expect(JSON.stringify(entry)).not.toContain('Temp12345');
    expect(JSON.stringify(res.body)).not.toContain('Temp12345');
  });

  it('rolls the login back if the admins row cannot be created', async () => {
    m.authRepo.createVerifiedUser.mockResolvedValue(OTHER);
    m.admins.insert.mockRejectedValue(new AppError('INTERNAL_ERROR'));
    m.authRepo.deleteUser.mockResolvedValue(undefined);
    expect((await api('post', '/admins').send(body)).status).toBe(500);
    expect(m.authRepo.deleteUser).toHaveBeenCalledWith(OTHER);
  });

  it('an email that already has an account is refused; bad input never reaches Supabase', async () => {
    m.authRepo.createVerifiedUser.mockRejectedValue(new AppError('EMAIL_ALREADY_REGISTERED'));
    expect((await api('post', '/admins').send(body)).status).toBe(409);
    m.authRepo.createVerifiedUser.mockClear();
    for (const bad of [{ role: 'owner' }, { temporary_password: 'weak' }, { email: 'nope' }, { is_active: true }]) {
      expect((await api('post', '/admins').send({ ...body, ...bad })).status).toBe(400);
    }
    expect(m.authRepo.createVerifiedUser).not.toHaveBeenCalled();
  });
});

describe('PATCH /admin/admins/:id', () => {
  const patch = (id: string, b: object) => api('patch', `/admins/${id}`).send(b);

  it('disables an admin: audit with before/after and a Supabase ban', async () => {
    m.admins.findInMess.mockResolvedValue(row());
    m.admins.update.mockResolvedValue(row({ is_active: false }));
    m.authRepo.setBanned.mockResolvedValue(undefined);
    const res = await patch(OTHER, { is_active: false });
    expect(res.status).toBe(200);
    expect(m.admins.update).toHaveBeenCalledWith(OTHER, MESS, { is_active: false });
    expect(m.authRepo.setBanned).toHaveBeenCalledWith(OTHER, true);
    expect(m.auditRepo.insert.mock.calls[0]![0]).toMatchObject({
      action: 'admin.update', entity_id: OTHER, metadata: { before: { is_active: true }, after: { is_active: false } },
    });
  });

  it('nobody can change their own role or enabled flag, but can edit their own name', async () => {
    m.admins.findInMess.mockResolvedValue(row({ id: BOSS, role: 'super_admin' }));
    expect((await patch(BOSS, { role: 'admin' })).status).toBe(403);
    expect((await patch(BOSS, { is_active: false })).status).toBe(403);
    m.admins.update.mockResolvedValue(row({ id: BOSS, role: 'super_admin', full_name: 'Boss Two' }));
    expect((await patch(BOSS, { full_name: 'Boss Two' })).status).toBe(200);
  });

  it('the last active super admin can never be demoted or disabled', async () => {
    m.admins.findInMess.mockResolvedValue(row({ role: 'super_admin' }));
    m.admins.countActiveSuperAdmins.mockResolvedValue(1);
    for (const b of [{ role: 'admin' }, { is_active: false }]) {
      const res = await patch(OTHER, b);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_SUPER_ADMIN');
    }
    expect(m.admins.update).not.toHaveBeenCalled();

    m.admins.countActiveSuperAdmins.mockResolvedValue(2); // with another super admin it is allowed
    m.admins.update.mockResolvedValue(row({ role: 'admin' }));
    expect((await patch(OTHER, { role: 'admin' })).status).toBe(200);
  });

  it('no-op changes write nothing; unknown / other-mess admins are 404; the body is strict', async () => {
    m.admins.findInMess.mockResolvedValue(row());
    expect((await patch(OTHER, { role: 'admin' })).status).toBe(200);
    expect(m.admins.update).not.toHaveBeenCalled();
    expect(m.auditRepo.insert).not.toHaveBeenCalled();

    m.admins.findInMess.mockResolvedValue(null);
    expect((await patch(OTHER, { is_active: false })).status).toBe(404);
    expect(m.admins.findInMess).toHaveBeenCalledWith(OTHER, MESS);
    expect((await patch(OTHER, {})).status).toBe(400);
    expect((await patch(OTHER, { email: 'x@y.com' })).status).toBe(400);
  });
});

describe('GET /admin/admins and /admin/audit-logs', () => {
  it('lists admins with paging', async () => {
    m.admins.list.mockResolvedValue({ rows: [row(), row({ id: BOSS, role: 'super_admin' })], total: 2 });
    const res = await api('get', '/admins?limit=10');
    expect(res.status).toBe(200);
    expect(m.admins.list).toHaveBeenCalledWith(MESS, 0, 9);
    expect(res.body.data[1]).toMatchObject({ id: BOSS, role: 'super_admin' });
    expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 2, total_pages: 1 });
  });

  it('audit log: filters, mess-local day range, and actor names', async () => {
    m.auditRepo.list.mockResolvedValue({
      rows: [{ id: 981, created_at: '2026-11-25T07:00:00Z', actor_id: BOSS, actor_role: 'super_admin', action: 'payment.approve', entity_type: 'payment', entity_id: OTHER, metadata: { amount: '8500' } }],
      total: 1,
    });
    m.admins.namesByIds.mockResolvedValue({ [BOSS]: { full_name: 'Boss', role: 'super_admin' } });
    const res = await api('get', `/audit-logs?action=payment.approve&from=2026-11-01&to=2026-11-30&actor_id=${BOSS}`);
    expect(res.status).toBe(200);
    expect(m.auditRepo.list).toHaveBeenCalledWith(expect.objectContaining({
      messId: MESS, action: 'payment.approve', actorId: BOSS, fromIso: '2026-10-31T19:00:00.000Z', toIso: '2026-11-30T19:00:00.000Z', from: 0, to: 19,
    }));
    expect(res.body.data[0]).toEqual({
      id: 981, created_at: '2026-11-25T07:00:00Z', actor: { id: BOSS, full_name: 'Boss', role: 'super_admin' },
      action: 'payment.approve', entity_type: 'payment', entity_id: OTHER, metadata: { amount: '8500' },
    });
    expect((await api('get', '/audit-logs?actor_id=nope')).status).toBe(400);
  });
});
