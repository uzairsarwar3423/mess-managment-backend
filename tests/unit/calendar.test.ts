import { describe, expect, it } from 'vitest';
import { buildCalendar, shiftMonth } from '../../src/modules/attendance/calendar';

const sub = { id: 's1', start_date: '2026-11-10', end_date: '2026-12-09', status: 'active' };
const mark = (date: string, meal: 'lunch' | 'dinner') => ({
  attendance_date: date, meal_type: meal, marked_at: `${date}T07:00:00Z`,
});

describe('buildCalendar', () => {
  it('has one entry per day of the month (28/29/30/31)', () => {
    const base = { today: '2026-02-15', subscriptions: [], attendance: [] };
    expect(buildCalendar({ ...base, month: '2026-02' }).days).toHaveLength(28);
    expect(buildCalendar({ ...base, month: '2028-02' }).days).toHaveLength(29);
    expect(buildCalendar({ ...base, month: '2026-11' }).days).toHaveLength(30);
    expect(buildCalendar({ ...base, month: '2026-12' }).days).toHaveLength(31);
  });

  it('marks coverage by subscription dates (inclusive on both ends)', () => {
    const c = buildCalendar({ month: '2026-11', today: '2026-11-25', subscriptions: [sub], attendance: [] });
    const covered = (d: string) => c.days.find((x) => x.date === d)?.covered;
    expect(covered('2026-11-09')).toBe(false);
    expect(covered('2026-11-10')).toBe(true);
    expect(covered('2026-11-30')).toBe(true);
    expect(c.summary.covered_days).toBe(21);
  });

  it('counts meals and attaches the server timestamps', () => {
    const c = buildCalendar({
      month: '2026-11', today: '2026-11-25', subscriptions: [sub],
      attendance: [mark('2026-11-10', 'lunch'), mark('2026-11-10', 'dinner'), mark('2026-11-11', 'lunch')],
    });
    expect(c.days[9]).toMatchObject({ lunch: { marked: true, marked_at: '2026-11-10T07:00:00Z' }, dinner: { marked: true } });
    expect(c.days[10]).toMatchObject({ lunch: { marked: true }, dinner: { marked: false, marked_at: null } });
    expect(c.summary).toMatchObject({ lunch_count: 2, dinner_count: 1 });
  });

  it('missed meals: only covered days strictly before today (today is still open)', () => {
    const c = buildCalendar({ month: '2026-11', today: '2026-11-12', subscriptions: [sub], attendance: [mark('2026-11-10', 'lunch')] });
    // covered days before today: 10th and 11th = 4 meals, 1 marked
    expect(c.summary.missed_meals).toBe(3);
  });

  it('days outside any subscription never count as missed', () => {
    const c = buildCalendar({ month: '2026-11', today: '2026-11-25', subscriptions: [], attendance: [] });
    expect(c.summary).toEqual({ lunch_count: 0, dinner_count: 0, covered_days: 0, missed_meals: 0 });
  });

  it('handles back-to-back subscriptions (renewal) without double counting', () => {
    const next = { id: 's2', start_date: '2026-12-10', end_date: '2027-01-08', status: 'scheduled' };
    const c = buildCalendar({ month: '2026-12', today: '2026-12-01', subscriptions: [sub, next], attendance: [] });
    expect(c.summary.covered_days).toBe(31); // every day of December is covered once
  });
});

describe('shiftMonth', () => {
  it('moves across year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', -24)).toBe('2024-11');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
  });
});
