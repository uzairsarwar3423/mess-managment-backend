import { AppError } from '../../common/errors/AppError';
import { buildMeta } from '../../common/http/respond';
import { toRange } from '../../common/pagination';
import type { AuthContext, RequestMeta } from '../../common/types';
import { now } from '../../lib/clock';
import type { QrPosterData } from '../../lib/pdf/qrPoster.pdf';
import * as auditService from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/auditActions';
import { loadMessConfig } from '../settings/settings.service';
import { businessDate } from '../settings/time';
import * as repository from './qr.repository';
import type { QrCodeRow, QrStats } from './qr.repository';
import type { CreateQrBody, ListQrQuery } from './qr.schemas';
import { signQrToken } from './qrToken';

function toDto(row: QrCodeRow, stats?: QrStats) {
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    created_at: row.created_at,
    created_by: row.creator ? { id: row.creator.id, full_name: row.creator.full_name } : null,
    scans_today: stats?.scans_today ?? 0,
    last_scan_at: stats?.last_scan_at ?? null,
    revoked_at: row.revoked_at,
    revoke_reason: row.revoke_reason,
  };
}

async function requireCode(auth: AuthContext, id: string): Promise<QrCodeRow> {
  const row = await repository.findById(id, auth.messId); // scoped to the admin's mess
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}

export async function list(auth: AuthContext, query: ListQrQuery) {
  const { from, to } = toRange(query.page, query.limit);
  const config = await loadMessConfig(auth.messId);
  const today = businessDate(now(), config.timezone);

  const [{ rows, total }, stats] = await Promise.all([
    repository.list(auth.messId, query.status, from, to),
    repository.stats(auth.messId, today),
  ]);
  const byId = new Map(stats.map((s) => [s.qr_code_id, s]));
  return { data: rows.map((r) => toDto(r, byId.get(r.id))), meta: buildMeta(query.page, query.limit, total) };
}

export async function create(auth: AuthContext, body: CreateQrBody, meta: RequestMeta) {
  const row = await repository.insert(auth.messId, body.label, auth.userId); // QR_LABEL_EXISTS via unique index
  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.QR_CREATE,
    entityType: 'qr_code',
    entityId: row.id,
    metadata: { label: row.label },
    meta,
  });
  return toDto(row);
}

/** Detail + the QR string to render in the app. Signed fresh on each call; every signed value of an active code is valid. */
export async function getWithToken(auth: AuthContext, id: string) {
  const row = await requireCode(auth, id);
  const config = await loadMessConfig(auth.messId);
  const stats = (await repository.stats(auth.messId, businessDate(now(), config.timezone))).find((s) => s.qr_code_id === id);

  return {
    id: row.id,
    label: row.label,
    status: row.status,
    // A revoked code can no longer be scanned successfully, so no value is issued for it.
    qr_value: row.status === 'active' ? signQrToken({ qid: row.id, mid: row.mess_id }) : null,
    scans_today: stats?.scans_today ?? 0,
    scans_total: stats?.scans_total ?? 0,
    revoked_at: row.revoked_at,
    revoke_reason: row.revoke_reason,
  };
}

/** Everything needed to draw the print-ready PDF. Only active codes can be printed. */
export async function getPosterData(auth: AuthContext, id: string): Promise<{ filename: string; poster: QrPosterData }> {
  const row = await requireCode(auth, id);
  if (row.status !== 'active') throw new AppError('QR_ALREADY_REVOKED');
  const config = await loadMessConfig(auth.messId);

  const slug = row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'code';
  return {
    filename: `qr-${slug}.pdf`,
    poster: {
      messName: config.mess.name,
      label: row.label,
      qrValue: signQrToken({ qid: row.id, mid: row.mess_id }),
      shortId: row.id.slice(0, 8),
    },
  };
}

export async function revoke(auth: AuthContext, id: string, reason: string, meta: RequestMeta) {
  const existing = await requireCode(auth, id);
  if (existing.status === 'revoked') throw new AppError('QR_ALREADY_REVOKED');

  const row = await repository.revokeActive(id, auth.messId, auth.userId, reason, now().toISOString());
  if (!row) throw new AppError('QR_ALREADY_REVOKED'); // lost a race with another admin

  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.QR_REVOKE,
    entityType: 'qr_code',
    entityId: id,
    metadata: { label: row.label, reason },
    meta,
  });
  return toDto(row);
}
