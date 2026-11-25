import type { PaymentMethod, PaymentStatus } from '../../config/constants';
import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';
import * as studentsRepository from '../students/students.repository';
import type { SubscriptionRow } from '../subscriptions/subscriptions.dto';

export interface PaidTo {
  account_title: string;
  account_number: string;
  bank_name: string | null;
  merchant_name: string | null;
}

export interface PaymentRow {
  id: string;
  mess_id: string;
  student_id: string;
  payment_account_id: string;
  method: PaymentMethod;
  paid_to: PaidTo;
  amount: number | string;
  transaction_id: string;
  screenshot_public_id: string;
  screenshot_url: string;
  screenshot_etag: string | null;
  screenshot_bytes: number | null;
  status: PaymentStatus;
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  student?: { id: string; student_code: string; full_name: string; phone: string | null; email: string } | null;
  reviewer?: { id: string; full_name: string } | null;
  /** One-to-one embed: PostgREST returns an object (or null); tolerate an array too. */
  subscription?: { id: string } | { id: string }[] | null;
}

const BASE =
  'id, mess_id, student_id, payment_account_id, method, paid_to, amount, transaction_id, screenshot_public_id, ' +
  'screenshot_url, screenshot_etag, screenshot_bytes, status, rejection_reason, submitted_at, reviewed_by, reviewed_at';
const WITH_RELATIONS = `${BASE}, student:students(id, student_code, full_name, phone, email), reviewer:admins(id, full_name), subscription:subscriptions(id)`;

const asRow = (data: unknown): PaymentRow => data as PaymentRow;

export interface NewPayment {
  mess_id: string;
  student_id: string;
  payment_account_id: string;
  method: PaymentMethod;
  paid_to: PaidTo;
  amount: string;
  transaction_id: string;
  screenshot_public_id: string;
  screenshot_url: string;
  screenshot_etag: string | null;
  screenshot_bytes: number;
}

/** Unique indexes surface as mapped AppErrors (PENDING_PAYMENT_EXISTS, DUPLICATE_TRANSACTION). */
export async function insert(payment: NewPayment): Promise<PaymentRow> {
  const { data, error } = await getDb().from('payments').insert(payment).select(WITH_RELATIONS).single();
  throwIfError(error);
  return asRow(data);
}

export async function hasPendingPayment(studentId: string): Promise<boolean> {
  const { data, error } = await getDb()
    .from('payments')
    .select('id')
    .eq('student_id', studentId)
    .eq('status', 'pending')
    .limit(1);
  throwIfError(error);
  return (data?.length ?? 0) > 0;
}

export async function isAssetUsed(publicId: string): Promise<boolean> {
  const { data, error } = await getDb().from('payments').select('id').eq('screenshot_public_id', publicId).limit(1);
  throwIfError(error);
  return (data?.length ?? 0) > 0;
}

export async function findForStudent(id: string, studentId: string): Promise<PaymentRow | null> {
  const { data, error } = await getDb()
    .from('payments')
    .select(WITH_RELATIONS)
    .eq('id', id)
    .eq('student_id', studentId)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

export async function findForAdmin(id: string, messId: string): Promise<PaymentRow | null> {
  const { data, error } = await getDb()
    .from('payments')
    .select(WITH_RELATIONS)
    .eq('id', id)
    .eq('mess_id', messId)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

export interface Paged<T> {
  rows: T[];
  total: number;
}

export async function listForStudent(
  studentId: string,
  status: PaymentStatus | undefined,
  from: number,
  to: number,
): Promise<Paged<PaymentRow>> {
  let query = getDb()
    .from('payments')
    .select(WITH_RELATIONS, { count: 'exact' })
    .eq('student_id', studentId);
  if (status) query = query.eq('status', status);
  const { data, error, count } = await query.order('submitted_at', { ascending: false }).range(from, to);
  throwIfError(error);
  return { rows: ((data as unknown[] | null) ?? []).map(asRow), total: count ?? 0 };
}

export interface AdminListFilters {
  messId: string;
  status: PaymentStatus | 'all';
  method?: PaymentMethod;
  paymentAccountId?: string;
  /** Free text: student name/code/email or transaction id. */
  q?: string;
  /** ISO instants (inclusive start, exclusive end) on submitted_at. */
  fromIso?: string;
  toIso?: string;
  /** For the student of a given id (student detail screen). */
  studentId?: string;
  from: number;
  to: number;
}

export async function listForAdmin(f: AdminListFilters): Promise<Paged<PaymentRow>> {
  let query = getDb().from('payments').select(WITH_RELATIONS, { count: 'exact' }).eq('mess_id', f.messId);

  if (f.status !== 'all') query = query.eq('status', f.status);
  if (f.method) query = query.eq('method', f.method);
  if (f.paymentAccountId) query = query.eq('payment_account_id', f.paymentAccountId);
  if (f.studentId) query = query.eq('student_id', f.studentId);
  if (f.fromIso) query = query.gte('submitted_at', f.fromIso);
  if (f.toIso) query = query.lt('submitted_at', f.toIso);

  if (f.q) {
    const safe = f.q.replace(/[^A-Za-z0-9 @._-]/g, '').trim();
    if (safe.length >= 2) {
      const ids = await studentsRepository.searchIds(f.messId, safe);
      const parts = [`transaction_id.ilike.*${safe}*`];
      if (ids.length > 0) parts.push(`student_id.in.(${ids.join(',')})`);
      query = query.or(parts.join(','));
    }
  }

  // Pending: oldest first (work the queue in order). Everything else: newest first.
  const oldestFirst = f.status === 'pending';
  const { data, error, count } = await query
    .order('submitted_at', { ascending: oldestFirst })
    .range(f.from, f.to);
  throwIfError(error);
  return { rows: ((data as unknown[] | null) ?? []).map(asRow), total: count ?? 0 };
}

/** Student cancels their own payment, only while pending. Returns null when it was not pending/owned. */
export async function cancelPending(id: string, studentId: string): Promise<PaymentRow | null> {
  const { data, error } = await getDb()
    .from('payments')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('student_id', studentId)
    .eq('status', 'pending')
    .select(WITH_RELATIONS)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

/** Conditional update: only a still-pending payment can be rejected (races lose with null). */
export async function rejectPending(
  id: string,
  messId: string,
  adminId: string,
  reason: string,
  reviewedAt: string,
): Promise<PaymentRow | null> {
  const { data, error } = await getDb()
    .from('payments')
    .update({ status: 'rejected', rejection_reason: reason, reviewed_by: adminId, reviewed_at: reviewedAt })
    .eq('id', id)
    .eq('mess_id', messId)
    .eq('status', 'pending')
    .select(WITH_RELATIONS)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

/** Atomic approval + subscription activation + audit (SQL function `approve_payment`). */
export async function approve(paymentId: string, adminId: string): Promise<SubscriptionRow> {
  const { data, error } = await getDb().rpc('approve_payment', { p_payment_id: paymentId, p_admin_id: adminId });
  throwIfError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return row as SubscriptionRow;
}

export interface DuplicateHit {
  id: string;
  status: PaymentStatus;
  student_name: string;
}

/** Other payments with the same transaction id or the same screenshot hash (hints for the admin). */
export async function findDuplicateSignals(payment: PaymentRow): Promise<{
  sameTransaction: DuplicateHit[];
  sameScreenshot: DuplicateHit[];
}> {
  const select = 'id, status, student:students(full_name)';
  const toHit = (r: unknown): DuplicateHit => {
    const row = r as { id: string; status: PaymentStatus; student?: { full_name?: string } | null };
    return { id: row.id, status: row.status, student_name: row.student?.full_name ?? '' };
  };

  const sameTxn = await getDb()
    .from('payments')
    .select(select)
    .eq('mess_id', payment.mess_id)
    .ilike('transaction_id', payment.transaction_id)
    .neq('id', payment.id)
    .limit(10);
  throwIfError(sameTxn.error);

  let sameShot: unknown[] = [];
  if (payment.screenshot_etag) {
    const res = await getDb()
      .from('payments')
      .select(select)
      .eq('mess_id', payment.mess_id)
      .eq('screenshot_etag', payment.screenshot_etag)
      .neq('id', payment.id)
      .limit(10);
    throwIfError(res.error);
    sameShot = (res.data as unknown[] | null) ?? [];
  }

  return {
    sameTransaction: ((sameTxn.data as unknown[] | null) ?? []).map(toHit),
    sameScreenshot: sameShot.map(toHit),
  };
}

export interface LatestPayment {
  id: string;
  status: PaymentStatus;
  submitted_at: string;
  rejection_reason: string | null;
}

/** The student's most recent payment (dashboard banner). */
export async function findLatestForStudent(studentId: string): Promise<LatestPayment | null> {
  const { data, error } = await getDb()
    .from('payments')
    .select('id, status, submitted_at, rejection_reason')
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(error);
  return (data as LatestPayment | null) ?? null;
}
