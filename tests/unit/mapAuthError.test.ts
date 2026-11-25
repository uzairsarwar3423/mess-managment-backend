import { describe, expect, it } from 'vitest';
import { mapAuthError } from '../../src/common/errors/mapAuthError';

describe('mapAuthError', () => {
  it.each([
    [{ code: 'invalid_credentials', status: 400 }, 'INVALID_CREDENTIALS'],
    [{ code: 'email_not_confirmed', status: 400 }, 'EMAIL_NOT_VERIFIED'],
    [{ code: 'otp_expired', status: 403 }, 'INVALID_OTP'],
    [{ code: 'user_banned', status: 400 }, 'ACCOUNT_DISABLED'],
    [{ code: 'email_exists', status: 422 }, 'EMAIL_ALREADY_REGISTERED'],
    [{ code: 'over_email_send_rate_limit', status: 429 }, 'RATE_LIMITED'],
    [{ code: 'refresh_token_not_found', status: 400 }, 'UNAUTHORIZED'],
    [{ code: 'refresh_token_already_used', status: 400 }, 'UNAUTHORIZED'],
    [{ code: 'session_not_found', status: 403 }, 'UNAUTHORIZED'],
  ])('%j -> %s', (err, code) => {
    expect(mapAuthError(err).code).toBe(code);
  });

  it('falls back to message matching for older responses', () => {
    expect(mapAuthError({ message: 'Invalid login credentials' }).code).toBe('INVALID_CREDENTIALS');
    expect(mapAuthError({ message: 'Email not confirmed' }).code).toBe('EMAIL_NOT_VERIFIED');
    expect(mapAuthError({ message: 'Token has expired or is invalid' }).code).toBe('INVALID_OTP');
  });

  it('keeps the provider message for weak passwords only', () => {
    const e = mapAuthError({ code: 'weak_password', message: 'Password should be at least 8 characters' });
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.message).toContain('at least 8');
  });

  it('maps outages to SERVICE_UNAVAILABLE and unknown errors to a generic one', () => {
    expect(mapAuthError({ name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' }).code).toBe('SERVICE_UNAVAILABLE');
    expect(mapAuthError({ status: 502 }).code).toBe('SERVICE_UNAVAILABLE');
    const unknown = mapAuthError({ code: 'weird', message: 'internal provider detail' });
    expect(unknown.code).toBe('INTERNAL_ERROR');
    expect(unknown.message).not.toContain('provider');
  });
});
