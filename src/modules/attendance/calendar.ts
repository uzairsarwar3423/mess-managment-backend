import type { MealType } from '../../config/constants';
import { addDays, monthBounds } from '../settings/time';

/** Pure functions: turn subscription ranges + attendance rows into the calendar response. */

export interface CalendarSubscription {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface CalendarAttendance {
  attendance_date: string;
  meal_type: MealType;
  marked_at: string;
}

interface MealMark {
  marked: boolean;
  marked_at: string | null;
}

export interface CalendarDay {
  date: string;
  covered: boolean;
  lunch: MealMark;
  dinner: MealMark;
}

export interface Calendar {
  month: string;
  days: CalendarDay[];
  summary: { lunch_count: number; dinner_count: number; covered_days: number; missed_meals: number };
}

/**
 * Builds every day of `month` (YYYY-MM).
 *  - covered: the date falls inside a (non-cancelled) subscription
 *  - missed_meals: meals not marked on covered days strictly BEFORE `today` (today is still open)
 * `today` is the server's business date, never the device date.
 */
export function buildCalendar(params: {
  month: string;
  today: string;
  subscriptions: CalendarSubscription[];
  attendance: CalendarAttendance[];
}): Calendar {
  const { month, today, subscriptions, attendance } = params;
  const { start, days: dayCount } = monthBounds(month);

  const marks = new Map<string, MealMark>();
  for (const a of attendance) marks.set(`${a.attendance_date}|${a.meal_type}`, { marked: true, marked_at: a.marked_at });
  const none: MealMark = { marked: false, marked_at: null };

  const days: CalendarDay[] = [];
  let lunch = 0;
  let dinner = 0;
  let covered = 0;
  let missed = 0;

  for (let i = 0; i < dayCount; i++) {
    const date = addDays(start, i);
    const isCovered = subscriptions.some((s) => s.start_date <= date && date <= s.end_date);
    const l = marks.get(`${date}|lunch`) ?? none;
    const d = marks.get(`${date}|dinner`) ?? none;

    if (l.marked) lunch++;
    if (d.marked) dinner++;
    if (isCovered) {
      covered++;
      if (date < today) missed += (l.marked ? 0 : 1) + (d.marked ? 0 : 1);
    }
    days.push({ date, covered: isCovered, lunch: l, dinner: d });
  }

  return { month, days, summary: { lunch_count: lunch, dinner_count: dinner, covered_days: covered, missed_meals: missed } };
}

/** Month `YYYY-MM` shifted by n months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
