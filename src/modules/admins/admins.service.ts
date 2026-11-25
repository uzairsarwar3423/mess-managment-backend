import { AppError } from '../../common/errors/AppError';
import { buildMeta } from '../../common/http/respond';
import { toRange } from '../../common/pagination';
import type { AuthContext, RequestMeta } from '../../common/types';
import { logger } from '../../lib/logger';
import * as auditRepository from '../audit/audit.repository';
import * as auditService from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/auditActions';
import * as authRepository from '../auth/auth.repository';
import { loadMessConfig } from '../settings/settings.service';
import { addDays, zonedTimeToUtc } from '../settings/time';
import { toAdminDto } from './admins.dto';
import * as repository from './admins.repository';
import type { AuditQuery, CreateAdminBody, UpdateAdminBody } from './admins.schemas';

// All functions here are super-admin only (the router enforces it; BR-17).

export async function list(auth: AuthContext, query: { page: number; limit: number }) {
  const { from, to } = toRange(query.page, query.limit);
  const { rows, total } = await repository.list(auth.messId, from, to);
  return { data: rows.map(toAdminDto), meta: buildMeta(query.page, query.limit, total) };
}

/** Creates an already-verified Supabase user, then the `admins` row; rolls the user back if the row fails. */
export async function create(auth: AuthContext, body: CreateAdminBody, meta: RequestMeta) {
  const userId = await authRepository.createVerifiedUser(body.email, body.temporary_password); // EMAIL_ALREADY_REGISTERED if taken

  let row;
  try {
    row = await repository.insert({
      id: userId,
      mess_id: auth.messId,
      email: body.email,
      full_name: body.full_name,
      phone: body.phone ?? null,
      role: body.role,
      created_by: auth.userId,
    });
  } catch (err) {
    await authRepository.deleteUser(userId).catch((e) => logger.error({ err: e, user_id: userId }, 'admin rollback failed'));
    throw err;
  }

  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.ADMIN_CREATE,
    entityType: 'admin',
    entityId: row.id,
    metadata: { role: row.role, full_name: row.full_name }, // never the password
    meta,
  });
  return toAdminDto(row);
}

/**
 * Role / enabled flag / name / phone. A super admin cannot change their own role or enabled flag, and
 * the last active super admin can never be demoted or disabled (nobody could manage admins afterwards).
 */
export async function update(auth: AuthContext, id: string, body: UpdateAdminBody, meta: RequestMeta) {
  const target = await repository.findInMess(id, auth.messId);
  if (!target) throw new AppError('NOT_FOUND');

  const changesAccess = body.role !== undefined || body.is_active !== undefined;
  if (id === auth.userId && changesAccess) {
    throw new AppError('FORBIDDEN', 'You cannot change your own role or enabled status.');
  }

  const losesSuperAdmin =
    target.role === 'super_admin' && target.is_active && (body.role === 'admin' || body.is_active === false);
  if (losesSuperAdmin && (await repository.countActiveSuperAdmins(auth.messId)) <= 1) {
    throw new AppError('LAST_SUPER_ADMIN');
  }

  const patch = Object.fromEntries(
    Object.entries(body).filter(([key, value]) => (target as unknown as Record<string, unknown>)[key] !== value),
  );
  if (Object.keys(patch).length === 0) return toAdminDto(target);

  const row = await repository.update(id, auth.messId, patch);
  if (!row) throw new AppError('NOT_FOUND');

  if (patch.is_active !== undefined) {
    try {
      await authRepository.setBanned(id, !row.is_active); // also stop token refresh at Supabase
    } catch (err) {
      logger.warn({ err, admin_id: id }, 'could not update the Supabase ban flag'); // the profile flag already blocks the API
    }
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    before[key] = (target as unknown as Record<string, unknown>)[key];
    after[key] = (row as unknown as Record<string, unknown>)[key];
  }
  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.ADMIN_UPDATE,
    entityType: 'admin',
    entityId: id,
    metadata: { before, after },
    meta,
  });
  return toAdminDto(row);
}

/** Read-only audit trail with actor names (for admin actors). Dates are mess-local days. */
export async function auditLogs(auth: AuthContext, query: AuditQuery) {
  const config = await loadMessConfig(auth.messId);
  const { from, to } = toRange(query.page, query.limit);
  const { rows, total } = await auditRepository.list({
    messId: auth.messId,
    action: query.action,
    entityType: query.entity_type,
    entityId: query.entity_id,
    actorId: query.actor_id,
    fromIso: query.from ? zonedTimeToUtc(query.from, '00:00', config.timezone).toISOString() : undefined,
    toIso: query.to ? zonedTimeToUtc(addDays(query.to, 1), '00:00', config.timezone).toISOString() : undefined,
    from,
    to,
  });
  const names = await repository.namesByIds([...new Set(rows.map((r) => r.actor_id).filter((x): x is string => Boolean(x)))]);

  return {
    data: rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      actor: r.actor_id ? { id: r.actor_id, full_name: names[r.actor_id]?.full_name ?? null, role: r.actor_role } : null,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      metadata: r.metadata,
    })),
    meta: buildMeta(query.page, query.limit, total),
  };
}
