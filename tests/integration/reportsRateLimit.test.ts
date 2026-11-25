import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  att: { monthly: vi.fn() },
  settings: { findMess: vi.fn(), findSettings: vi.fn() },
  admins: { findById: vi.fn() },
  students: { findById: vi.fn() },
  audit: { insert: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
}));
vi.mock('../../src/modules/attendance/attendance.repository', () => m.att);
vi.mock('../../src/modules/settings/settings.repository', () => m.settings);
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/audit/audit.repository', () => m.audit);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);

import { createApp } from '../../src/app';

const app = createApp({ readinessCheck: async () => undefined });
const MESS = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.resetAllMocks();
  m.settings.findMess.mockResolvedValue({ id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' });
  m.settings.findSettings.mockResolvedValue({
    mess_id: MESS, monthly_fee: 8500, currency: 'PKR', subscription_days: 30, lunch_start: '10:00:00', lunch_end: '16:00:00',
    dinner_start: '16:45:00', dinner_end: '20:45:00', expiry_reminder_days: 3, payment_instructions: null,
    geofence_enabled: false, latitude: null, longitude: null, geofence_radius_m: 150, updated_at: 'x',
  });
  m.verify.verifyAccessToken.mockResolvedValue({ sub: 'a1', email: 'a@example.com' });
  m.admins.findById.mockResolvedValue({ id: 'a1', mess_id: MESS, email: 'a@example.com', role: 'admin', is_active: true, full_name: 'Sara', phone: null, created_at: 'x' });
  m.students.findById.mockResolvedValue(null);
  m.audit.insert.mockResolvedValue(undefined);
  m.att.monthly.mockResolvedValue([]);
});

describe('PDF rate limit (10 per minute per user)', () => {
  it('allows 10 downloads, then answers 429 RATE_LIMITED in the standard JSON envelope', async () => {
    const get = () =>
      request(app).get('/api/v1/admin/reports/attendance-monthly.pdf?month=2026-11').set('Authorization', 'Bearer t');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await get()).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect((await get()).body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
  });
});
