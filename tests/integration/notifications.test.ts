import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  notif: { listForStudent: vi.fn(), countUnread: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), insert: vi.fn() },
  tokens: { upsert: vi.fn(), removeForUser: vi.fn(), listForUser: vi.fn(), removeTokens: vi.fn() },
  students: { findById: vi.fn() },
  admins: { findById: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
}));
vi.mock('../../src/modules/notifications/notifications.repository', () => m.notif);
vi.mock('../../src/modules/notifications/pushTokens.repository', () => m.tokens);
vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);

import { createApp } from '../../src/app';

const app = createApp({ readinessCheck: async () => undefined });
const USER = '33333333-3333-4333-8333-333333333333';
const NID = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'ExponentPushToken[abcdefghijklmnop]';

function loginAs(who: 'student' | 'admin'): void {
  m.verify.verifyAccessToken.mockResolvedValue({ sub: USER, email: 'x@example.com' });
  if (who === 'student') {
    m.students.findById.mockResolvedValue({ id: USER, mess_id: 'm', email: 'x@example.com', is_active: true });
    m.admins.findById.mockResolvedValue(null);
  } else {
    m.admins.findById.mockResolvedValue({ id: USER, mess_id: 'm', email: 'x@example.com', role: 'admin', is_active: true });
    m.students.findById.mockResolvedValue(null);
  }
}
const api = (method: 'get' | 'post', path: string) => request(app)[method](`/api/v1${path}`).set('Authorization', 'Bearer t');

beforeEach(() => {
  vi.resetAllMocks();
  loginAs('student');
});

describe('notifications (student)', () => {
  it('lists newest first with paging and the unread counter', async () => {
    m.notif.listForStudent.mockResolvedValue({
      rows: [{ id: NID, type: 'payment_approved', title: 'Payment approved', body: 'x', data: { payment_id: 'p' }, is_read: false, created_at: 'now' }],
      total: 31,
    });
    m.notif.countUnread.mockResolvedValue(4);
    const res = await api('get', '/notifications?unread_only=true&page=2&limit=10');
    expect(res.status).toBe(200);
    expect(m.notif.listForStudent).toHaveBeenCalledWith(USER, true, 10, 19);
    expect(res.body.meta).toEqual({ page: 2, limit: 10, total: 31, total_pages: 4, unread_count: 4 });
    expect(res.body.data[0]).toEqual({ id: NID, type: 'payment_approved', title: 'Payment approved', body: 'x', data: { payment_id: 'p' }, is_read: false, created_at: 'now' });
  });

  it('marks one as read, scoped to the caller (someone else\'s is NOT_FOUND)', async () => {
    m.notif.markRead.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const ok = await api('post', `/notifications/${NID}/read`).send({});
    expect(ok.body.data).toEqual({ id: NID, is_read: true });
    expect(m.notif.markRead).toHaveBeenCalledWith(NID, USER, expect.any(String));
    expect((await api('post', `/notifications/${NID}/read`).send({})).status).toBe(404);
  });

  it('read-all is not mistaken for an id', async () => {
    m.notif.markAllRead.mockResolvedValue(3);
    const res = await api('post', '/notifications/read-all').send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: 3 });
  });

  it('admins have no notification inbox in v1', async () => {
    loginAs('admin');
    expect((await api('get', '/notifications')).status).toBe(403);
  });
});

describe('devices / push tokens (students and admins)', () => {
  it('registers a token for the caller', async () => {
    m.tokens.upsert.mockResolvedValue(undefined);
    const res = await api('post', '/devices/push-token').send({ token: TOKEN, platform: 'android' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ registered: true });
    expect(m.tokens.upsert).toHaveBeenCalledWith(USER, TOKEN, 'android', expect.any(String));
  });

  it('admins can register devices too', async () => {
    loginAs('admin');
    m.tokens.upsert.mockResolvedValue(undefined);
    expect((await api('post', '/devices/push-token').send({ token: TOKEN })).status).toBe(200);
  });

  it.each([
    ['random string', { token: 'not-a-token' }],
    ['wrong platform', { token: TOKEN, platform: 'ios' }],
    ['extra field', { token: TOKEN, user_id: 'x' }],
  ])('rejects %s', async (_l, body) => {
    const res = await api('post', '/devices/push-token').send(body);
    expect(res.status).toBe(400);
    expect(m.tokens.upsert).not.toHaveBeenCalled();
  });

  it('unregisters only the caller\'s token', async () => {
    m.tokens.removeForUser.mockResolvedValue(undefined);
    const res = await api('post', '/devices/push-token/unregister').send({ token: TOKEN });
    expect(res.body.data).toEqual({ removed: true });
    expect(m.tokens.removeForUser).toHaveBeenCalledWith(USER, TOKEN);
  });

  it('needs authentication', async () => {
    expect((await request(app).post('/api/v1/devices/push-token').send({ token: TOKEN })).status).toBe(401);
  });
});
