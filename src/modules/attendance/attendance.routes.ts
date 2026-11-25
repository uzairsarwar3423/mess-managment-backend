import { Router } from 'express';
import { asyncHandler } from '../../common/http/asyncHandler';
import { scanLimiter } from '../../common/middleware/rateLimit';
import { validate } from '../../common/middleware/validate';
import * as controller from './attendance.controller';
import { calendarQuery, dailyQuery, historyQuery, manualBody, monthlyQuery, scanBody } from './attendance.schemas';

/** Mounted under /api/v1/student (role guard: student). */
export const studentAttendanceRouter = Router();

studentAttendanceRouter.post('/attendance/scan', scanLimiter(), validate({ body: scanBody }), asyncHandler(controller.scan));
studentAttendanceRouter.get('/attendance/today', asyncHandler(controller.today));
studentAttendanceRouter.get('/attendance/calendar', validate({ query: calendarQuery }), asyncHandler(controller.calendar));
studentAttendanceRouter.get('/attendance/history', validate({ query: historyQuery }), asyncHandler(controller.history));

/** Mounted under /api/v1/admin (role guard: admin | super_admin). */
export const adminAttendanceRouter = Router();

adminAttendanceRouter.get('/attendance/daily', validate({ query: dailyQuery }), asyncHandler(controller.daily));
adminAttendanceRouter.get('/attendance/monthly', validate({ query: monthlyQuery }), asyncHandler(controller.monthly));
adminAttendanceRouter.post('/attendance/manual', validate({ body: manualBody }), asyncHandler(controller.manual));
