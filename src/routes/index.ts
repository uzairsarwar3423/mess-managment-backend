import { Router } from 'express';
import { ok } from '../common/http/respond';
import { authenticate } from '../common/middleware/authenticate';
import { requireRole } from '../common/middleware/requireRole';
import { adminsRouter } from '../modules/admins/admins.routes';
import { adminAttendanceRouter, studentAttendanceRouter } from '../modules/attendance/attendance.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { devicesRouter, notificationsRouter } from '../modules/notifications/notifications.routes';
import { adminPaymentsRouter, studentPaymentsRouter } from '../modules/payments/payments.routes';
import { adminQrRouter } from '../modules/qr/qr.routes';
import { adminReportsRouter } from '../modules/reports/reports.routes';
import { adminSettingsRouter, studentSettingsRouter } from '../modules/settings/settings.routes';
import { adminStudentsRouter, studentProfileRouter } from '../modules/students/students.routes';
import { adminSubscriptionsRouter, studentSubscriptionsRouter } from '../modules/subscriptions/subscriptions.routes';
import { uploadsRouter } from '../modules/uploads/uploads.routes';

/**
 * Mounted at /api/v1. The role guard is applied HERE, at the mount point, so forgetting a guard
 * inside a module cannot expose an endpoint. Module routers are added as they are implemented.
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  ok(res, { name: 'mess-api', version: 'v1' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/uploads', authenticate, requireRole('student'), uploadsRouter); // v1: only students upload
apiRouter.use('/notifications', authenticate, requireRole('student'), notificationsRouter);
apiRouter.use('/devices', authenticate, devicesRouter); // students and admins

// ---- Student App (role: student)
const studentRouter = Router();
studentRouter.use(studentProfileRouter);
studentRouter.use(studentSettingsRouter);
studentRouter.use(studentPaymentsRouter);
studentRouter.use(studentAttendanceRouter);
studentRouter.use(studentSubscriptionsRouter);
apiRouter.use('/student', authenticate, requireRole('student'), studentRouter);

// ---- Admin App (role: admin | super_admin; super-admin-only routes add their own guard)
const adminRouter = Router();
adminRouter.use(adminsRouter);
adminRouter.use(adminStudentsRouter);
adminRouter.use(adminReportsRouter);
adminRouter.use(adminSettingsRouter);
adminRouter.use(adminPaymentsRouter);
adminRouter.use(adminQrRouter);
adminRouter.use(adminAttendanceRouter);
adminRouter.use(adminSubscriptionsRouter);
apiRouter.use('/admin', authenticate, requireRole('admin', 'super_admin'), adminRouter);
