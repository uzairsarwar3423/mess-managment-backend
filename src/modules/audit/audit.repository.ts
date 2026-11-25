import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';

export interface NewAuditEntry {
  mess_id: string | null;
  actor_id: string | null;
  actor_role: 'student' | 'admin' | 'super_admin' | 'system' | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
}

/** Append-only (a DB trigger forbids update/delete). */
export async function insert(entry: NewAuditEntry): Promise<void> {
  const { error } = await getDb().from('audit_logs').insert(entry);
  throwIfError(error);
}

export interface AuditRow {
  id: number;
  created_at: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditFilters {
  messId: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  fromIso?: string;
  toIso?: string;
  from: number;
  to: number;
}

export async function list(f: AuditFilters): Promise<{ rows: AuditRow[]; total: number }> {
  let query = getDb()
    .from('audit_logs')
    .select('id, created_at, actor_id, actor_role, action, entity_type, entity_id, metadata', { count: 'exact' })
    .eq('mess_id', f.messId);
  if (f.action) query = query.eq('action', f.action);
  if (f.entityType) query = query.eq('entity_type', f.entityType);
  if (f.entityId) query = query.eq('entity_id', f.entityId);
  if (f.actorId) query = query.eq('actor_id', f.actorId);
  if (f.fromIso) query = query.gte('created_at', f.fromIso);
  if (f.toIso) query = query.lt('created_at', f.toIso);
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(f.from, f.to);
  throwIfError(error);
  return { rows: (data as unknown as AuditRow[] | null) ?? [], total: count ?? 0 };
}
