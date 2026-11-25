import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { created, ok, paginated } from '../../common/http/respond';
import type { AuthContext, RequestMeta } from '../../common/types';
import type {
  CalendarQuery,
  DailyQuery,
  HistoryQuery,
  ManualBody,
  MonthlyQuery,
  ScanBody,
} from './attendance.schemas';
import * as service from './attendance.service';

function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHORIZED');
  return req.auth;
}

const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

// ---- student
export async function scan(req: Request, res: Response): Promise<void> {
  created(res, await service.scan(requireAuth(req), req.valid.body as ScanBody));
}

export async function today(req: Request, res: Response): Promise<void> {
  ok(res, await service.today(requireAuth(req)));
}

export async function calendar(req: Request, res: Response): Promise<void> {
  ok(res, await service.calendar(requireAuth(req), req.valid.query as CalendarQuery));
}

export async function history(req: Request, res: Response): Promise<void> {
  const { data, meta: m } = await service.history(requireAuth(req), req.valid.query as HistoryQuery);
  paginated(res, data, m);
}

// ---- admin
export async function daily(req: Request, res: Response): Promise<void> {
  ok(res, await service.daily(requireAuth(req), req.valid.query as DailyQuery));
}

export async function monthly(req: Request, res: Response): Promise<void> {
  ok(res, await service.monthly(requireAuth(req), req.valid.query as MonthlyQuery));
}

export async function manual(req: Request, res: Response): Promise<void> {
  created(res, await service.markManual(requireAuth(req), req.valid.body as ManualBody, meta(req)));
}
