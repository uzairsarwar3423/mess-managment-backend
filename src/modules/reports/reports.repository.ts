import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';

export interface DashboardCounts {
  lunch_today: number;
  dinner_today: number;
  active_students: number;
  students_with_active_subscription: number;
  pending_payments: number;
  expiring_soon: number;
  revenue_month: number | string;
  active_qr_codes: number;
}

/** SQL function `admin_dashboard_counts`: every dashboard number in one round trip. */
export async function dashboardCounts(params: {
  messId: string;
  date: string;
  monthStart: string;
  monthNext: string;
  expiringBy: string;
}): Promise<DashboardCounts> {
  const { data, error } = await getDb().rpc('admin_dashboard_counts', {
    p_mess_id: params.messId,
    p_date: params.date,
    p_month_start: params.monthStart,
    p_month_next: params.monthNext,
    p_expiring_by: params.expiringBy,
  });
  throwIfError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return row as DashboardCounts;
}

export interface OverviewRow {
  month: string;
  revenue: number | string;
  payments_approved: number;
  payments_rejected: number;
  lunch_total: number;
  dinner_total: number;
  students_with_coverage: number;
  daily: { date: string; lunch: number; dinner: number }[];
}

/** SQL function `report_overview`: month analytics as one JSON document. */
export async function overview(messId: string, firstDayOfMonth: string): Promise<OverviewRow> {
  const { data, error } = await getDb().rpc('report_overview', { p_mess_id: messId, p_month: firstDayOfMonth });
  throwIfError(error);
  return data as OverviewRow;
}

export interface LedgerRow {
  id: string;
  method: string;
  amount: number | string;
  transaction_id: string | null;
  status: string;
  submitted_at: string;
  reviewed_at: string | null;
  paid_to: { account_title?: string; account_number?: string; bank_name?: string | null } | null;
  student: { student_code: string; full_name: string } | null;
  reviewer: { full_name: string } | null;
}

const PAGE = 1000; // PostgREST returns at most 1000 rows per request
const MAX_ROWS = 20_000; // safety valve

/**
 * Every payment of a mess decided/submitted inside [fromIso, toIso), oldest first. Approved and
 * rejected payments are dated by when they were decided, the others by when they were submitted.
 * Paged internally so a busy month is not silently cut at 1000 rows.
 */
export async function paymentsLedger(params: {
  messId: string;
  status: 'approved' | 'rejected' | 'pending' | 'cancelled' | 'all';
  fromIso: string;
  toIso: string;
}): Promise<LedgerRow[]> {
  const dateColumn = params.status === 'approved' || params.status === 'rejected' ? 'reviewed_at' : 'submitted_at';
  const all: LedgerRow[] = [];

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let query = getDb()
      .from('payments')
      .select(
        'id, method, amount, transaction_id, status, submitted_at, reviewed_at, paid_to, student:students(student_code, full_name), reviewer:admins(full_name)',
      )
      .eq('mess_id', params.messId)
      .gte(dateColumn, params.fromIso)
      .lt(dateColumn, params.toIso);
    if (params.status !== 'all') query = query.eq('status', params.status);

    const { data, error } = await query.order(dateColumn, { ascending: true }).order('id').range(offset, offset + PAGE - 1);
    throwIfError(error);
    const rows = (data as unknown as LedgerRow[] | null) ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}
