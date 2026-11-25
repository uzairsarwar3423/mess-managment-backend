import { describe, expect, it } from 'vitest';
import {
  addDays,
  businessDate,
  currentMealWindow,
  daysRemaining,
  monthBounds,
  nextMealWindow,
  zonedTimeToUtc,
  type MealWindows,
} from '../../src/modules/settings/time';

const TZ = 'Asia/Karachi'; // UTC+5, no DST
const windows: MealWindows = {
  lunch: { start: '10:00:00', end: '16:00:00' },
  dinner: { start: '16:45', end: '20:45' },
};
const at = (iso: string): Date => new Date(iso);

describe('businessDate', () => {
  it('uses the mess time zone, not UTC', () => {
    expect(businessDate(at('2026-11-25T10:00:00Z'), TZ)).toBe('2026-11-25');
    // 19:30 UTC = 00:30 next day in Karachi
    expect(businessDate(at('2026-11-25T19:30:00Z'), TZ)).toBe('2026-11-26');
  });
});

describe('currentMealWindow (Lunch 10:00-16:00, Dinner 16:45-20:45)', () => {
  const cases: [string, string, 'lunch' | 'dinner' | null][] = [
    ['2026-11-25T04:59:59Z', '09:59:59 local', null],
    ['2026-11-25T05:00:00Z', '10:00:00 local', 'lunch'],
    ['2026-11-25T10:59:59Z', '15:59:59 local', 'lunch'],
    ['2026-11-25T11:00:00Z', '16:00:00 local', null],
    ['2026-11-25T11:20:00Z', '16:20 gap', null],
    ['2026-11-25T11:45:00Z', '16:45 local', 'dinner'],
    ['2026-11-25T15:44:59Z', '20:44:59 local', 'dinner'],
    ['2026-11-25T15:45:00Z', '20:45 local', null],
  ];
  it.each(cases)('%s (%s) -> %s', (iso, _label, expected) => {
    expect(currentMealWindow(at(iso), TZ, windows)).toBe(expected);
  });
});

describe('nextMealWindow', () => {
  it('between meals returns today\'s dinner', () => {
    const next = nextMealWindow(at('2026-11-25T11:20:00Z'), TZ, windows);
    expect(next.meal).toBe('dinner');
    expect(next.startsAt.toISOString()).toBe('2026-11-25T11:45:00.000Z');
  });
  it('before lunch returns today\'s lunch', () => {
    const next = nextMealWindow(at('2026-11-25T02:00:00Z'), TZ, windows);
    expect(next.meal).toBe('lunch');
    expect(next.startsAt.toISOString()).toBe('2026-11-25T05:00:00.000Z');
  });
  it('after dinner returns tomorrow\'s lunch', () => {
    const next = nextMealWindow(at('2026-11-25T16:30:00Z'), TZ, windows);
    expect(next.meal).toBe('lunch');
    expect(next.startsAt.toISOString()).toBe('2026-11-26T05:00:00.000Z');
  });
});

describe('date helpers', () => {
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('daysRemaining counts today and never goes negative', () => {
    expect(daysRemaining('2026-12-09', '2026-11-25')).toBe(15);
    expect(daysRemaining('2026-11-25', '2026-11-25')).toBe(1);
    expect(daysRemaining('2026-11-24', '2026-11-25')).toBe(0);
  });
  it('monthBounds handles 28/30/31 day months', () => {
    expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28', days: 28 });
    expect(monthBounds('2028-02').days).toBe(29);
    expect(monthBounds('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30', days: 30 });
    expect(monthBounds('2026-12').days).toBe(31);
  });
  it('zonedTimeToUtc converts Karachi local time to UTC', () => {
    expect(zonedTimeToUtc('2026-11-25', '10:00', TZ).toISOString()).toBe('2026-11-25T05:00:00.000Z');
  });
});
