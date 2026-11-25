import type { AuthError, Session } from '@supabase/supabase-js';
import { mapAuthError } from '../../common/errors/mapAuthError';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../lib/logger';
import { createAuthClient, getDb } from '../../lib/supabase';

/** Thin wrapper over Supabase Auth. Every function throws an AppError on failure. */

export interface AuthSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /** epoch seconds */
  expiresAt: number;
}

function toSession(session: Session): AuthSession {
  return {
    userId: session.user.id,
    email: session.user.email ?? '',
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
  };
}

function check(error: AuthError | null): void {
  if (error) {
    // The client only sees our mapped error; the real provider code is logged to diagnose setup problems
    // (wrong SMTP/template/OTP settings). No email address, password or code is logged.
    logger.warn({ auth_code: error.code, auth_status: error.status, auth_message: error.message }, 'supabase auth error');
    throw mapAuthError(error);
  }
}

export interface SignUpResult {
  userId: string;
  /** True when the email already belongs to a confirmed account (Supabase hides this behind an empty identities list). */
  alreadyRegistered: boolean;
  /** True only if email confirmation is disabled in Supabase (misconfiguration, BR-15). */
  hasSession: boolean;
}

export async function signUp(email: string, password: string, fullName: string): Promise<SignUpResult> {
  const { data, error } = await createAuthClient().auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  check(error);
  if (!data.user) throw new AppError('INTERNAL_ERROR');
  return {
    userId: data.user.id,
    alreadyRegistered: Array.isArray(data.user.identities) && data.user.identities.length === 0,
    hasSession: data.session !== null,
  };
}

export async function resendSignupOtp(email: string): Promise<void> {
  const { error } = await createAuthClient().auth.resend({ type: 'signup', email });
  check(error);
}

/** Confirms the email with the 6-digit code. The session Supabase opens is revoked immediately. */
export async function verifySignupOtp(email: string, otp: string): Promise<void> {
  const client = createAuthClient();
  // The emailed code is a "signup" token for a new account; Supabase's current docs call the same
  // email-code check type "email". Try "signup" first and fall back to "email" so either works.
  let result = await client.auth.verifyOtp({ email, token: otp, type: 'signup' });
  if (result.error) {
    const retry = await client.auth.verifyOtp({ email, token: otp, type: 'email' });
    if (!retry.error) result = retry;
  }
  check(result.error);
  if (result.data.session) await client.auth.signOut({ scope: 'local' });
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
  const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
  check(error);
  if (!data.session) throw new AppError('INTERNAL_ERROR');
  return toSession(data.session);
}

/** Checks a password without keeping the session it creates. */
export async function verifyCredentials(email: string, password: string): Promise<void> {
  const client = createAuthClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  check(error);
  if (data.session) await client.auth.signOut({ scope: 'local' });
}

export async function refreshSession(refreshToken: string): Promise<AuthSession> {
  const { data, error } = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw mapAuthError(error);
  if (!data.session) throw new AppError('UNAUTHORIZED');
  return toSession(data.session);
}

/** Revokes a session server-side. scope: this session only, every other session, or all. */
export async function revokeSession(accessToken: string, scope: 'local' | 'others' | 'global'): Promise<void> {
  const { error } = await getDb().auth.admin.signOut(accessToken, scope);
  check(error);
}

export async function sendRecoveryOtp(email: string): Promise<void> {
  const { error } = await createAuthClient().auth.resetPasswordForEmail(email);
  check(error);
}

/** Verifies the recovery code, sets the new password and signs the user out everywhere. */
export async function resetPasswordWithOtp(email: string, otp: string, newPassword: string): Promise<void> {
  const client = createAuthClient();
  const { data, error } = await client.auth.verifyOtp({ email, token: otp, type: 'recovery' });
  check(error);
  if (!data.session) throw new AppError('INVALID_OTP');

  const { error: updateError } = await client.auth.updateUser({ password: newPassword });
  check(updateError);
  await revokeSession(data.session.access_token, 'global');
}

export async function setPassword(userId: string, newPassword: string): Promise<void> {
  const { error } = await getDb().auth.admin.updateUserById(userId, { password: newPassword });
  check(error);
}

/** Only used to roll back a registration whose profile row could not be created. */
export async function deleteUser(userId: string): Promise<void> {
  const { error } = await getDb().auth.admin.deleteUser(userId);
  check(error);
}

/** Blocks (or unblocks) token refresh/sign-in at Supabase for a disabled account. */
export async function setBanned(userId: string, banned: boolean): Promise<void> {
  const { error } = await getDb().auth.admin.updateUserById(userId, { ban_duration: banned ? '876000h' : 'none' });
  check(error);
}

/** Creates an already-verified Supabase user (used for admin accounts created by a super admin). */
export async function createVerifiedUser(email: string, password: string): Promise<string> {
  const { data, error } = await getDb().auth.admin.createUser({ email, password, email_confirm: true });
  check(error);
  if (!data.user) throw new AppError('INTERNAL_ERROR');
  return data.user.id;
}
