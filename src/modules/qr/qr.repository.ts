import type { QrStatus } from '../../config/constants';
import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';

export interface QrCodeRow {
  id: string;
  mess_id: string;
  label: string;
  status: QrStatus;
  created_by: string;
  created_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  creator?: { id: string; full_name: string } | null;
}

export interface QrStats {
  qr_code_id: string;
  scans_today: number;
  scans_total: number;
  last_scan_at: string | null;
}

const COLUMNS =
  'id, mess_id, label, status, created_by, created_at, revoked_by, revoked_at, revoke_reason, creator:admins!qr_codes_created_by_fkey(id, full_name)';
const asRow = (d: unknown): QrCodeRow => d as QrCodeRow;

/** `uq_qr_label_active` surfaces as QR_LABEL_EXISTS. */
export async function insert(messId: string, label: string, createdBy: string): Promise<QrCodeRow> {
  const { data, error } = await getDb()
    .from('qr_codes')
    .insert({ mess_id: messId, label, created_by: createdBy })
    .select(COLUMNS)
    .single();
  throwIfError(error);
  return asRow(data);
}

/** Unscoped lookup used by the scan path (the caller compares mess ids itself). */
export async function findByIdAnyMess(id: string): Promise<QrCodeRow | null> {
  const { data, error } = await getDb().from('qr_codes').select(COLUMNS).eq('id', id).maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

export async function findById(id: string, messId: string): Promise<QrCodeRow | null> {
  const { data, error } = await getDb()
    .from('qr_codes')
    .select(COLUMNS)
    .eq('id', id)
    .eq('mess_id', messId)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

export async function list(
  messId: string,
  status: QrStatus | 'all',
  from: number,
  to: number,
): Promise<{ rows: QrCodeRow[]; total: number }> {
  let query = getDb().from('qr_codes').select(COLUMNS, { count: 'exact' }).eq('mess_id', messId);
  if (status !== 'all') query = query.eq('status', status);
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to);
  throwIfError(error);
  return { rows: ((data as unknown[] | null) ?? []).map(asRow), total: count ?? 0 };
}

/** Conditional: only an active code can be revoked (null = already revoked or not found). */
export async function revokeActive(
  id: string,
  messId: string,
  adminId: string,
  reason: string,
  revokedAt: string,
): Promise<QrCodeRow | null> {
  const { data, error } = await getDb()
    .from('qr_codes')
    .update({ status: 'revoked', revoked_by: adminId, revoked_at: revokedAt, revoke_reason: reason })
    .eq('id', id)
    .eq('mess_id', messId)
    .eq('status', 'active')
    .select(COLUMNS)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

export async function stats(messId: string, date: string): Promise<QrStats[]> {
  const { data, error } = await getDb().rpc('qr_scan_stats', { p_mess_id: messId, p_date: date });
  throwIfError(error);
  return (data as QrStats[] | null) ?? [];
}
