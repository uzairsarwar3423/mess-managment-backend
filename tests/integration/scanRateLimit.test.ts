import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock } from '../../src/lib/clock';

const m = vi.hoisted(() => ({
  qr: { findByIdAnyMess: vi.fn() },
  att: { findOne: vi.fn() },
  subs: { findCovering: vi.fn() },
  settings: { findMess: vi.fn(), findSettings: vi.fn() },
  students: { findById: vi.fn() },
  admins: { findById: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
}));
vi.mock('../../src/modules/qr/qr.repository', () => m.qr);
vi.mock('../../src/modules/attendance/attendance.repository', () => m.att);
vi.mock('../../src/modules/subscriptions/subscriptions.repository', () => m.subs);
vi.mock('../../src/modules/settings/settings.repository', () => m.settings);
vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);

import { createApp } from '../../src/app';
import { signQrToken } from '../../src/modules/qr/qrToken';

const app = createApp({ readinessCheck: async () => undefined });
const MESS = '11111111-1111-4111-8111-111111111111';
const QR = '88888888-8888-4888-8888-888888888888';

function loginAs(id: string): void {
  m.verify.verifyAccessToken.mockResolvedValue({ sub: id, email: 'x@example.com' });
  m.students.findById.mockResolvedValue({ id, mess_id: MESS, email: 'x@example.com', is_active: true });
  m.admins.findById.mockResolvedValue(null);
}

beforeEach(() => {
  vi.resetAllMocks();
  setClock(() => new Date('2026-11-25T07:00:00Z'));
  m.settings.findMess.mockResolvedValue({ id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' });
  m.settings.findSettings.mockResolvedValue({
    mess_id: MESS, monthly_fee: 8500, currency: 'PKR', subscription_days: 30, lunch_start: '10:00:00', lunch_end: '16:00:00',
    dinner_start: '16:45:00', dinner_end: '20:45:00', expiry_reminder_days: 3, payment_instructions: null,
    geofence_enabled: false, latitude: null, longitude: null, geofence_radius_m: 150, updated_at: 'x',
  });
  m.qr.findByIdAnyMess.mockResolvedValue({ id: QR, mess_id: MESS, status: 'active' });
  m.subs.findCovering.mockResolvedValue({ id: 's1', end_date: '2026-12-09' });
  m.att.findOne.mockResolvedValue({ meal_type: 'lunch', marked_at: '2026-11-25T06:00:00Z' }); // cheap 409
});
afterEach(() => setClock(null));

const scan = (userId: string) =>
  request(app).post('/api/v1/student/attendance/scan').set('Authorization', 'Bearer t').send({ token: signQrToken({ qid: QR, mid: MESS }) }).then((r) => {
    void userId;
    return r;
  });

describe('scan rate limit (20 per minute per user)', () => {
  it('allows 20, then answers 429 RATE_LIMITED in the standard envelope', async () => {
    loginAs('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await scan('a')).status);
    expect(statuses.slice(0, 20).every((s) => s === 409)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);

    const limited = await scan('a');
    expect(limited.body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
  });

  it('is per user: another student is not affected', async () => {
    loginAs('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect((await scan('b')).status).toBe(409);
  });
});
