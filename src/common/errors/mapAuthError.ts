import { AppError } from './AppError';
import type { ErrorCode } from './errorCodes';

/** Shape of errors from @supabase/auth-js (AuthApiError and friends). */
export interface AuthErrorLike {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
}

const BY_CODE: Record<string, ErrorCode> = {
  invalid_credentials: 'INVALID_CREDENTIALS',
  email_not_confirmed: 'EMAIL_NOT_VERIFIED',
  otp_expired: 'INVALID_OTP',
  otp_disabled: 'INVALID_OTP',
  user_banned: 'ACCOUNT_DISABLED',
  email_exists: 'EMAIL_ALREADY_REGISTERED',
  user_already_exists: 'EMAIL_ALREADY_REGISTERED',
  weak_password: 'VALIDATION_ERROR',
  same_password: 'VALIDATION_ERROR',
  email_address_invalid: 'VALIDATION_ERROR',
  validation_failed: 'VALIDATION_ERROR',
  over_request_rate_limit: 'RATE_LIMITED',
  over_email_send_rate_limit: 'RATE_LIMITED',
  refresh_token_not_found: 'UNAUTHORIZED',
  refresh_token_already_used: 'UNAUTHORIZED',
  session_not_found: 'UNAUTHORIZED',
  session_expired: 'UNAUTHORIZED',
  bad_jwt: 'UNAUTHORIZED',
  user_not_found: 'UNAUTHORIZED',
};

/** Fallbacks for older/less specific responses, matched on the message. */
const BY_MESSAGE: [RegExp, ErrorCode][] = [
  [/invalid login credentials/i, 'INVALID_CREDENTIALS'],
  [/email not confirmed/i, 'EMAIL_NOT_VERIFIED'],
  [/token has expired or is invalid|otp.*(expired|invalid)/i, 'INVALID_OTP'],
  [/already registered|already been registered/i, 'EMAIL_ALREADY_REGISTERED'],
  [/rate limit/i, 'RATE_LIMITED'],
  [/refresh token/i, 'UNAUTHORIZED'],
];

/** Converts a Supabase Auth error into an AppError. Never leaks the provider's message for unknown cases. */
export function mapAuthError(err: AuthErrorLike): AppError {
  if (err.code && BY_CODE[err.code]) {
    const code = BY_CODE[err.code] as ErrorCode;
    // For validation failures the provider message (e.g. weak password) is safe and useful.
    return code === 'VALIDATION_ERROR' && err.message ? new AppError(code, err.message) : new AppError(code);
  }
  for (const [re, code] of BY_MESSAGE) {
    if (err.message && re.test(err.message)) return new AppError(code);
  }
  if (err.status === 429) return new AppError('RATE_LIMITED');
  // Network problems / provider outages
  if (err.name === 'AuthRetryableFetchError' || err.status === 0 || (err.status ?? 0) >= 500) {
    return new AppError('SERVICE_UNAVAILABLE');
  }
  return new AppError('INTERNAL_ERROR');
}
