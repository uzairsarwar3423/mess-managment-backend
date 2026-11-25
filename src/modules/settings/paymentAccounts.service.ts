import { AppError } from '../../common/errors/AppError';
import type { AuthContext, RequestMeta } from '../../common/types';
import * as auditService from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/auditActions';
import * as repository from './paymentAccounts.repository';
import { toAdminAccountDto } from './settings.dto';
import {
  applyAccountPatch,
  assertValidAccount,
  diffValues,
  toAccountDbPatch,
  toAccountFields,
} from './settings.logic';
import type { CreateAccountBody, UpdateAccountBody } from './settings.schemas';

export async function listForAdmin(auth: AuthContext, includeInactive: boolean) {
  const rows = await repository.list(auth.messId, includeInactive);
  return rows.map(toAdminAccountDto);
}

/** Super admin only (route guard). Plain-text details: there is no gateway integration. */
export async function create(auth: AuthContext, body: CreateAccountBody, meta: RequestMeta) {
  assertValidAccount({ method: body.method, bank_name: body.bank_name ?? null });

  const row = await repository.insert({
    mess_id: auth.messId,
    method: body.method,
    account_title: body.account_title,
    account_number: body.account_number,
    bank_name: body.bank_name ?? null,
    merchant_name: body.merchant_name ?? null,
    instructions: body.instructions ?? null,
    display_order: body.display_order,
    created_by: auth.userId,
  });

  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.PAYMENT_ACCOUNT_CREATE,
    entityType: 'payment_account',
    entityId: row.id,
    metadata: { method: row.method, account_title: row.account_title },
    meta,
  });
  return toAdminAccountDto(row);
}

/**
 * Accounts are never deleted (payments reference them): set `is_active=false` to hide one.
 * Past payments keep their own `paid_to` snapshot, so edits do not rewrite history.
 */
export async function update(auth: AuthContext, id: string, body: UpdateAccountBody, meta: RequestMeta) {
  const existing = await repository.findById(id, auth.messId);
  if (!existing) throw new AppError('NOT_FOUND');

  const current = toAccountFields(existing);
  const next = applyAccountPatch(current, body);
  assertValidAccount(next);

  const patch = toAccountDbPatch(current, next);
  if (Object.keys(patch).length === 0) return toAdminAccountDto(existing);

  const row = await repository.update(id, auth.messId, patch);
  if (!row) throw new AppError('NOT_FOUND');

  const { before, after } = diffValues(current, next);
  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.PAYMENT_ACCOUNT_UPDATE,
    entityType: 'payment_account',
    entityId: id,
    metadata: { before, after },
    meta,
  });
  return toAdminAccountDto(row);
}

/** An account students may pay into: it must exist in the caller's mess and be active. */
export async function findActiveAccount(messId: string, id: string) {
  const row = await repository.findById(id, messId);
  return row && row.is_active ? row : null;
}
