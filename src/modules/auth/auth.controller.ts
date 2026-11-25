import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { created, ok } from '../../common/http/respond';
import type { AuthContext, RequestMeta } from '../../common/types';
import type {
  ChangePasswordBody,
  EmailOnlyBody,
  LoginBody,
  LogoutBody,
  RefreshBody,
  RegisterBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from './auth.schemas';
import * as service from './auth.service';

const body = <T>(req: Request): T => req.valid.body as T;

function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHORIZED');
  return req.auth;
}

const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

export async function registerStudent(req: Request, res: Response): Promise<void> {
  created(res, await service.registerStudent(body<RegisterBody>(req)));
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { email, otp } = body<VerifyEmailBody>(req);
  ok(res, await service.verifyStudentEmail(email, otp));
}

export async function resendVerification(req: Request, res: Response): Promise<void> {
  ok(res, await service.resendVerification(body<EmailOnlyBody>(req).email));
}

export async function loginStudent(req: Request, res: Response): Promise<void> {
  const { email, password } = body<LoginBody>(req);
  ok(res, await service.loginStudent(email, password));
}

export async function loginAdmin(req: Request, res: Response): Promise<void> {
  const { email, password } = body<LoginBody>(req);
  ok(res, await service.loginAdmin(email, password, meta(req)));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  ok(res, await service.refresh(body<RefreshBody>(req).refresh_token));
}

export async function logout(req: Request, res: Response): Promise<void> {
  ok(res, await service.logout(requireAuth(req), body<LogoutBody>(req).push_token));
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  ok(res, await service.forgotPassword(body<EmailOnlyBody>(req).email));
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { email, otp, new_password } = body<ResetPasswordBody>(req);
  ok(res, await service.resetPassword(email, otp, new_password));
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { current_password, new_password } = body<ChangePasswordBody>(req);
  ok(res, await service.changePassword(requireAuth(req), current_password, new_password));
}
