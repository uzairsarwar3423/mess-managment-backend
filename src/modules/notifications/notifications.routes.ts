import { Router, type Request } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/http/asyncHandler';
import { buildMeta, ok } from '../../common/http/respond';
import { validate } from '../../common/middleware/validate';
import { toRange } from '../../common/pagination';
import { idParam } from '../../common/schemas';
import type { AuthContext } from '../../common/types';
import { now } from '../../lib/clock';
import * as repository from './notifications.repository';
import { listQuery, pushTokenBody, unregisterBody, type ListQuery, type PushTokenBody } from './notifications.schemas';
import * as pushTokens from './pushTokens.repository';

function authOf(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHORIZED');
  return req.auth;
}

/** Mounted at /api/v1/notifications (role guard: student; admins get no notifications in v1, D-15). */
export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const auth = authOf(req);
    const q = req.valid.query as ListQuery;
    const { from, to } = toRange(q.page, q.limit);
    const [{ rows, total }, unread] = await Promise.all([
      repository.listForStudent(auth.userId, q.unread_only, from, to),
      repository.countUnread(auth.userId),
    ]);
    res.status(200).json({
      success: true,
      data: rows.map((n) => ({
        id: n.id, type: n.type, title: n.title, body: n.body, data: n.data, is_read: n.is_read, created_at: n.created_at,
      })),
      meta: { ...buildMeta(q.page, q.limit, total), unread_count: unread },
    });
  }),
);

// Declared before "/:id/read" so "read-all" is never taken as an id.
notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    ok(res, { updated: await repository.markAllRead(authOf(req).userId, now().toISOString()) });
  }),
);

notificationsRouter.post(
  '/:id/read',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const found = await repository.markRead(id, authOf(req).userId, now().toISOString());
    if (!found) throw new AppError('NOT_FOUND'); // also for other students' notifications
    ok(res, { id, is_read: true });
  }),
);

/** Mounted at /api/v1/devices (any authenticated user: students and admins). */
export const devicesRouter = Router();

devicesRouter.post(
  '/push-token',
  validate({ body: pushTokenBody }),
  asyncHandler(async (req, res) => {
    const { token, platform } = req.valid.body as PushTokenBody;
    await pushTokens.upsert(authOf(req).userId, token, platform, now().toISOString());
    ok(res, { registered: true });
  }),
);

devicesRouter.post(
  '/push-token/unregister',
  validate({ body: unregisterBody }),
  asyncHandler(async (req, res) => {
    await pushTokens.removeForUser(authOf(req).userId, (req.valid.body as { token: string }).token);
    ok(res, { removed: true });
  }),
);
