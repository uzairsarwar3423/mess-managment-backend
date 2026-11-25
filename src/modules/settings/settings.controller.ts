import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { created, ok } from '../../common/http/respond';
import type { AuthContext, RequestMeta } from '../../common/types';
import * as accounts from './paymentAccounts.service';
import * as service from './settings.service';
import type {
  CreateAccountBody,
  ListAccountsQuery,
  UpdateAccountBody,
  UpdateSettingsBody,
} from './settings.schemas';

function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHORIZED');
  return req.auth;
}

const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

export async function getSettings(req: Request, res: Response): Promise<void> {
  ok(res, await service.getSettings(requireAuth(req)));
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  ok(res, await service.updateSettings(requireAuth(req), req.valid.body as UpdateSettingsBody, meta(req)));
}

export async function listAccounts(req: Request, res: Response): Promise<void> {
  const { include_inactive } = req.valid.query as ListAccountsQuery;
  ok(res, await accounts.listForAdmin(requireAuth(req), include_inactive));
}

export async function createAccount(req: Request, res: Response): Promise<void> {
  created(res, await accounts.create(requireAuth(req), req.valid.body as CreateAccountBody, meta(req)));
}

export async function updateAccount(req: Request, res: Response): Promise<void> {
  const { id } = req.valid.params as { id: string };
  ok(res, await accounts.update(requireAuth(req), id, req.valid.body as UpdateAccountBody, meta(req)));
}

export async function getPaymentInstructions(req: Request, res: Response): Promise<void> {
  ok(res, await service.getPaymentInstructions(requireAuth(req)));
}
