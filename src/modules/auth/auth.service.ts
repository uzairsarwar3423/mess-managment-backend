import { AppError } from '../../common/errors/AppError';
import type { AuthContext, RequestMeta } from '../../common/types';
import { env } from '../../config/env';
import { logger, maskEmail } from '../../lib/logger';
import { toAdminDto } from '../admins/admins.dto';
import * as adminsRepository from '../admins/admins.repository';
import * as auditService from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/auditActions';
import * as pushTokensRepository from '../notifications/pushTokens.repository';
import { toStudentDto } from '../students/students.dto';
import * as studentsRepository from '../students/students.repository';
import type { RegisterBody } from './auth.schemas';
import * as authRepository from './auth.repository';
import type { AuthSession } from './auth.repository';
import { getDefaultMessId } from '../settings/defaultMess';
import { resolveProfile } from './profileResolver';

const RESEND_AFTER_SECONDS = 60;

export function toTokenResponse(session: AuthSession) {
  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    token_type: 'bearer' as const,
    expires_in: session.expiresIn,
    expires_at: new Date(session.expiresAt * 1000).toISOString(),
  };
}

/** Best-effort session revocation used when a login must be refused after Supabase accepted it. */
async function revokeQuietly(accessToken: string): Promise<void> {
  try {
    await authRepository.revokeSession(accessToken, 'local');
  } catch (err) {
    logger.warn({ err }, 'could not revoke session');
  }
}

// ---------------------------------------------------------------- registration & verification

export async function registerStudent(input: RegisterBody) {
  const signUp = await authRepository.signUp(input.email, input.password, input.full_name);

  if (signUp.alreadyRegistered) throw new AppError('EMAIL_ALREADY_REGISTERED');
  if (signUp.hasSession) {
    // BR-15 would be violated: Supabase "Confirm email" is switched off.
    logger.error('Supabase email confirmation appears to be DISABLED; users can log in without verifying');
  }

  // A previous, still-unverified registration: Supabase re-sent the code; the profile row exists.
  const existing = await studentsRepository.findById(signUp.userId);
  if (!existing) {
    const messId = await getDefaultMessId().catch(async (err) => {
      await authRepository.deleteUser(signUp.userId).catch(() => undefined); // no mess to attach to: undo the login
      throw err;
    });
    try {
      await studentsRepository.insert({
        id: signUp.userId,
        mess_id: messId,
        email: input.email,
        full_name: input.full_name,
        phone: input.phone,
        roll_number: input.roll_number ?? null,
      });
    } catch (err) {
      // A CONFLICT can mean two things: a concurrent identical registration already created the row
      // (fine), or a foreign-key problem such as a wrong DEFAULT_MESS_ID (NOT fine). Only the profile
      // row actually existing proves the first case; otherwise roll the new login back and fail loudly.
      const alreadyCreated = err instanceof AppError && err.code === 'CONFLICT' && (await studentsRepository.findById(signUp.userId)) !== null;
      if (!alreadyCreated) {
        try {
          await authRepository.deleteUser(signUp.userId);
        } catch (cleanupErr) {
          logger.error({ err: cleanupErr, user_id: signUp.userId }, 'registration rollback failed');
        }
        logger.error({ err, mess_id: messId }, 'could not create the student profile');
        throw err;
      }
    }
  }

  return { email: input.email, verification_required: true, resend_after_seconds: RESEND_AFTER_SECONDS };
}

export async function verifyStudentEmail(email: string, otp: string) {
  await authRepository.verifySignupOtp(email, otp);
  return { verified: true };
}

/** Always succeeds from the caller's point of view (no account enumeration). */
export async function resendVerification(email: string) {
  try {
    await authRepository.resendSignupOtp(email);
  } catch (err) {
    if (err instanceof AppError && err.code === 'RATE_LIMITED') throw err;
    logger.warn({ email: maskEmail(email), err }, 'resend verification failed (hidden from client)');
  }
  return { sent: true, resend_after_seconds: RESEND_AFTER_SECONDS };
}

// ---------------------------------------------------------------- login

export async function loginStudent(email: string, password: string) {
  const session = await authRepository.signInWithPassword(email, password);

  const student = await studentsRepository.findById(session.userId);
  if (!student) {
    await revokeQuietly(session.accessToken);
    throw new AppError('FORBIDDEN', 'This is not a student account.');
  }
  if (!student.is_active) {
    await revokeQuietly(session.accessToken);
    throw new AppError('ACCOUNT_DISABLED');
  }
  return { ...toTokenResponse(session), user: toStudentDto(student) };
}

export async function loginAdmin(email: string, password: string, meta: RequestMeta) {
  try {
    const session = await authRepository.signInWithPassword(email, password);

    const admin = await adminsRepository.findById(session.userId);
    if (!admin) {
      await revokeQuietly(session.accessToken);
      throw new AppError('FORBIDDEN', 'This is not an admin account.');
    }
    if (!admin.is_active) {
      await revokeQuietly(session.accessToken);
      throw new AppError('ACCOUNT_DISABLED');
    }
    return { ...toTokenResponse(session), user: toAdminDto(admin) };
  } catch (err) {
    if (err instanceof AppError && ['INVALID_CREDENTIALS', 'FORBIDDEN', 'ACCOUNT_DISABLED'].includes(err.code)) {
      await auditService
        .record({
          messId: await getDefaultMessId().catch(() => null),
          actorId: null,
          actorRole: null,
          action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
          entityType: 'auth',
          metadata: { email: maskEmail(email), reason: err.code },
          meta,
        })
        .catch((auditErr) => logger.error({ err: auditErr }, 'could not write login_failed audit entry'));
    }
    throw err;
  }
}

// ---------------------------------------------------------------- session management

export async function refresh(refreshToken: string) {
  const session = await authRepository.refreshSession(refreshToken);

  const profile = await resolveProfile(session.userId);
  if (!profile) {
    await revokeQuietly(session.accessToken);
    throw new AppError('UNAUTHORIZED');
  }
  if (!profile.isActive) {
    await revokeQuietly(session.accessToken);
    throw new AppError('ACCOUNT_DISABLED');
  }

  const user = profile.role === 'student' ? toStudentDto(profile.row) : toAdminDto(profile.row);
  return { ...toTokenResponse(session), role: profile.role, user };
}

export async function logout(auth: AuthContext, pushToken?: string) {
  await authRepository.revokeSession(auth.accessToken, 'local');
  if (pushToken) {
    try {
      await pushTokensRepository.removeForUser(auth.userId, pushToken);
    } catch (err) {
      logger.warn({ err }, 'could not remove push token on logout');
    }
  }
  return { logged_out: true };
}

// ---------------------------------------------------------------- passwords

/** Always reports success (no account enumeration); only rate limiting is surfaced. */
export async function forgotPassword(email: string) {
  try {
    await authRepository.sendRecoveryOtp(email);
  } catch (err) {
    if (err instanceof AppError && err.code === 'RATE_LIMITED') throw err;
    logger.warn({ email: maskEmail(email), err }, 'password recovery failed (hidden from client)');
  }
  return { sent: true };
}

export async function resetPassword(email: string, otp: string, newPassword: string) {
  await authRepository.resetPasswordWithOtp(email, otp, newPassword);
  return { reset: true };
}

export async function changePassword(auth: AuthContext, currentPassword: string, newPassword: string) {
  await authRepository.verifyCredentials(auth.email, currentPassword); // INVALID_CREDENTIALS if wrong
  await authRepository.setPassword(auth.userId, newPassword);
  await authRepository.revokeSession(auth.accessToken, 'others');
  return { changed: true };
}
