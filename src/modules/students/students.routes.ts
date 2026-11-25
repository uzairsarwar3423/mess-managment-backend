import { Router } from 'express';
import { asyncHandler } from '../../common/http/asyncHandler';
import { validate } from '../../common/middleware/validate';
import { idParam, pagination } from '../../common/schemas';
import { adminListQuery as paymentsAdminQuery } from '../payments/payments.schemas';
import * as controller from './students.controller';
import {
  adminListQuery,
  profileImageBody,
  setStatusBody,
  studentAttendanceQuery,
  updateProfileBody,
} from './students.schemas';

/** Mounted under /api/v1/student (role guard: student). */
export const studentProfileRouter = Router();

studentProfileRouter.get('/me', asyncHandler(controller.getMe));
studentProfileRouter.patch('/me', validate({ body: updateProfileBody }), asyncHandler(controller.updateMe));
studentProfileRouter.put('/me/profile-image', validate({ body: profileImageBody }), asyncHandler(controller.setProfileImage));
studentProfileRouter.delete('/me/profile-image', asyncHandler(controller.removeProfileImage));
studentProfileRouter.get('/dashboard', asyncHandler(controller.dashboard));

/** In a student's detail screen the payments tab shows the whole history by default. */
const studentPaymentsQuery = paymentsAdminQuery.extend({ status: paymentsAdminQuery.shape.status.default('all') });

/** Mounted under /api/v1/admin (role guard: admin | super_admin). */
export const adminStudentsRouter = Router();

adminStudentsRouter.get('/students', validate({ query: adminListQuery }), asyncHandler(controller.list));
adminStudentsRouter.get('/students/:id', validate({ params: idParam }), asyncHandler(controller.get));
adminStudentsRouter.patch('/students/:id/status', validate({ params: idParam, body: setStatusBody }), asyncHandler(controller.setStatus));
adminStudentsRouter.get('/students/:id/subscriptions', validate({ params: idParam, query: pagination.strict() }), asyncHandler(controller.subscriptions));
adminStudentsRouter.get('/students/:id/payments', validate({ params: idParam, query: studentPaymentsQuery }), asyncHandler(controller.payments));
adminStudentsRouter.get('/students/:id/attendance', validate({ params: idParam, query: studentAttendanceQuery }), asyncHandler(controller.attendance));
