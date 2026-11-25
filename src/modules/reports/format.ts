/** Display formatting for reports (English, mess time zone). */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11" -> "November 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/** 8500 | "8500.00" | "8500.50" -> "Rs. 8,500" | "Rs. 8,500.50" */
export function money(value: number | string): string {
  const n = Number(value);
  const text = n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return `Rs. ${text}`;
}

/** "2026-11-25" -> "25 Nov 2026" */
export function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "2026-11-25" -> "Wednesday, 25 Nov 2026" */
export function longDateLabel(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  return `${weekday}, ${dateLabel(date)}`;
}

/** ISO instant -> "12:05" in the mess time zone */
export function timeLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
}

/** ISO instant -> "25 Nov 2026, 12:05" in the mess time zone */
export function dateTimeLabel(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
  return `${date}, ${timeLabel(iso, timeZone)}`;
}

/** ISO instant -> "2026-11-25" in the mess time zone (en-CA prints YYYY-MM-DD). */
export function localDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone });
}

const METHODS: Record<string, string> = { easypaisa: 'EasyPaisa', jazzcash: 'JazzCash', nayapay: 'NayaPay', sadapay: 'SadaPay', bank: 'Bank' };
export const methodLabel = (m: string): string => METHODS[m] ?? m;

export const statusLabel = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
