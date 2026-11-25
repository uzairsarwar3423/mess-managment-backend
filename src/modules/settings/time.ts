import { MEAL_TYPES, type MealType } from '../../config/constants';

/** A meal window in mess-local time. `HH:mm` or `HH:mm:ss` (Postgres `time` returns the latter). */
export interface MealWindow {
  start: string;
  end: string;
}
export type MealWindows = Record<MealType, MealWindow>;

const DAY_MS = 86_400_000;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const get = (k: string): number => map[k] ?? 0;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Business date (YYYY-MM-DD) of an instant in the mess time zone. BR-07: always computed server-side. */
export function businessDate(now: Date, timeZone: string): string {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Seconds since local midnight. */
export function secondsOfDay(now: Date, timeZone: string): number {
  const p = zonedParts(now, timeZone);
  return p.hour * 3600 + p.minute * 60 + p.second;
}

/** 'HH:mm' | 'HH:mm:ss' -> seconds since midnight. */
export function parseTimeToSeconds(time: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!m) throw new Error(`Invalid time value: ${time}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

/**
 * Which meal window contains the instant? `start <= time < end`. Returns null in the gap between
 * meals or outside both windows (BR-14: the server, not the client, chooses the meal).
 */
export function currentMealWindow(now: Date, timeZone: string, windows: MealWindows): MealType | null {
  const sod = secondsOfDay(now, timeZone);
  for (const meal of MEAL_TYPES) {
    const w = windows[meal];
    if (sod >= parseTimeToSeconds(w.start) && sod < parseTimeToSeconds(w.end)) return meal;
  }
  return null;
}

/** YYYY-MM-DD + n days. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Days left including today: end_date 2026-12-09 on 2026-11-25 -> 15. Never negative. */
export function daysRemaining(endDate: string, today: string): number {
  return Math.max(0, diffDays(today, endDate) + 1);
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Local date + time in `timeZone` -> the UTC instant. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`) + parseTimeToSeconds(time) * 1000;
  const off = tzOffsetMs(new Date(guess), timeZone);
  let utc = guess - off;
  const off2 = tzOffsetMs(new Date(utc), timeZone);
  if (off2 !== off) utc = guess - off2;
  return new Date(utc);
}

/** The next meal window that opens after `now` (today, otherwise tomorrow's first). */
export function nextMealWindow(
  now: Date,
  timeZone: string,
  windows: MealWindows,
): { meal: MealType; startsAt: Date } {
  const today = businessDate(now, timeZone);
  const candidates = (day: string): { meal: MealType; startsAt: Date }[] =>
    MEAL_TYPES.map((meal) => ({ meal, startsAt: zonedTimeToUtc(day, windows[meal].start, timeZone) })).sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );

  const upcomingToday = candidates(today).find((c) => c.startsAt.getTime() > now.getTime());
  if (upcomingToday) return upcomingToday;
  return candidates(addDays(today, 1))[0] as { meal: MealType; startsAt: Date };
}

/** 'YYYY-MM' -> first/last day and number of days. */
export function monthBounds(month: string): { start: string; end: string; days: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(days)}`, days };
}
