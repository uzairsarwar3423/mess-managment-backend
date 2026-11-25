import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock } from '../../src/lib/clock';

const m = vi.hoisted(() => ({
  subs: { refreshStatuses: vi.fn(), findEndingOn: vi.fn(), countStartingAfter: vi.fn() },
  notifRepo: { existsForSubscription: vi.fn() },
  notif: { notifyStudent: vi.fn() },
  settings: { listActiveMessIds: vi.fn(), findMess: vi.fn(), findSettings: vi.fn() },
}));
vi.mock('../../src/modules/subscriptions/subscriptions.repository', () => m.subs);
vi.mock('../../src/modules/notifications/notifications.repository', () => m.notifRepo);
vi.mock('../../src/modules/notifications/notifications.service', () => m.notif);
vi.mock('../../src/modules/settings/settings.repository', () => m.settings);

import { refreshStatuses, sendExpiryReminders } from '../../src/modules/subscriptions/subscriptions.jobs';

const MESS = '11111111-1111-4111-8111-111111111111';
// Karachi 09:00 on 25 Nov 2026
const NOW = new Date('2026-11-25T04:00:00Z');

const settings = (reminderDays = 3) => ({
  mess_id: MESS, monthly_fee: 8500, currency: 'PKR', subscription_days: 30, lunch_start: '10:00:00', lunch_end: '16:00:00',
  dinner_start: '16:45:00', dinner_end: '20:45:00', expiry_reminder_days: reminderDays, payment_instructions: null,
  geofence_enabled: false, latitude: null, longitude: null, geofence_radius_m: 150, updated_at: 'x',
});
const ending = (id: string, end: string, over: Record<string, unknown> = {}) => ({
  id, student_id: `student-${id}`, start_date: '2026-10-01', end_date: end, student: { is_active: true }, ...over,
});
/** findEndingOn returns rows by last day. */
function endingRows(byDate: Record<string, unknown[]>): void {
  m.subs.findEndingOn.mockImplementation(async (_mess: string, date: string) => byDate[date] ?? []);
}

beforeEach(() => {
  vi.resetAllMocks();
  setClock(() => NOW);
  m.settings.listActiveMessIds.mockResolvedValue([MESS]);
  m.settings.findMess.mockResolvedValue({ id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' });
  m.settings.findSettings.mockResolvedValue(settings());
  m.subs.countStartingAfter.mockResolvedValue(0);
  m.notifRepo.existsForSubscription.mockResolvedValue(false);
  m.notif.notifyStudent.mockResolvedValue(undefined);
  endingRows({});
});
afterEach(() => setClock(null));

describe('refreshStatuses', () => {
  it('calls the SQL function and reports how many rows changed', async () => {
    m.subs.refreshStatuses.mockResolvedValue(7);
    expect(await refreshStatuses()).toBe(7);
  });
});

describe('sendExpiryReminders', () => {
  it('reminds students whose period has exactly N days left (N = 3: last day is today + 2)', async () => {
    endingRows({
      '2026-11-27': [ending('a', '2026-11-27')], // 3 days left incl. today -> remind
      '2026-11-26': [ending('b', '2026-11-26')], // 2 days left -> not today's reminder
      '2026-11-28': [ending('c', '2026-11-28')], // 4 days left -> too early
    });
    const result = await sendExpiryReminders();
    expect(result).toEqual({ expiring: 1, expired: 0 });
    expect(m.notif.notifyStudent).toHaveBeenCalledTimes(1);
    expect(m.notif.notifyStudent).toHaveBeenCalledWith({
      messId: MESS, studentId: 'student-a', type: 'subscription_expiring',
      title: 'Subscription ending soon',
      body: 'Your subscription ends on 27 Nov 2026 (3 days left). Renew to keep marking attendance.',
      data: { subscription_id: 'a' },
    });
  });

  it('the day the app starts showing "expiring soon" is the day of the reminder', async () => {
    // days_remaining = end - today + 1 = 3 on the reminder day
    endingRows({ '2026-11-27': [ending('a', '2026-11-27')] });
    await sendExpiryReminders();
    expect(m.subs.findEndingOn).toHaveBeenCalledWith(MESS, '2026-11-27');
  });

  it('tells students whose period ended yesterday', async () => {
    endingRows({ '2026-11-24': [ending('x', '2026-11-24')] });
    const result = await sendExpiryReminders();
    expect(result).toEqual({ expiring: 0, expired: 1 });
    expect(m.notif.notifyStudent).toHaveBeenCalledWith(expect.objectContaining({
      studentId: 'student-x', type: 'subscription_expired', body: 'Your subscription ended on 24 Nov 2026. Renew to mark attendance again.',
    }));
  });

  it('skips students who already renewed (a later period exists)', async () => {
    endingRows({ '2026-11-27': [ending('a', '2026-11-27')], '2026-11-24': [ending('x', '2026-11-24')] });
    m.subs.countStartingAfter.mockResolvedValue(1);
    expect(await sendExpiryReminders()).toEqual({ expiring: 0, expired: 0 });
    expect(m.notif.notifyStudent).not.toHaveBeenCalled();
  });

  it('skips disabled students and never nags twice about the same subscription', async () => {
    endingRows({ '2026-11-27': [ending('a', '2026-11-27', { student: { is_active: false } }), ending('b', '2026-11-27')] });
    m.notifRepo.existsForSubscription.mockImplementation(async (_s: string, _t: string, sub: string) => sub === 'b');
    expect(await sendExpiryReminders()).toEqual({ expiring: 0, expired: 0 });
    expect(m.notifRepo.existsForSubscription).toHaveBeenCalledWith('student-b', 'subscription_expiring', 'b');
  });

  it('ignores a renewal that has not started yet (it is not "expiring")', async () => {
    endingRows({ '2026-11-27': [ending('a', '2026-11-27', { start_date: '2026-11-26' })] });
    expect((await sendExpiryReminders()).expiring).toBe(0);
  });

  it('with reminder days = 0 there are no "expiring" reminders, only "expired"', async () => {
    m.settings.findSettings.mockResolvedValue(settings(0));
    endingRows({ '2026-11-24': [ending('x', '2026-11-24')] });
    expect(await sendExpiryReminders()).toEqual({ expiring: 0, expired: 1 });
    expect(m.subs.findEndingOn).toHaveBeenCalledTimes(1); // only the "ended yesterday" lookup
  });

  it('uses each mess\'s own time zone for "today"', async () => {
    // 20:00 UTC on 24 Nov is already 25 Nov 01:00 in Karachi
    setClock(() => new Date('2026-11-24T20:00:00Z'));
    endingRows({ '2026-11-27': [ending('a', '2026-11-27')] });
    expect((await sendExpiryReminders()).expiring).toBe(1);
  });

  it('handles several messes independently', async () => {
    m.settings.listActiveMessIds.mockResolvedValue([MESS, 'mess-2']);
    m.settings.findMess.mockImplementation(async (id: string) => ({ id, name: id, timezone: 'Asia/Karachi' }));
    endingRows({ '2026-11-27': [ending('a', '2026-11-27')] });
    expect((await sendExpiryReminders()).expiring).toBe(2);
    expect(m.subs.findEndingOn).toHaveBeenCalledWith('mess-2', '2026-11-27');
  });
});
