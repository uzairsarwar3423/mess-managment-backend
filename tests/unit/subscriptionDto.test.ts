import { describe, expect, it } from 'vitest';
import { toSubscriptionDto, type SubscriptionRow } from '../../src/modules/subscriptions/subscriptions.dto';

const row = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  id: 's1', mess_id: 'm', student_id: 'st', payment_id: 'p',
  start_date: '2026-11-25', end_date: '2026-12-24', status: 'active', amount: 8500, created_at: '2026-11-25T07:00:00Z', ...over,
});

describe('toSubscriptionDto', () => {
  it('counts today as a remaining day (start day of a 30-day plan -> 30)', () => {
    expect(toSubscriptionDto(row(), '2026-11-25', 3)).toMatchObject({ days_remaining: 30, is_expiring_soon: false, amount: '8500.00' });
  });

  it('flags expiring soon within the reminder window', () => {
    expect(toSubscriptionDto(row(), '2026-12-22', 3)).toMatchObject({ days_remaining: 3, is_expiring_soon: true });
    expect(toSubscriptionDto(row(), '2026-12-21', 3)).toMatchObject({ days_remaining: 4, is_expiring_soon: false });
  });

  it('the last day still counts (end_date inclusive, BR-13)', () => {
    expect(toSubscriptionDto(row(), '2026-12-24', 3).days_remaining).toBe(1);
    expect(toSubscriptionDto(row(), '2026-12-25', 3).days_remaining).toBe(0);
  });

  it('a scheduled renewal counts from its own start, not from today', () => {
    const next = row({ status: 'scheduled', start_date: '2026-12-25', end_date: '2027-01-23' });
    expect(toSubscriptionDto(next, '2026-12-20', 3)).toMatchObject({ days_remaining: 30, is_expiring_soon: false });
  });

  it('expired and cancelled have no days left', () => {
    expect(toSubscriptionDto(row({ status: 'expired' }), '2026-12-30', 3).days_remaining).toBe(0);
    expect(toSubscriptionDto(row({ status: 'cancelled' }), '2026-11-26', 3)).toMatchObject({ days_remaining: 0, is_expiring_soon: false });
  });
});
