import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';
import * as studentsRepository from '../students/students.repository';
import type { SubscriptionRow } from './subscriptions.dto';

const COLUMNS = 'id, mess_id, student_id, payment_id, start_date, end_date, status, amount, created_at';
const FULL = `${COLUMNS}, cancelled_at, cancelled_by, cancel_reason, student:students(id, student_code, full_name)`;
const asRow = (d: unknown): SubscriptionRow => d as SubscriptionRow;
const asRows = (d: unknown): SubscriptionRow[] => (d as SubscriptionRow[] | null) ?? [];

/**
 * The subscription that covers `date` for attendance (BR-04): status active/scheduled and the date
 * inside [start_date, end_date]. Date-based, so it never depends on the nightly status job.
 */
export async function findCovering(
  studentId: string,
  date: string,
  options: { includeExpired?: boolean } = {},
): Promise<SubscriptionRow | null> {
  const { data, error } = await getDb()
    .from('subscriptions')
    .select(COLUMNS)
    .eq('student_id', studentId)
    .in('status', options.includeExpired ? ['active', 'scheduled', 'expired'] : ['active', 'scheduled'])
    .lte('start_date', date)
    .gte('end_date', date)
    .limit(1)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

/** Non-cancelled subscriptions overlapping [from, to] (calendar coverage). */
export async function listOverlapping(studentId: string, from: string, to: string): Promise<SubscriptionRow[]> {
  const { data, error } = await getDb()
    .from('subscriptions')
    .select(COLUMNS)
    .eq('student_id', studentId)
    .neq('status', 'cancelled')
    .lte('start_date', to)
    .gte('end_date', from)
    .order('start_date', { ascending: true });
  throwIfError(error);
  return asRows(data);
}

/** A student's most recent non-cancelled subscriptions (enough to find current / next / last expired). */
export async function listRecentNonCancelled(studentId: string, limit = 12): Promise<SubscriptionRow[]> {
  const { data, error } = await getDb()
    .from('subscriptions')
    .select(COLUMNS)
    .eq('student_id', studentId)
    .neq('status', 'cancelled')
    .order('start_date', { ascending: false })
    .limit(limit);
  throwIfError(error);
  return asRows(data);
}

/** A student's full history (all statuses), newest first. */
export async function listForStudent(
  studentId: string,
  from: number,
  to: number,
): Promise<{ rows: SubscriptionRow[]; total: number }> {
  const { data, error, count } = await getDb()
    .from('subscriptions')
    .select(COLUMNS, { count: 'exact' })
    .eq('student_id', studentId)
    .order('start_date', { ascending: false })
    .range(from, to);
  throwIfError(error);
  return { rows: asRows(data), total: count ?? 0 };
}

export type EffectiveFilter = 'active' | 'scheduled' | 'expired' | 'cancelled';

export interface AdminListFilters {
  messId: string;
  today: string;
  status?: EffectiveFilter;
  /** Active subscriptions whose last day is within the next N days (inclusive). Implies status=active. */
  expiringBy?: string;
  q?: string;
  from: number;
  to: number;
}

/**
 * Admin list. The status filter is applied on DATES (like the API shows it), not on the stored
 * status, so results are right even when the nightly job is late.
 */
export async function listForAdmin(f: AdminListFilters): Promise<{ rows: SubscriptionRow[]; total: number }> {
  let query = getDb().from('subscriptions').select(FULL, { count: 'exact' }).eq('mess_id', f.messId);

  const status = f.expiringBy ? 'active' : f.status;
  if (status === 'active') {
    query = query.in('status', ['active', 'scheduled']).lte('start_date', f.today).gte('end_date', f.today);
  } else if (status === 'scheduled') {
    query = query.in('status', ['active', 'scheduled']).gt('start_date', f.today);
  } else if (status === 'expired') {
    query = query.neq('status', 'cancelled').lt('end_date', f.today);
  } else if (status === 'cancelled') {
    query = query.eq('status', 'cancelled');
  }
  if (f.expiringBy) query = query.lte('end_date', f.expiringBy);

  if (f.q) {
    const ids = await studentsRepository.searchIds(f.messId, f.q);
    if (ids.length === 0) return { rows: [], total: 0 };
    query = query.in('student_id', ids);
  }

  const soonestFirst = status === 'active';
  const { data, error, count } = await query
    .order(soonestFirst ? 'end_date' : 'start_date', { ascending: soonestFirst })
    .range(f.from, f.to);
  throwIfError(error);
  return { rows: asRows(data), total: count ?? 0 };
}

export interface AdminDetail {
  row: SubscriptionRow;
  payment: { id: string; transaction_id: string | null; method: string; amount: number | string; reviewed_at: string | null } | null;
  attendanceCount: number;
}

export async function findDetailForAdmin(id: string, messId: string): Promise<AdminDetail | null> {
  const { data, error } = await getDb()
    .from('subscriptions')
    .select(`${FULL}, payment:payments(id, transaction_id, method, amount, reviewed_at)`)
    .eq('id', id)
    .eq('mess_id', messId)
    .maybeSingle();
  throwIfError(error);
  if (!data) return null;

  const { count, error: countError } = await getDb()
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('subscription_id', id);
  throwIfError(countError);

  const { payment, ...row } = data as unknown as SubscriptionRow & { payment: AdminDetail['payment'] };
  return { row: row as SubscriptionRow, payment: payment ?? null, attendanceCount: count ?? 0 };
}

export async function findByIdForMess(id: string, messId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await getDb().from('subscriptions').select(FULL).eq('id', id).eq('mess_id', messId).maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

/** Conditional: only an active/scheduled subscription can be cancelled (null = lost a race / not cancellable). */
export async function cancel(
  id: string,
  messId: string,
  adminId: string,
  reason: string,
  cancelledAt: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await getDb()
    .from('subscriptions')
    .update({ status: 'cancelled', cancelled_at: cancelledAt, cancelled_by: adminId, cancel_reason: reason })
    .eq('id', id)
    .eq('mess_id', messId)
    .in('status', ['active', 'scheduled'])
    .select(FULL)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

/** How many non-cancelled subscriptions of the student start after `date` (warns about gaps after a cancel). */
export async function countStartingAfter(studentId: string, date: string): Promise<number> {
  const { count, error } = await getDb()
    .from('subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .neq('status', 'cancelled')
    .gt('start_date', date);
  throwIfError(error);
  return count ?? 0;
}

// ---------------------------------------------------------------- nightly jobs

/** SQL function: scheduled -> active, active -> expired (by each mess's local date). Returns rows changed. */
export async function refreshStatuses(): Promise<number> {
  const { data, error } = await getDb().rpc('refresh_subscription_statuses');
  throwIfError(error);
  return Number(data ?? 0);
}

export interface EndingRow {
  id: string;
  student_id: string;
  start_date: string;
  end_date: string;
  student: { is_active: boolean } | null;
}

/** Non-cancelled subscriptions of a mess whose last day is `date` (reminder candidates). */
export async function findEndingOn(messId: string, date: string): Promise<EndingRow[]> {
  const { data, error } = await getDb()
    .from('subscriptions')
    .select('id, student_id, start_date, end_date, student:students(is_active)')
    .eq('mess_id', messId)
    .neq('status', 'cancelled')
    .eq('end_date', date);
  throwIfError(error);
  return (data as unknown as EndingRow[] | null) ?? [];
}
