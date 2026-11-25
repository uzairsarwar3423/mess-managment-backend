import type { AdminRole } from '../../config/constants';
import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';

export interface AdminRow {
  id: string;
  mess_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: AdminRole;
  is_active: boolean;
  created_at: string;
}

const COLUMNS = 'id, mess_id, email, full_name, phone, role, is_active, created_at';

export async function findById(id: string): Promise<AdminRow | null> {
  const { data, error } = await getDb().from('admins').select(COLUMNS).eq('id', id).maybeSingle();
  throwIfError(error);
  return (data as AdminRow | null) ?? null;
}

export async function findInMess(id: string, messId: string): Promise<AdminRow | null> {
  const { data, error } = await getDb().from('admins').select(COLUMNS).eq('id', id).eq('mess_id', messId).maybeSingle();
  throwIfError(error);
  return (data as AdminRow | null) ?? null;
}

export async function list(messId: string, from: number, to: number): Promise<{ rows: AdminRow[]; total: number }> {
  const { data, error, count } = await getDb()
    .from('admins')
    .select(COLUMNS, { count: 'exact' })
    .eq('mess_id', messId)
    .order('full_name', { ascending: true })
    .range(from, to);
  throwIfError(error);
  return { rows: (data as AdminRow[] | null) ?? [], total: count ?? 0 };
}

export interface NewAdmin {
  id: string;
  mess_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: AdminRole;
  created_by: string;
}

/** `admins_email_key` surfaces as EMAIL_ALREADY_REGISTERED. */
export async function insert(admin: NewAdmin): Promise<AdminRow> {
  const { data, error } = await getDb().from('admins').insert(admin).select(COLUMNS).single();
  throwIfError(error);
  return data as AdminRow;
}

export type AdminPatch = Partial<Pick<AdminRow, 'role' | 'is_active' | 'full_name' | 'phone'>>;

export async function update(id: string, messId: string, patch: AdminPatch): Promise<AdminRow | null> {
  const { data, error } = await getDb().from('admins').update(patch).eq('id', id).eq('mess_id', messId).select(COLUMNS).maybeSingle();
  throwIfError(error);
  return (data as AdminRow | null) ?? null;
}

export async function countActiveSuperAdmins(messId: string): Promise<number> {
  const { count, error } = await getDb()
    .from('admins')
    .select('id', { count: 'exact', head: true })
    .eq('mess_id', messId)
    .eq('role', 'super_admin')
    .eq('is_active', true);
  throwIfError(error);
  return count ?? 0;
}

/** Display names for the audit log (actors that are admins). */
export async function namesByIds(ids: string[]): Promise<Record<string, { full_name: string; role: string }>> {
  if (ids.length === 0) return {};
  const { data, error } = await getDb().from('admins').select('id, full_name, role').in('id', ids);
  throwIfError(error);
  return Object.fromEntries(((data as { id: string; full_name: string; role: string }[] | null) ?? []).map((a) => [a.id, a]));
}
