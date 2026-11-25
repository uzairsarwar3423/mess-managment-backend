import type { SubscriptionStatus } from '../../config/constants';
import { daysRemaining } from '../settings/time';

export interface SubscriptionRow {
  id: string;
  mess_id: string;
  student_id: string;
  payment_id: string;
  start_date: string;
  end_date: string;
  /** Stored status. It can lag behind the dates (nightly job): always present `effectiveStatus`. */
  status: SubscriptionStatus;
  amount: number | string;
  created_at: string;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  student?: { id: string; student_code: string; full_name: string } | null;
}

/**
 * The status as of `today`, computed from the DATES (BR-13), so the API is correct even if the
 * nightly job has not run yet. Only `cancelled` is taken from the stored value.
 */
export function effectiveStatus(row: Pick<SubscriptionRow, 'status' | 'start_date' | 'end_date'>, today: string): SubscriptionStatus {
  if (row.status === 'cancelled') return 'cancelled';
  if (row.end_date < today) return 'expired';
  if (row.start_date > today) return 'scheduled';
  return 'active';
}

/**
 * API shape (docs/api-documentation.md "SubscriptionDto"). `today` is the server's business date.
 * A scheduled subscription counts its days from its own start, not from today.
 */
export function toSubscriptionDto(row: SubscriptionRow, today: string, reminderDays: number) {
  const status = effectiveStatus(row, today);
  const countFrom = status === 'scheduled' ? row.start_date : today;
  const remaining = status === 'expired' || status === 'cancelled' ? 0 : daysRemaining(row.end_date, countFrom);
  return {
    id: row.id,
    status,
    start_date: row.start_date,
    end_date: row.end_date,
    amount: Number(row.amount).toFixed(2),
    days_remaining: remaining,
    is_expiring_soon: status === 'active' && remaining <= reminderDays,
    payment_id: row.payment_id,
    created_at: row.created_at,
  };
}

/** Admin view: the same plus the student and cancellation details. */
export function toAdminSubscriptionDto(row: SubscriptionRow, today: string, reminderDays: number) {
  return {
    ...toSubscriptionDto(row, today, reminderDays),
    student: row.student
      ? { id: row.student.id, student_code: row.student.student_code, full_name: row.student.full_name }
      : null,
    cancelled_at: row.cancelled_at ?? null,
    cancel_reason: row.cancel_reason ?? null,
  };
}
