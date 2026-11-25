import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { created, ok, paginated } from '../../common/http/respond';
import type { AuthContext, RequestMeta } from '../../common/types';
import type { AdminListQuery, RejectBody, StudentListQuery, SubmitPaymentBody } from './payments.schemas';
import * as service from './payments.service';

function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHORIZED');
  return req.auth;
}

const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

const idOf = (req: Request): string => (req.valid.params as { id: string }).id;

// ---- student
export async function submit(req: Request, res: Response): Promise<void> {
  created(res, await service.submit(requireAuth(req), req.valid.body as SubmitPaymentBody));
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const { data, meta: m } = await service.listMine(requireAuth(req), req.valid.query as StudentListQuery);
  paginated(res, data, m);
}

export async function getMine(req: Request, res: Response): Promise<void> {
  ok(res, await service.getMine(requireAuth(req), idOf(req)));
}

export async function cancelMine(req: Request, res: Response): Promise<void> {
  ok(res, await service.cancelMine(requireAuth(req), idOf(req)));
}

// ---- admin
export async function listForAdmin(req: Request, res: Response): Promise<void> {
  const { data, meta: m } = await service.listForAdmin(requireAuth(req), req.valid.query as AdminListQuery);
  paginated(res, data, m);
}

export async function getForAdmin(req: Request, res: Response): Promise<void> {
  ok(res, await service.getForAdmin(requireAuth(req), idOf(req)));
}

export async function approve(req: Request, res: Response): Promise<void> {
  ok(res, await service.approve(requireAuth(req), idOf(req)));
}

export async function reject(req: Request, res: Response): Promise<void> {
  ok(res, await service.reject(requireAuth(req), idOf(req), (req.valid.body as RejectBody).reason, meta(req)));
}
