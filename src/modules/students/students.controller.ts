import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { ok, paginated } from '../../common/http/respond';
import type { AuthContext, RequestMeta } from '../../common/types';
import type { AdminListQuery as PaymentsAdminQuery } from '../payments/payments.schemas';
import type {
  AdminListQuery,
  ProfileImageBody,
  SetStatusBody,
  StudentAttendanceQuery,
  UpdateProfileBody,
} from './students.schemas';
import * as service from './students.service';

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
export async function getMe(req: Request, res: Response): Promise<void> {
  ok(res, await service.getProfile(requireAuth(req)));
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  ok(res, await service.updateProfile(requireAuth(req), req.valid.body as UpdateProfileBody));
}

export async function setProfileImage(req: Request, res: Response): Promise<void> {
  ok(res, await service.setProfileImage(requireAuth(req), (req.valid.body as ProfileImageBody).public_id));
}

export async function removeProfileImage(req: Request, res: Response): Promise<void> {
  ok(res, await service.removeProfileImage(requireAuth(req)));
}

export async function dashboard(req: Request, res: Response): Promise<void> {
  ok(res, await service.getDashboard(requireAuth(req)));
}

// ---- admin
export async function list(req: Request, res: Response): Promise<void> {
  const { data, meta: m } = await service.listForAdmin(requireAuth(req), req.valid.query as AdminListQuery);
  paginated(res, data, m);
}

export async function get(req: Request, res: Response): Promise<void> {
  ok(res, await service.getForAdmin(requireAuth(req), idOf(req)));
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  ok(res, await service.setStatus(requireAuth(req), idOf(req), req.valid.body as SetStatusBody, meta(req)));
}

export async function subscriptions(req: Request, res: Response): Promise<void> {
  const { data, meta: m } = await service.listSubscriptionsForAdmin(
    requireAuth(req), idOf(req), req.valid.query as { page: number; limit: number },
  );
  paginated(res, data, m);
}

export async function payments(req: Request, res: Response): Promise<void> {
  const { data, meta: m } = await service.listPaymentsForAdmin(requireAuth(req), idOf(req), req.valid.query as PaymentsAdminQuery);
  paginated(res, data, m);
}

export async function attendance(req: Request, res: Response): Promise<void> {
  const result = await service.attendanceForAdmin(requireAuth(req), idOf(req), req.valid.query as StudentAttendanceQuery);
  if (result.kind === 'calendar') ok(res, result.calendar);
  else paginated(res, result.data, result.meta);
}
