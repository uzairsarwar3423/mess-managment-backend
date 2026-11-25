import { AppError } from '../../common/errors/AppError';
import { buildMeta } from '../../common/http/respond';
import type { AuthContext, RequestMeta } from '../../common/types';
import { now } from '../../lib/clock';
import { logger } from '../../lib/logger';
import * as attendance from '../attendance/attendance.service';
import * as auditService from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/auditActions';
import * as authRepository from '../auth/auth.repository';
import * as notificationsRepository from '../notifications/notifications.repository';
import * as paymentsRepository from '../payments/payments.repository';
import * as paymentsService from '../payments/payments.service';
import { loadMessConfig } from '../settings/settings.service';
import { addDays, businessDate } from '../settings/time';
import * as subscriptions from '../subscriptions/subscriptions.service';
import * as uploads from '../uploads/uploads.service';
import { toStudentDto } from './students.dto';
import * as repository from './students.repository';
import type { StudentRow } from './students.repository';
import type {
  AdminListQuery,
  SetStatusBody,
  StudentAttendanceQuery,
  UpdateProfileBody,
} from './students.schemas';

// ---------------------------------------------------------------- student: profile

async function requireSelf(auth: AuthContext): Promise<StudentRow> {
  const row = await repository.findById(auth.userId);
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}

export async function getProfile(auth: AuthContext) {
  return toStudentDto(await requireSelf(auth));
}

/** Email cannot be changed here; `.strict()` schemas already reject any other field. */
export async function updateProfile(auth: AuthContext, body: UpdateProfileBody) {
  const row = await repository.updateProfile(auth.userId, body);
  if (!row) throw new AppError('NOT_FOUND');
  return toStudentDto(row);
}

/**
 * Attach an uploaded avatar: verified with Cloudinary (own folder, format, size), then the previous
 * asset is deleted. Avatars are public assets, so the stored URL is used directly by the app.
 */
export async function setProfileImage(auth: AuthContext, publicId: string) {
  const current = await requireSelf(auth);
  const asset = await uploads.verifyAsset(auth.userId, 'profile_image', publicId);

  const row = await repository.setProfileImage(auth.userId, { url: asset.secureUrl, publicId: asset.publicId });
  if (!row) throw new AppError('NOT_FOUND');

  if (current.profile_image_public_id && current.profile_image_public_id !== asset.publicId) {
    await uploads.deleteAsset(current.profile_image_public_id, 'upload');
  }
  return toStudentDto(row);
}

export async function removeProfileImage(auth: AuthContext) {
  const current = await requireSelf(auth);
  const row = await repository.setProfileImage(auth.userId, null);
  if (!row) throw new AppError('NOT_FOUND');
  if (current.profile_image_public_id) await uploads.deleteAsset(current.profile_image_public_id, 'upload');
  return toStudentDto(row);
}

// ---------------------------------------------------------------- student: dashboard

/** One call for the Home screen (docs/api-documentation.md section 4). */
export async function getDashboard(auth: AuthContext) {
  const [student, subscription, today, monthSummary, latestPayment, unread] = await Promise.all([
    requireSelf(auth),
    subscriptions.getMyState(auth),
    attendance.today(auth),
    attendance.monthSummary(auth.messId, auth.userId),
    paymentsRepository.findLatestForStudent(auth.userId),
    notificationsRepository.countUnread(auth.userId),
  ]);

  return {
    server_time: today.server_time,
    server_date: subscription.server_date,
    student: {
      id: student.id,
      full_name: student.full_name,
      student_code: student.student_code,
      profile_image_url: student.profile_image_url,
    },
    subscription: {
      status_summary: subscription.status_summary,
      current: subscription.current,
      next: subscription.next,
    },
    today: {
      date: today.date,
      current_meal: today.current_meal,
      next_window: today.next_window,
      location_required: today.location_required,
      lunch: today.lunch,
      dinner: today.dinner,
    },
    latest_payment: latestPayment
      ? {
          id: latestPayment.id,
          status: latestPayment.status,
          submitted_at: latestPayment.submitted_at,
          rejection_reason: latestPayment.rejection_reason,
        }
      : null,
    month_summary: monthSummary,
    unread_notifications: unread,
  };
}

// ---------------------------------------------------------------- admin

/** An admin may only look at students of their own mess; anything else is NOT_FOUND. */
async function requireInMess(auth: AuthContext, id: string): Promise<StudentRow> {
  const row = await repository.findInMess(id, auth.messId);
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}

export async function listForAdmin(auth: AuthContext, query: AdminListQuery) {
  const config = await loadMessConfig(auth.messId);
  const today = businessDate(now(), config.timezone);
  // "days_remaining <= reminder days" <=> last day <= today + reminder - 1 (same rule as is_expiring_soon)
  const expiringBy = addDays(today, config.expiryReminderDays - 1);

  const { rows, total } = await repository.listForAdmin({
    messId: auth.messId,
    today,
    q: query.q,
    active: query.status === undefined ? undefined : query.status === 'active',
    subscription: query.subscription,
    expiringBy,
    sort: query.sort,
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  return {
    data: rows.map((r) => ({
      id: r.id,
      student_code: r.student_code,
      email: r.email,
      full_name: r.full_name,
      phone: r.phone,
      roll_number: r.roll_number,
      profile_image_url: r.profile_image_url,
      is_active: r.is_active,
      created_at: r.created_at,
      subscription_status: r.subscription_status,
      subscription_end_date: r.subscription_end_date,
      subscription_expiring_soon: r.subscription_status === 'active' && (r.subscription_end_date ?? '9999') <= expiringBy,
    })),
    meta: buildMeta(query.page, query.limit, total),
  };
}

export async function getForAdmin(auth: AuthContext, id: string) {
  const student = await requireInMess(auth, id);
  const [state, latestPayment, month] = await Promise.all([
    subscriptions.getStateFor(auth.messId, id),
    paymentsRepository.findLatestForStudent(id),
    attendance.monthSummary(auth.messId, id),
  ]);
  return {
    ...toStudentDto(student),
    subscription_status: state.status_summary,
    current_subscription: state.current,
    next_subscription: state.next,
    latest_payment: latestPayment,
    month_attendance: { month: month.month, lunch_count: month.lunch_count, dinner_count: month.dinner_count },
  };
}

/**
 * Enables/disables a student (BR-16). Takes effect on their very next request (authenticate checks
 * `is_active` every time); Supabase sign-in is also blocked so refresh tokens stop working.
 */
export async function setStatus(auth: AuthContext, id: string, body: SetStatusBody, meta: RequestMeta) {
  const student = await requireInMess(auth, id);
  if (student.is_active === body.is_active) return toStudentDto(student); // nothing to change

  const row = await repository.setActive(id, auth.messId, body.is_active);
  if (!row) throw new AppError('NOT_FOUND');

  try {
    await authRepository.setBanned(id, !body.is_active);
  } catch (err) {
    // The profile flag already blocks the API; log and continue.
    logger.warn({ err, student_id: id }, 'could not update the Supabase ban flag');
  }

  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: body.is_active ? AUDIT_ACTIONS.STUDENT_ACTIVATE : AUDIT_ACTIONS.STUDENT_DEACTIVATE,
    entityType: 'student',
    entityId: id,
    metadata: { reason: body.reason ?? null, student_code: student.student_code },
    meta,
  });
  return toStudentDto(row);
}

export async function listSubscriptionsForAdmin(auth: AuthContext, id: string, query: { page: number; limit: number }) {
  await requireInMess(auth, id);
  return subscriptions.listHistoryFor(auth.messId, id, query);
}

export async function listPaymentsForAdmin(
  auth: AuthContext,
  id: string,
  query: Parameters<typeof paymentsService.listForAdmin>[1],
) {
  await requireInMess(auth, id);
  return paymentsService.listForAdmin(auth, query, id);
}

/** `month` -> the calendar view; otherwise a paged history of a date range. */
export async function attendanceForAdmin(auth: AuthContext, id: string, query: StudentAttendanceQuery) {
  await requireInMess(auth, id);
  if (query.month) {
    return { kind: 'calendar' as const, calendar: await attendance.calendarFor(auth.messId, id, { month: query.month }) };
  }
  const { data, meta } = await attendance.historyFor(auth.messId, id, query);
  return { kind: 'history' as const, data, meta };
}
