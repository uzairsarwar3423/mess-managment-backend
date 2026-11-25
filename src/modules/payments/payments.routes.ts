import { Router } from 'express';
import { asyncHandler } from '../../common/http/asyncHandler';
import { validate } from '../../common/middleware/validate';
import { idParam } from '../../common/schemas';
import * as controller from './payments.controller';
import {
  adminListQuery,
  approveBody,
  rejectBody,
  studentListQuery,
  submitPaymentBody,
} from './payments.schemas';

/** Mounted under /api/v1/student (role guard: student). */
export const studentPaymentsRouter = Router();

studentPaymentsRouter.post('/payments', validate({ body: submitPaymentBody }), asyncHandler(controller.submit));
studentPaymentsRouter.get('/payments', validate({ query: studentListQuery }), asyncHandler(controller.listMine));
studentPaymentsRouter.get('/payments/:id', validate({ params: idParam }), asyncHandler(controller.getMine));
studentPaymentsRouter.post('/payments/:id/cancel', validate({ params: idParam }), asyncHandler(controller.cancelMine));

/** Mounted under /api/v1/admin (role guard: admin | super_admin). Any active admin may approve/reject (D-24). */
export const adminPaymentsRouter = Router();

adminPaymentsRouter.get('/payments', validate({ query: adminListQuery }), asyncHandler(controller.listForAdmin));
adminPaymentsRouter.get('/payments/:id', validate({ params: idParam }), asyncHandler(controller.getForAdmin));
adminPaymentsRouter.post(
  '/payments/:id/approve',
  validate({ params: idParam, body: approveBody }),
  asyncHandler(controller.approve),
);
adminPaymentsRouter.post(
  '/payments/:id/reject',
  validate({ params: idParam, body: rejectBody }),
  asyncHandler(controller.reject),
);
