import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { ok, paginated } from '../../common/http/respond';
import type { AuthContext, RequestMeta } from '../../common/types';
import type { AdminListQuery, CancelBody, StudentHistoryQuery } from './subscriptions.schemas';
import * as service from './subscriptions.service';

function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHORIZED');
  return req.auth;
}

const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

const idOf = (req: Request): string => (req.valid.params as { id: string }).id;

export async function getMyState(req: Request, res: Response): Promise<void> {
  ok(res, await service.getMyState(requireAuth(req)));
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const { data, meta: m } = await service.listMine(requireAuth(req), req.valid.query as StudentHistoryQuery);
  paginated(res, data, m);
}

export async function listForAdmin(req: Request, res: Response): Promise<void> {
  const { data, meta: m } = await service.listForAdmin(requireAuth(req), req.valid.query as AdminListQuery);
  paginated(res, data, m);
}

export async function getForAdmin(req: Request, res: Response): Promise<void> {
  ok(res, await service.getForAdmin(requireAuth(req), idOf(req)));
}

export async function cancel(req: Request, res: Response): Promise<void> {
  ok(res, await service.cancel(requireAuth(req), idOf(req), req.valid.body as CancelBody, meta(req)));
}
