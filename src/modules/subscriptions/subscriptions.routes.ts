import { Router } from 'express';
import { asyncHandler } from '../../common/http/asyncHandler';
import { validate } from '../../common/middleware/validate';
import { idParam } from '../../common/schemas';
import * as controller from './subscriptions.controller';
import { adminListQuery, cancelBody, studentHistoryQuery } from './subscriptions.schemas';

/** Mounted under /api/v1/student (role guard: student). */
export const studentSubscriptionsRouter = Router();

studentSubscriptionsRouter.get('/subscription', asyncHandler(controller.getMyState));
studentSubscriptionsRouter.get('/subscriptions', validate({ query: studentHistoryQuery }), asyncHandler(controller.listMine));

/** Mounted under /api/v1/admin (role guard: admin | super_admin). Any admin may cancel (D-24). */
export const adminSubscriptionsRouter = Router();

adminSubscriptionsRouter.get('/subscriptions', validate({ query: adminListQuery }), asyncHandler(controller.listForAdmin));
adminSubscriptionsRouter.get('/subscriptions/:id', validate({ params: idParam }), asyncHandler(controller.getForAdmin));
adminSubscriptionsRouter.post(
  '/subscriptions/:id/cancel',
  validate({ params: idParam, body: cancelBody }),
  asyncHandler(controller.cancel),
);
