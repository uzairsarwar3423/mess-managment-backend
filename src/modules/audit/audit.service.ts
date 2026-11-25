import type { RequestMeta } from '../../common/types';
import type { AuditAction } from './auditActions';
import * as repository from './audit.repository';

export interface AuditInput {
  messId: string | null;
  actorId: string | null;
  actorRole: 'student' | 'admin' | 'super_admin' | 'system' | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  /** Never put secrets, tokens or passwords here. */
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

/**
 * Writes an audit entry. Throws if the write fails: for admin write actions that is intentional
 * (an action without a record must not silently succeed). Best-effort callers catch and log.
 */
export async function record(input: AuditInput): Promise<void> {
  await repository.insert({
    mess_id: input.messId,
    actor_id: input.actorId,
    actor_role: input.actorRole,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
    ip_address: input.meta?.ip ?? null,
    user_agent: input.meta?.userAgent ? input.meta.userAgent.slice(0, 300) : null,
  });
}
