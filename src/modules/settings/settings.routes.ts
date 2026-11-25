import { Router } from 'express';
import { asyncHandler } from '../../common/http/asyncHandler';
import { requireRole } from '../../common/middleware/requireRole';
import { validate } from '../../common/middleware/validate';
import { idParam } from '../../common/schemas';
import * as controller from './settings.controller';
import {
  createAccountBody,
  listAccountsQuery,
  updateAccountBody,
  updateSettingsBody,
} from './settings.schemas';

/** Mounted under /api/v1/admin (role guard: admin | super_admin is applied at the mount point). */
export const adminSettingsRouter = Router();

adminSettingsRouter.get('/settings', asyncHandler(controller.getSettings));
adminSettingsRouter.patch(
  '/settings',
  requireRole('super_admin'),
  validate({ body: updateSettingsBody }),
  asyncHandler(controller.updateSettings),
);

adminSettingsRouter.get(
  '/payment-accounts',
  validate({ query: listAccountsQuery }),
  asyncHandler(controller.listAccounts),
);
adminSettingsRouter.post(
  '/payment-accounts',
  requireRole('super_admin'),
  validate({ body: createAccountBody }),
  asyncHandler(controller.createAccount),
);
adminSettingsRouter.patch(
  '/payment-accounts/:id',
  requireRole('super_admin'),
  validate({ params: idParam, body: updateAccountBody }),
  asyncHandler(controller.updateAccount),
);

/** Mounted under /api/v1/student (role guard: student). */
export const studentSettingsRouter = Router();

studentSettingsRouter.get('/payment-instructions', asyncHandler(controller.getPaymentInstructions));
