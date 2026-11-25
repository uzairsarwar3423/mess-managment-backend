import { AppError } from '../../common/errors/AppError';
import { buildMeta } from '../../common/http/respond';
import { toRange } from '../../common/pagination';
import type { AuthContext, RequestMeta } from '../../common/types';
import { now } from '../../lib/clock';
import * as auditService from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/auditActions';
import * as notifications from '../notifications/notifications.service';
import { templates } from '../notifications/templates';
import { loadMessConfig } from '../settings/settings.service';
import { addDays, businessDate } from '../settings/time';
import {
  effectiveStatus,
  toAdminSubscriptionDto,
  toSubscriptionDto,
  type SubscriptionRow,
} from './subscriptions.dto';
import * as repository from './subscriptions.repository';
import type { AdminListQuery, CancelBody, StudentHistoryQuery } from './subscriptions.schemas';

async function context(messId: string) {
  const config = await loadMessConfig(messId);
  return { config, today: businessDate(now(), config.timezone) };
}

// ---------------------------------------------------------------- student

export type StatusSummary = 'active' | 'expiring_soon' | 'expired' | 'scheduled' | 'none';

/**
 * Where the student stands today (docs/api-documentation.md section 5). Computed from the dates, so it
 * is right even if the nightly job is late.
 */
export async function getStateFor(messId: string, studentId: string) {
  const { config, today } = await context(messId);
  const rows = await repository.listRecentNonCancelled(studentId);
  const dto = (r: SubscriptionRow) => toSubscriptionDto(r, today, config.expiryReminderDays);

  const status = (r: SubscriptionRow) => effectiveStatus(r, today);
  const current = rows.find((r) => status(r) === 'active') ?? null;
  const next =
    rows.filter((r) => status(r) === 'scheduled').sort((a, b) => a.start_date.localeCompare(b.start_date))[0] ?? null;
  const lastExpired =
    rows.filter((r) => status(r) === 'expired').sort((a, b) => b.end_date.localeCompare(a.end_date))[0] ?? null;

  const currentDto = current ? dto(current) : null;
  let summary: StatusSummary;
  if (currentDto) summary = currentDto.is_expiring_soon ? 'expiring_soon' : 'active';
  else if (next) summary = 'scheduled';
  else if (lastExpired) summary = 'expired';
  else summary = 'none';

  return {
    server_date: today,
    status_summary: summary,
    current: currentDto,
    next: next ? dto(next) : null,
    last_expired: lastExpired ? dto(lastExpired) : null,
  };
}

export const getMyState = (auth: AuthContext) => getStateFor(auth.messId, auth.userId);

/** A student's full history, newest first (the student themself, or an admin looking at a student). */
export async function listHistoryFor(messId: string, studentId: string, query: StudentHistoryQuery) {
  const { config, today } = await context(messId);
  const { from, to } = toRange(query.page, query.limit);
  const { rows, total } = await repository.listForStudent(studentId, from, to);
  return {
    data: rows.map((r) => toSubscriptionDto(r, today, config.expiryReminderDays)),
    meta: buildMeta(query.page, query.limit, total),
  };
}

export const listMine = (auth: AuthContext, query: StudentHistoryQuery) => listHistoryFor(auth.messId, auth.userId, query);

// ---------------------------------------------------------------- admin

export async function listForAdmin(auth: AuthContext, query: AdminListQuery) {
  const { config, today } = await context(auth.messId);
  const { from, to } = toRange(query.page, query.limit);
  const { rows, total } = await repository.listForAdmin({
    messId: auth.messId,
    today,
    status: query.status,
    expiringBy: query.expiring_within_days ? addDays(today, query.expiring_within_days) : undefined,
    q: query.q,
    from,
    to,
  });
  return {
    data: rows.map((r) => toAdminSubscriptionDto(r, today, config.expiryReminderDays)),
    meta: buildMeta(query.page, query.limit, total),
  };
}

export async function getForAdmin(auth: AuthContext, id: string) {
  const { config, today } = await context(auth.messId);
  const detail = await repository.findDetailForAdmin(id, auth.messId); // scoped to the admin's mess
  if (!detail) throw new AppError('NOT_FOUND');
  return {
    ...toAdminSubscriptionDto(detail.row, today, config.expiryReminderDays),
    payment: detail.payment
      ? {
          id: detail.payment.id,
          transaction_id: detail.payment.transaction_id,
          method: detail.payment.method,
          amount: Number(detail.payment.amount).toFixed(2),
          reviewed_at: detail.payment.reviewed_at,
        }
      : null,
    attendance_count: detail.attendanceCount,
  };
}

/**
 * Cancels an active or scheduled subscription (reason mandatory, audited). Past attendance is
 * untouched; future scans fail. Cancelling a period that has a renewal queued behind it leaves a gap, so
 * the response says how many later periods exist and the app can warn the admin.
 */
export async function cancel(auth: AuthContext, id: string, body: CancelBody, meta: RequestMeta) {
  const { config, today } = await context(auth.messId);
  const existing = await repository.findByIdForMess(id, auth.messId);
  if (!existing) throw new AppError('NOT_FOUND');

  const status = effectiveStatus(existing, today);
  if (status !== 'active' && status !== 'scheduled') throw new AppError('SUBSCRIPTION_NOT_CANCELLABLE');

  const cancelled = await repository.cancel(id, auth.messId, auth.userId, body.reason, now().toISOString());
  if (!cancelled) throw new AppError('SUBSCRIPTION_NOT_CANCELLABLE'); // another admin got there first

  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.SUBSCRIPTION_CANCEL,
    entityType: 'subscription',
    entityId: id,
    metadata: {
      student_id: existing.student_id,
      reason: body.reason,
      previous_status: status,
      start_date: existing.start_date,
      end_date: existing.end_date,
    },
    meta,
  });

  await notifications.notifyStudent({
    messId: auth.messId,
    studentId: existing.student_id,
    type: 'general',
    ...templates.subscriptionCancelled(body.reason),
    data: { subscription_id: id },
  });

  const laterPeriods = await repository.countStartingAfter(existing.student_id, existing.end_date);
  return {
    subscription: toAdminSubscriptionDto(cancelled, today, config.expiryReminderDays),
    later_periods: laterPeriods,
  };
}
