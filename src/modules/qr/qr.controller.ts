import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { created, ok, paginated } from '../../common/http/respond';
import { renderQrPoster } from '../../lib/pdf/qrPoster.pdf';
import type { AuthContext, RequestMeta } from '../../common/types';
import type { CreateQrBody, ListQrQuery, RevokeQrBody } from './qr.schemas';
import * as service from './qr.service';

function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHORIZED');
  return req.auth;
}

const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

const idOf = (req: Request): string => (req.valid.params as { id: string }).id;

export async function list(req: Request, res: Response): Promise<void> {
  const { data, meta: m } = await service.list(requireAuth(req), req.valid.query as ListQrQuery);
  paginated(res, data, m);
}

export async function create(req: Request, res: Response): Promise<void> {
  created(res, await service.create(requireAuth(req), req.valid.body as CreateQrBody, meta(req)));
}

export async function get(req: Request, res: Response): Promise<void> {
  ok(res, await service.getWithToken(requireAuth(req), idOf(req)));
}

export async function revoke(req: Request, res: Response): Promise<void> {
  ok(res, await service.revoke(requireAuth(req), idOf(req), (req.valid.body as RevokeQrBody).reason, meta(req)));
}

/** PDF: lookups happen first, so any error still uses the JSON error envelope; headers are set only on success. */
export async function printPdf(req: Request, res: Response): Promise<void> {
  const { filename, poster } = await service.getPosterData(requireAuth(req), idOf(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  await renderQrPoster(poster, res);
}
