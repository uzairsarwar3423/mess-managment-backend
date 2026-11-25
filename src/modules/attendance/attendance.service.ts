import { AppError } from '../../common/errors/AppError';
import { buildMeta } from '../../common/http/respond';
import { toRange } from '../../common/pagination';
import type { AuthContext, RequestMeta } from '../../common/types';
import type { MealType } from '../../config/constants';
import { now } from '../../lib/clock';
import { evaluateGeofence } from '../../lib/geo';
import { logger } from '../../lib/logger';
import * as auditService from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/auditActions';
import * as qrRepository from '../qr/qr.repository';
import { verifyQrToken } from '../qr/qrToken';
import { loadMessConfig, type MessConfig } from '../settings/settings.service';
import { addDays, businessDate, currentMealWindow, daysRemaining, monthBounds, nextMealWindow } from '../settings/time';
import * as studentsRepository from '../students/students.repository';
import * as subscriptionsRepository from '../subscriptions/subscriptions.repository';
import * as repository from './attendance.repository';
import { toAttendanceDto, toDailyRecord } from './attendance.dto';
import type {
  CalendarQuery,
  DailyQuery,
  HistoryQuery,
  ManualBody,
  MonthlyQuery,
  ScanBody,
} from './attendance.schemas';
import { buildCalendar, shiftMonth } from './calendar';

// ---------------------------------------------------------------- scan (student)

/**
 * Marks attendance from a scanned printed QR (docs/attendance-workflow.md section 3).
 * The client sends only the token (+ optional location): the MEAL and DATE are derived here from
 * the server clock (BR-07, BR-14), and uniqueness is finally guaranteed by the database (BR-06).
 */
export async function scan(auth: AuthContext, body: ScanBody) {
  try {
    return await doScan(auth, body);
  } catch (err) {
    if (err instanceof AppError) {
      // Rejected scans are visible to abuse monitoring (never log the token itself).
      logger.warn({ user_id: auth.userId, code: err.code }, 'scan rejected');
    }
    throw err;
  }
}

async function doScan(auth: AuthContext, body: ScanBody) {
  // 1. Token: signature/claims only (cheap, no database)
  const claims = verifyQrToken(body.token);

  // 2. The printed code must exist, belong to this mess and not be revoked
  const qr = await qrRepository.findByIdAnyMess(claims.qid);
  if (!qr || qr.mess_id !== claims.mid) throw new AppError('QR_INVALID');
  if (qr.mess_id !== auth.messId) throw new AppError('WRONG_MESS');
  if (qr.status !== 'active') throw new AppError('QR_REVOKED');

  // 3. Which meal is it? The server decides, from its own clock
  const config = await loadMessConfig(auth.messId);
  const t = now();
  const meal = currentMealWindow(t, config.timezone, config.windows);
  if (!meal) {
    const next = nextMealWindow(t, config.timezone, config.windows);
    throw new AppError('OUTSIDE_MEAL_WINDOW', undefined, {
      next_window: { meal: next.meal, starts_at: next.startsAt.toISOString() },
    });
  }
  const date = businessDate(t, config.timezone);

  // 4. Subscription (BR-04): date-based, independent of the nightly job
  const subscription = await subscriptionsRepository.findCovering(auth.userId, date);
  if (!subscription) throw new AppError('NO_ACTIVE_SUBSCRIPTION');

  // 5. Friendly duplicate pre-check (the unique constraint below is the real guard)
  const existing = await repository.findOne(auth.userId, date, meal);
  if (existing) throw alreadyMarked(existing.meal_type, existing.marked_at);

  // 6. Geofence (D-11): the phone must be at the mess
  const distanceM = checkGeofence(config, body.location);

  // 7. Insert; a concurrent duplicate loses on the unique constraint
  let row;
  try {
    row = await repository.insert({
      mess_id: auth.messId,
      student_id: auth.userId,
      subscription_id: subscription.id,
      qr_code_id: qr.id,
      meal_type: meal,
      attendance_date: date,
      source: 'qr',
      marked_by: null,
      scan_distance_m: distanceM,
    });
  } catch (err) {
    if (err instanceof AppError && err.code === 'ALREADY_MARKED') {
      const winner = await repository.findOne(auth.userId, date, meal);
      throw alreadyMarked(meal, winner?.marked_at ?? null);
    }
    throw err;
  }

  return {
    attendance: toAttendanceDto(row),
    subscription: { end_date: subscription.end_date, days_remaining: daysRemaining(subscription.end_date, date) },
  };
}

function alreadyMarked(meal: MealType, markedAt: string | null): AppError {
  return new AppError('ALREADY_MARKED', `${meal === 'lunch' ? 'Lunch' : 'Dinner'} attendance is already marked for today.`, {
    meal_type: meal,
    marked_at: markedAt,
  });
}

/** Returns the distance to store, or null when the geofence is off. Throws when the phone is not at the mess. */
function checkGeofence(config: MessConfig, location: ScanBody['location']): number | null {
  if (!config.geofence.enabled) return null; // location is ignored (and never stored) when off
  if (!config.geofence.center) {
    logger.error('geofence is enabled but the mess has no coordinates');
    throw new AppError('INTERNAL_ERROR');
  }
  const result = evaluateGeofence({ center: config.geofence.center, radiusM: config.geofence.radiusM, location });
  if (!result.ok) throw new AppError(result.code, undefined, { reason: result.reason });
  return result.distanceM;
}

// ---------------------------------------------------------------- student reads

export async function today(auth: AuthContext) {
  const config = await loadMessConfig(auth.messId);
  const t = now();
  const date = businessDate(t, config.timezone);
  const rows = await repository.listForStudentRange(auth.userId, date, date);
  const mark = (meal: MealType) => {
    const r = rows.find((x) => x.meal_type === meal);
    return { marked: Boolean(r), marked_at: r?.marked_at ?? null };
  };
  const next = nextMealWindow(t, config.timezone, config.windows);
  return {
    server_time: t.toISOString(),
    date,
    current_meal: currentMealWindow(t, config.timezone, config.windows),
    next_window: { meal: next.meal, starts_at: next.startsAt.toISOString() },
    location_required: config.geofence.enabled,
    lunch: mark('lunch'),
    dinner: mark('dinner'),
  };
}

/** Calendar of ONE student (the student themself or, for admins, a student of the same mess). */
export async function calendarFor(messId: string, studentId: string, query: CalendarQuery) {
  const config = await loadMessConfig(messId);
  const todayDate = businessDate(now(), config.timezone);
  const currentMonth = todayDate.slice(0, 7);

  // Not more than a month ahead, and a sane history window.
  if (query.month > shiftMonth(currentMonth, 1) || query.month < shiftMonth(currentMonth, -24)) {
    throw new AppError('VALIDATION_ERROR', 'That month is out of range.');
  }

  const { start, end } = monthBounds(query.month);
  const [subscriptions, attendance] = await Promise.all([
    subscriptionsRepository.listOverlapping(studentId, start, end),
    repository.listForStudentRange(studentId, start, end),
  ]);

  const calendar = buildCalendar({ month: query.month, today: todayDate, subscriptions, attendance });
  return {
    month: query.month,
    timezone: config.timezone,
    server_date: todayDate,
    subscriptions: subscriptions.map((s) => ({ id: s.id, start_date: s.start_date, end_date: s.end_date, status: s.status })),
    days: calendar.days,
    summary: calendar.summary,
  };
}

export const calendar = (auth: AuthContext, query: CalendarQuery) => calendarFor(auth.messId, auth.userId, query);

export async function historyFor(messId: string, studentId: string, query: HistoryQuery) {
  const config = await loadMessConfig(messId);
  const todayDate = businessDate(now(), config.timezone);
  const to = query.to ?? todayDate;
  const from = query.from ?? addDays(to, -29);

  if (from > to) throw new AppError('VALIDATION_ERROR', '"from" must not be after "to".');
  if (addDays(from, 366) < to) throw new AppError('VALIDATION_ERROR', 'The date range is too long (max 366 days).');

  const range = toRange(query.page, query.limit);
  const { rows, total } = await repository.history(studentId, from, to, query.meal_type, range.from, range.to);
  return { data: rows.map(toAttendanceDto), meta: buildMeta(query.page, query.limit, total) };
}

export const history = (auth: AuthContext, query: HistoryQuery) => historyFor(auth.messId, auth.userId, query);

/** Lunches and dinners marked so far this month (dashboards). */
export async function monthSummary(messId: string, studentId: string) {
  const config = await loadMessConfig(messId);
  const todayDate = businessDate(now(), config.timezone);
  const month = todayDate.slice(0, 7);
  const rows = await repository.listForStudentRange(studentId, monthBounds(month).start, todayDate);
  return {
    month,
    lunch_count: rows.filter((r) => r.meal_type === 'lunch').length,
    dinner_count: rows.filter((r) => r.meal_type === 'dinner').length,
  };
}

// ---------------------------------------------------------------- admin

export async function daily(auth: AuthContext, query: DailyQuery) {
  const config = await loadMessConfig(auth.messId);
  const date = query.date ?? businessDate(now(), config.timezone);

  const [records, eligible] = await Promise.all([
    repository.daily(auth.messId, date, query.meal_type),
    repository.eligibleStatus(auth.messId, date, query.meal_type),
  ]);
  const notMarked = eligible.filter((e) => !e.marked);

  return {
    date,
    meal_type: query.meal_type,
    counts: { present: records.length, eligible: eligible.length, not_marked: notMarked.length },
    records: records.map(toDailyRecord),
    ...(query.include_not_marked
      ? { not_marked: notMarked.map((s) => ({ student_id: s.student_id, student_code: s.student_code, full_name: s.full_name })) }
      : {}),
  };
}

export async function monthly(auth: AuthContext, query: MonthlyQuery) {
  const { start, days } = monthBounds(query.month);
  let rows = await repository.monthly(auth.messId, start);

  if (query.q) {
    const needle = query.q.toLowerCase();
    rows = rows.filter((r) => r.full_name.toLowerCase().includes(needle) || r.student_code.toLowerCase().includes(needle));
  }

  return {
    month: query.month,
    days_in_month: days,
    students: rows.map((r) => ({
      student_id: r.student_id,
      student_code: r.student_code,
      full_name: r.full_name,
      lunch_count: r.lunch_count,
      dinner_count: r.dinner_count,
      total_count: r.total_count,
      marks: r.marks,
    })),
    totals: {
      lunch: rows.reduce((n, r) => n + r.lunch_count, 0),
      dinner: rows.reduce((n, r) => n + r.dinner_count, 0),
    },
  };
}

/**
 * Optional emergency entry (D-06): same subscription + uniqueness rules as a scan, mandatory
 * reason, at most 7 days back, always audited.
 */
export async function markManual(auth: AuthContext, body: ManualBody, meta: RequestMeta) {
  const config = await loadMessConfig(auth.messId);
  const todayDate = businessDate(now(), config.timezone);
  if (body.date > todayDate) throw new AppError('VALIDATION_ERROR', 'The date cannot be in the future.');
  if (body.date < addDays(todayDate, -7)) throw new AppError('VALIDATION_ERROR', 'Manual entries can go back at most 7 days.');

  const student = await studentsRepository.findById(body.student_id);
  if (!student || student.mess_id !== auth.messId) throw new AppError('NOT_FOUND');

  const subscription = await subscriptionsRepository.findCovering(student.id, body.date, { includeExpired: true });
  if (!subscription) throw new AppError('NO_ACTIVE_SUBSCRIPTION');

  const existing = await repository.findOne(student.id, body.date, body.meal_type);
  if (existing) throw alreadyMarked(body.meal_type, existing.marked_at);

  const row = await repository.insert({
    mess_id: auth.messId,
    student_id: student.id,
    subscription_id: subscription.id,
    qr_code_id: null,
    meal_type: body.meal_type,
    attendance_date: body.date,
    source: 'manual',
    marked_by: auth.userId,
    scan_distance_m: null,
  });

  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.ATTENDANCE_MANUAL,
    entityType: 'attendance',
    entityId: row.id,
    metadata: { student_id: student.id, meal_type: body.meal_type, date: body.date, reason: body.reason },
    meta,
  });
  return toAttendanceDto(row);
}
