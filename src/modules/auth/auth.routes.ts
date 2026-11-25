import { Router } from 'express';
import { asyncHandler } from '../../common/http/asyncHandler';
import { authenticate } from '../../common/middleware/authenticate';
import { authLimiter, createLimiter, resendLimiter, userKey } from '../../common/middleware/rateLimit';
import { validate } from '../../common/middleware/validate';
import * as controller from './auth.controller';
import {
  changePasswordBody,
  emailOnlyBody,
  loginBody,
  logoutBody,
  refreshBody,
  registerBody,
  resetPasswordBody,
  verifyEmailBody,
} from './auth.schemas';

export const authRouter = Router();

// Shared counters: register/verify/login/reset together allow 10 attempts per 15 min per email+IP.
const credentialsLimiter = authLimiter();
// resend + forgot-password: 3 per 10 min per email+IP.
const emailSendLimiter = resendLimiter();
const changePasswordLimiter = createLimiter({ windowMs: 15 * 60_000, limit: 10, key: userKey });

// ---- Student (public)
authRouter.post('/student/register', credentialsLimiter, validate({ body: registerBody }), asyncHandler(controller.registerStudent));
authRouter.post('/student/verify-email', credentialsLimiter, validate({ body: verifyEmailBody }), asyncHandler(controller.verifyEmail));
authRouter.post('/student/resend-verification', emailSendLimiter, validate({ body: emailOnlyBody }), asyncHandler(controller.resendVerification));
authRouter.post('/student/login', credentialsLimiter, validate({ body: loginBody }), asyncHandler(controller.loginStudent));

// ---- Admin (public login; there is no admin sign-up, BR-17)
authRouter.post('/admin/login', credentialsLimiter, validate({ body: loginBody }), asyncHandler(controller.loginAdmin));

// ---- Shared
authRouter.post('/refresh', validate({ body: refreshBody }), asyncHandler(controller.refresh));
authRouter.post('/forgot-password', emailSendLimiter, validate({ body: emailOnlyBody }), asyncHandler(controller.forgotPassword));
authRouter.post('/reset-password', credentialsLimiter, validate({ body: resetPasswordBody }), asyncHandler(controller.resetPassword));

// ---- Authenticated (any role)
authRouter.post('/logout', authenticate, validate({ body: logoutBody }), asyncHandler(controller.logout));
authRouter.post('/change-password', authenticate, changePasswordLimiter, validate({ body: changePasswordBody }), asyncHandler(controller.changePassword));
