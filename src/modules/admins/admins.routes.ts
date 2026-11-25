import { Router, type Request } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/http/asyncHandler';
import { created, ok, paginated } from '../../common/http/respond';
import { requireRole } from '../../common/middleware/requireRole';
import { validate } from '../../common/middleware/validate';
import { idParam } from '../../common/schemas';
import type { AuthContext, RequestMeta } from '../../common/types';
import { toAdminDto } from './admins.dto';
import * as repository from './admins.repository';
import {
  auditQuery, createAdminBody, listAdminsQuery, updateAdminBody,
  type AuditQuery, type CreateAdminBody, type UpdateAdminBody,
} from './admins.schemas';
import * as service from './admins.service';

const authOf = (req: Request): AuthContext => {
  if (!req.auth) throw new AppError('UNAUTHORIZED');
  return req.auth;
};
const metaOf = (req: Request): RequestMeta => ({ ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null });

/** Mounted under /api/v1/admin (role guard: admin | super_admin). Everything except /me is super admin only. */
export const adminsRouter = Router();

adminsRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const admin = await repository.findById(authOf(req).userId);
    if (!admin) throw new AppError('NOT_FOUND');
    ok(res, toAdminDto(admin));
  }),
);

adminsRouter.get(
  '/admins',
  requireRole('super_admin'),
  validate({ query: listAdminsQuery }),
  asyncHandler(async (req, res) => {
    const { data, meta } = await service.list(authOf(req), req.valid.query as { page: number; limit: number });
    paginated(res, data, meta);
  }),
);

adminsRouter.post(
  '/admins',
  requireRole('super_admin'),
  validate({ body: createAdminBody }),
  asyncHandler(async (req, res) => {
    created(res, await service.create(authOf(req), req.valid.body as CreateAdminBody, metaOf(req)));
  }),
);

adminsRouter.patch(
  '/admins/:id',
  requireRole('super_admin'),
  validate({ params: idParam, body: updateAdminBody }),
  asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await service.update(authOf(req), id, req.valid.body as UpdateAdminBody, metaOf(req)));
  }),
);

adminsRouter.get(
  '/audit-logs',
  requireRole('super_admin'),
  validate({ query: auditQuery }),
  asyncHandler(async (req, res) => {
    const { data, meta } = await service.auditLogs(authOf(req), req.valid.query as AuditQuery);
    paginated(res, data, meta);
  }),
);
