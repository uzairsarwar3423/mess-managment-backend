import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/AppError';

// ---- mock every module that talks to Supabase; controllers/validation/errors/middleware stay real
const m = vi.hoisted(() => ({
  auth: {
    signUp: vi.fn(),
    resendSignupOtp: vi.fn(),
    verifySignupOtp: vi.fn(),
    signInWithPassword: vi.fn(),
    verifyCredentials: vi.fn(),
    refreshSession: vi.fn(),
    revokeSession: vi.fn(),
    sendRecoveryOtp: vi.fn(),
    resetPasswordWithOtp: vi.fn(),
    setPassword: vi.fn(),
    deleteUser: vi.fn(),
  },
  students: { findById: vi.fn(), insert: vi.fn() },
  admins: { findById: vi.fn() },
  audit: { insert: vi.fn() },
  push: { removeForUser: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
}));

vi.mock('../../src/modules/auth/auth.repository', () => m.auth);
vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/audit/audit.repository', () => m.audit);
vi.mock('../../src/modules/notifications/pushTokens.repository', () => m.push);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);

import { createApp } from '../../src/app';

const app = createApp({ readinessCheck: async () => undefined });
const MESS = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';

let n = 0;
/** Unique email per call so per-email rate limits never interfere between tests. */
const uniqueEmail = (): string => `user${++n}@example.com`;

const session = (userId = USER) => ({
  userId,
  email: 'x@example.com',
  accessToken: 'access-token-value',
  refreshToken: 'refresh-token-value',
  expiresIn: 3600,
  expiresAt: 1_800_000_000,
});

const studentRow = (over: Record<string, unknown> = {}) => ({
  id: USER,
  mess_id: MESS,
  student_code: 'S00042',
  email: 'x@example.com',
  full_name: 'Ali Khan',
  phone: '03001234567',
  roll_number: null,
  profile_image_url: null,
  is_active: true,
  created_at: '2026-11-01T09:00:00Z',
  ...over,
});

const adminRow = (over: Record<string, unknown> = {}) => ({
  id: USER,
  mess_id: MESS,
  email: 'admin@example.com',
  full_name: 'Mess Owner',
  phone: null,
  role: 'admin',
  is_active: true,
  created_at: '2026-11-01T09:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.students.findById.mockResolvedValue(null);
  m.admins.findById.mockResolvedValue(null);
  m.auth.revokeSession.mockResolvedValue(undefined);
  m.audit.insert.mockResolvedValue(undefined);
});

describe('POST /auth/student/register', () => {
  const valid = () => ({
    full_name: 'Ali Khan',
    email: uniqueEmail(),
    phone: '03001234567',
    password: 'Secret123',
  });

  it('creates the profile row and asks for verification', async () => {
    m.auth.signUp.mockResolvedValue({ userId: USER, alreadyRegistered: false, hasSession: false });
    m.students.insert.mockResolvedValue(studentRow());
    const body = { ...valid(), roll_number: '21-CS-045' };

    const res = await request(app).post('/api/v1/auth/student/register').send(body);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: body.email, verification_required: true, resend_after_seconds: 60 });
    expect(m.students.insert).toHaveBeenCalledWith({
      id: USER,
      mess_id: MESS,
      email: body.email,
      full_name: 'Ali Khan',
      phone: '03001234567',
      roll_number: '21-CS-045',
    });
  });

  it('rejects an email that is already registered', async () => {
    m.auth.signUp.mockResolvedValue({ userId: USER, alreadyRegistered: true, hasSession: false });
    const res = await request(app).post('/api/v1/auth/student/register').send(valid());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(m.students.insert).not.toHaveBeenCalled();
  });

  it('treats a repeated registration of an unverified account as a resend (no second profile row)', async () => {
    m.auth.signUp.mockResolvedValue({ userId: USER, alreadyRegistered: false, hasSession: false });
    m.students.findById.mockResolvedValue(studentRow());
    const res = await request(app).post('/api/v1/auth/student/register').send(valid());
    expect(res.status).toBe(201);
    expect(m.students.insert).not.toHaveBeenCalled();
  });

  it('rolls back the auth user when the profile insert fails', async () => {
    m.auth.signUp.mockResolvedValue({ userId: USER, alreadyRegistered: false, hasSession: false });
    m.students.insert.mockRejectedValue(new AppError('INTERNAL_ERROR'));
    m.auth.deleteUser.mockResolvedValue(undefined);
    const res = await request(app).post('/api/v1/auth/student/register').send(valid());
    expect(res.status).toBe(500);
    expect(m.auth.deleteUser).toHaveBeenCalledWith(USER);
  });

  it('does NOT delete the auth user when a concurrent request really created the profile', async () => {
    m.auth.signUp.mockResolvedValue({ userId: USER, alreadyRegistered: false, hasSession: false });
    m.students.findById.mockResolvedValueOnce(null).mockResolvedValueOnce(studentRow()); // 2nd lookup: the row exists
    m.students.insert.mockRejectedValue(new AppError('CONFLICT'));
    const res = await request(app).post('/api/v1/auth/student/register').send(valid());
    expect(res.status).toBe(201);
    expect(m.auth.deleteUser).not.toHaveBeenCalled();
  });

  it('a CONFLICT without a profile row (e.g. wrong DEFAULT_MESS_ID -> foreign key) is rolled back and reported, never "success"', async () => {
    m.auth.signUp.mockResolvedValue({ userId: USER, alreadyRegistered: false, hasSession: false });
    m.students.findById.mockResolvedValue(null); // the row does NOT exist
    m.students.insert.mockRejectedValue(new AppError('CONFLICT'));
    m.auth.deleteUser.mockResolvedValue(undefined);
    const res = await request(app).post('/api/v1/auth/student/register').send(valid());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(m.auth.deleteUser).toHaveBeenCalledWith(USER);
  });

  it.each([
    ['weak password', { password: 'short1' }],
    ['password without a digit', { password: 'OnlyLetters' }],
    ['bad phone', { phone: '12345' }],
    ['bad email', { email: 'not-an-email' }],
    ['short name', { full_name: 'A' }],
    ['smuggled role', { role: 'super_admin' }],
    ['smuggled is_active', { is_active: true }],
  ])('rejects %s', async (_label, patch) => {
    const res = await request(app)
      .post('/api/v1/auth/student/register')
      .send({ ...valid(), ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(m.auth.signUp).not.toHaveBeenCalled();
  });
});

describe('verify / resend', () => {
  it('verifies the 6-digit code', async () => {
    m.auth.verifySignupOtp.mockResolvedValue(undefined);
    const email = uniqueEmail();
    const res = await request(app).post('/api/v1/auth/student/verify-email').send({ email, otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ verified: true });
    expect(m.auth.verifySignupOtp).toHaveBeenCalledWith(email, '123456');
  });

  it('maps a wrong code to INVALID_OTP', async () => {
    m.auth.verifySignupOtp.mockRejectedValue(new AppError('INVALID_OTP'));
    const res = await request(app).post('/api/v1/auth/student/verify-email').send({ email: uniqueEmail(), otp: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OTP');
  });

  it('rejects a malformed code before calling Supabase', async () => {
    const res = await request(app).post('/api/v1/auth/student/verify-email').send({ email: uniqueEmail(), otp: '12ab56' });
    expect(res.status).toBe(400);
    expect(m.auth.verifySignupOtp).not.toHaveBeenCalled();
  });

  it('resend is always a generic success (no account enumeration)', async () => {
    m.auth.resendSignupOtp.mockRejectedValue(new AppError('INTERNAL_ERROR'));
    const res = await request(app).post('/api/v1/auth/student/resend-verification').send({ email: uniqueEmail() });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, resend_after_seconds: 60 });
  });

  it('resend is limited to 3 per email', async () => {
    m.auth.resendSignupOtp.mockResolvedValue(undefined);
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await request(app).post('/api/v1/auth/student/resend-verification').send({ email })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe('POST /auth/student/login', () => {
  const login = (email = uniqueEmail()) =>
    request(app).post('/api/v1/auth/student/login').send({ email, password: 'Secret123' });

  it('returns tokens and the student without internal columns', async () => {
    m.auth.signInWithPassword.mockResolvedValue(session());
    m.students.findById.mockResolvedValue(studentRow());
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      access_token: 'access-token-value',
      refresh_token: 'refresh-token-value',
      token_type: 'bearer',
      expires_in: 3600,
      user: { id: USER, student_code: 'S00042', full_name: 'Ali Khan' },
    });
    expect(res.body.data.user.mess_id).toBeUndefined();
    expect(res.body.data.expires_at).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it('passes through wrong credentials and unverified email', async () => {
    m.auth.signInWithPassword.mockRejectedValueOnce(new AppError('INVALID_CREDENTIALS'));
    expect((await login()).body.error.code).toBe('INVALID_CREDENTIALS');
    m.auth.signInWithPassword.mockRejectedValueOnce(new AppError('EMAIL_NOT_VERIFIED'));
    const res = await login();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('refuses and revokes the session for a disabled student (BR-16)', async () => {
    m.auth.signInWithPassword.mockResolvedValue(session());
    m.students.findById.mockResolvedValue(studentRow({ is_active: false }));
    const res = await login();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(m.auth.revokeSession).toHaveBeenCalledWith('access-token-value', 'local');
  });

  it('refuses an account that is not a student (e.g. an admin)', async () => {
    m.auth.signInWithPassword.mockResolvedValue(session());
    const res = await login();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(m.auth.revokeSession).toHaveBeenCalled();
  });
});

describe('POST /auth/admin/login', () => {
  const login = (email = uniqueEmail()) =>
    request(app).post('/api/v1/auth/admin/login').send({ email, password: 'Secret123' });

  it('logs an admin in', async () => {
    m.auth.signInWithPassword.mockResolvedValue(session());
    m.admins.findById.mockResolvedValue(adminRow({ role: 'super_admin' }));
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ role: 'super_admin', full_name: 'Mess Owner' });
    expect(m.audit.insert).not.toHaveBeenCalled();
  });

  it('audits a failed attempt with a masked email and the IP', async () => {
    m.auth.signInWithPassword.mockRejectedValue(new AppError('INVALID_CREDENTIALS'));
    const res = await login('boss@example.com');
    expect(res.status).toBe(401);
    expect(m.audit.insert).toHaveBeenCalledTimes(1);
    const entry = m.audit.insert.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: 'auth.login_failed', mess_id: MESS, actor_id: null });
    expect(entry.metadata).toEqual({ email: 'b***@example.com', reason: 'INVALID_CREDENTIALS' });
    expect(JSON.stringify(entry)).not.toContain('Secret123');
  });

  it('a student cannot open an Admin session', async () => {
    m.auth.signInWithPassword.mockResolvedValue(session());
    m.students.findById.mockResolvedValue(studentRow());
    const res = await login();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(m.auth.revokeSession).toHaveBeenCalled();
    expect(m.audit.insert).toHaveBeenCalled();
  });

  it('refuses a disabled admin', async () => {
    m.auth.signInWithPassword.mockResolvedValue(session());
    m.admins.findById.mockResolvedValue(adminRow({ is_active: false }));
    const res = await login();
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('does not fail the login response when the audit write fails', async () => {
    m.auth.signInWithPassword.mockRejectedValue(new AppError('INVALID_CREDENTIALS'));
    m.audit.insert.mockRejectedValue(new Error('db down'));
    const res = await login();
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  const refresh = () => request(app).post('/api/v1/auth/refresh').send({ refresh_token: 'refresh-token-value' });

  it('rotates tokens and reports the role', async () => {
    m.auth.refreshSession.mockResolvedValue(session());
    m.students.findById.mockResolvedValue(studentRow());
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ role: 'student', access_token: 'access-token-value' });
  });

  it('blocks a disabled account even with a valid refresh token', async () => {
    m.auth.refreshSession.mockResolvedValue(session());
    m.students.findById.mockResolvedValue(studentRow({ is_active: false }));
    const res = await refresh();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(m.auth.revokeSession).toHaveBeenCalled();
  });

  it('rejects an unknown user and invalid refresh tokens', async () => {
    m.auth.refreshSession.mockResolvedValueOnce(session());
    expect((await refresh()).status).toBe(401);
    m.auth.refreshSession.mockRejectedValueOnce(new AppError('UNAUTHORIZED'));
    expect((await refresh()).status).toBe(401);
  });
});

describe('authenticate middleware (via POST /auth/logout)', () => {
  const logout = (token?: string, body: object = {}) => {
    const r = request(app).post('/api/v1/auth/logout');
    if (token) r.set('Authorization', `Bearer ${token}`);
    return r.send(body);
  };

  it('requires a bearer token', async () => {
    const res = await logout();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(m.verify.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('reports an expired token so the client can refresh', async () => {
    m.verify.verifyAccessToken.mockRejectedValue(new AppError('TOKEN_EXPIRED'));
    const res = await logout('expired.jwt.token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a valid Supabase user that has no student/admin profile', async () => {
    m.verify.verifyAccessToken.mockResolvedValue({ sub: USER, email: 'x@example.com' });
    const res = await logout('some.jwt.token');
    expect(res.status).toBe(401);
  });

  it('blocks disabled accounts immediately (BR-16)', async () => {
    m.verify.verifyAccessToken.mockResolvedValue({ sub: USER, email: 'x@example.com' });
    m.students.findById.mockResolvedValue(studentRow({ is_active: false }));
    const res = await logout('some.jwt.token');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('logs out: revokes this session and removes the device push token', async () => {
    m.verify.verifyAccessToken.mockResolvedValue({ sub: USER, email: 'x@example.com' });
    m.students.findById.mockResolvedValue(studentRow());
    m.push.removeForUser.mockResolvedValue(undefined);
    const res = await logout('some.jwt.token', { push_token: 'ExponentPushToken[abc]' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ logged_out: true });
    expect(m.auth.revokeSession).toHaveBeenCalledWith('some.jwt.token', 'local');
    expect(m.push.removeForUser).toHaveBeenCalledWith(USER, 'ExponentPushToken[abc]');
  });

  it('resolves admins before students', async () => {
    m.verify.verifyAccessToken.mockResolvedValue({ sub: USER, email: 'admin@example.com' });
    m.admins.findById.mockResolvedValue(adminRow());
    const res = await logout('some.jwt.token');
    expect(res.status).toBe(200);
  });
});

describe('passwords', () => {
  const asStudent = () => {
    m.verify.verifyAccessToken.mockResolvedValue({ sub: USER, email: 'x@example.com' });
    m.students.findById.mockResolvedValue(studentRow());
  };
  const change = (body: object) =>
    request(app).post('/api/v1/auth/change-password').set('Authorization', 'Bearer some.jwt.token').send(body);

  it('forgot-password is a generic success even when sending fails', async () => {
    m.auth.sendRecoveryOtp.mockRejectedValue(new AppError('INTERNAL_ERROR'));
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: uniqueEmail() });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true });
  });

  it('reset-password sets the new password with the code', async () => {
    m.auth.resetPasswordWithOtp.mockResolvedValue(undefined);
    const email = uniqueEmail();
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email, otp: '654321', new_password: 'NewSecret123' });
    expect(res.status).toBe(200);
    expect(m.auth.resetPasswordWithOtp).toHaveBeenCalledWith(email, '654321', 'NewSecret123');
  });

  it('reset-password with a wrong code', async () => {
    m.auth.resetPasswordWithOtp.mockRejectedValue(new AppError('INVALID_OTP'));
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: uniqueEmail(), otp: '654321', new_password: 'NewSecret123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OTP');
  });

  it('change-password verifies the current password, sets the new one and revokes other sessions', async () => {
    asStudent();
    m.auth.verifyCredentials.mockResolvedValue(undefined);
    m.auth.setPassword.mockResolvedValue(undefined);
    const res = await change({ current_password: 'OldSecret123', new_password: 'NewSecret123' });
    expect(res.status).toBe(200);
    expect(m.auth.verifyCredentials).toHaveBeenCalledWith('x@example.com', 'OldSecret123');
    expect(m.auth.setPassword).toHaveBeenCalledWith(USER, 'NewSecret123');
    expect(m.auth.revokeSession).toHaveBeenCalledWith('some.jwt.token', 'others');
  });

  it('change-password stops at a wrong current password', async () => {
    asStudent();
    m.auth.verifyCredentials.mockRejectedValue(new AppError('INVALID_CREDENTIALS'));
    const res = await change({ current_password: 'wrong-pass1', new_password: 'NewSecret123' });
    expect(res.status).toBe(401);
    expect(m.auth.setPassword).not.toHaveBeenCalled();
  });

  it('change-password requires a different new password', async () => {
    asStudent();
    const res = await change({ current_password: 'SamePass123', new_password: 'SamePass123' });
    expect(res.status).toBe(400);
    expect(m.auth.verifyCredentials).not.toHaveBeenCalled();
  });
});
