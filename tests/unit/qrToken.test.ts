import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/common/errors/AppError';
import { signQrToken, verifyQrToken } from '../../src/modules/qr/qrToken';

const SECRET = 'unit-test-secret-unit-test-secret-1234';
const claims = { qid: '22222222-2222-4222-8222-222222222222', mid: '11111111-1111-4111-8111-111111111111' };

function expectInvalid(fn: () => unknown): void {
  try {
    fn();
    throw new Error('expected QR_INVALID');
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('QR_INVALID');
  }
}

describe('QR token', () => {
  it('round-trips and carries the MQ1: prefix', () => {
    const token = signQrToken(claims, SECRET);
    expect(token.startsWith('MQ1:')).toBe(true);
    expect(verifyQrToken(token, SECRET)).toEqual(claims);
  });

  it('never expires (printed codes are revoked in the database instead)', () => {
    const token = signQrToken(claims, SECRET);
    const payload = jwt.decode(token.slice(4)) as Record<string, unknown>;
    expect(payload.exp).toBeUndefined();
    expect(payload.iss).toBe('mess-qr');
  });

  it('contains no personal data, meal or date', () => {
    const payload = jwt.decode(signQrToken(claims, SECRET).slice(4)) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['iat', 'iss', 'mid', 'qid', 'v']);
  });

  it('rejects a missing prefix', () => {
    expectInvalid(() => verifyQrToken(signQrToken(claims, SECRET).slice(4), SECRET));
  });

  it('rejects a wrong secret', () => {
    expectInvalid(() => verifyQrToken(signQrToken(claims, SECRET), 'another-secret-another-secret-12345'));
  });

  it('rejects a tampered payload', () => {
    const [h, , s] = signQrToken(claims, SECRET).slice(4).split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, qid: 'x', mid: 'y', iss: 'mess-qr' })).toString('base64url');
    expectInvalid(() => verifyQrToken(`MQ1:${h}.${forged}.${s}`, SECRET));
  });

  it('rejects alg=none tokens', () => {
    const none = jwt.sign({ v: 1, ...claims }, '', { algorithm: 'none', issuer: 'mess-qr' });
    expectInvalid(() => verifyQrToken(`MQ1:${none}`, SECRET));
  });

  it('rejects tokens from another issuer (e.g. a Supabase JWT signed with the same secret)', () => {
    const other = jwt.sign({ v: 1, ...claims }, SECRET, { algorithm: 'HS256', issuer: 'supabase' });
    expectInvalid(() => verifyQrToken(`MQ1:${other}`, SECRET));
  });

  it('rejects an unsupported version or malformed claims', () => {
    const v2 = jwt.sign({ v: 2, ...claims }, SECRET, { algorithm: 'HS256', issuer: 'mess-qr' });
    expectInvalid(() => verifyQrToken(`MQ1:${v2}`, SECRET));
    const bad = jwt.sign({ v: 1, qid: 5, mid: null }, SECRET, { algorithm: 'HS256', issuer: 'mess-qr' });
    expectInvalid(() => verifyQrToken(`MQ1:${bad}`, SECRET));
  });

  it('rejects garbage', () => {
    expectInvalid(() => verifyQrToken('hello', SECRET));
    expectInvalid(() => verifyQrToken('MQ1:', SECRET));
    expectInvalid(() => verifyQrToken('MQ1:a.b.c', SECRET));
  });
});
