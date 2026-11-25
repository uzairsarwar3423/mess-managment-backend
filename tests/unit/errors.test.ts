import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/common/errors/AppError';
import { mapDbError } from '../../src/common/errors/mapDbError';
import { toAppError } from '../../src/common/middleware/errorHandler';

describe('mapDbError', () => {
  const unique = (constraint: string) => ({
    code: '23505',
    message: `duplicate key value violates unique constraint "${constraint}"`,
  });

  it.each([
    ['uq_attendance_student_date_meal', 'ALREADY_MARKED'],
    ['uq_payments_one_pending_per_student', 'PENDING_PAYMENT_EXISTS'],
    ['uq_payments_transaction', 'DUPLICATE_TRANSACTION'],
    ['uq_qr_label_active', 'QR_LABEL_EXISTS'],
    ['students_email_key', 'EMAIL_ALREADY_REGISTERED'],
    ['admins_email_key', 'EMAIL_ALREADY_REGISTERED'],
  ])('%s -> %s', (constraint, code) => {
    const e = mapDbError(unique(constraint));
    expect(e.code).toBe(code);
  });

  it('maps the subscription overlap exclusion violation', () => {
    expect(mapDbError({ code: '23P01', message: 'conflicting key value violates exclusion constraint "ex_subscriptions_no_overlap"' }).code).toBe('SUBSCRIPTION_OVERLAP');
  });

  it('maps exceptions raised by SQL functions', () => {
    expect(mapDbError({ code: 'P0001', message: 'PAYMENT_NOT_PENDING' }).code).toBe('PAYMENT_NOT_PENDING');
    expect(mapDbError({ code: 'P0001', message: 'ADMIN_NOT_AUTHORIZED' })).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(mapDbError({ code: 'P0002', message: 'PAYMENT_NOT_FOUND' }).code).toBe('NOT_FOUND');
    expect(mapDbError({ code: 'P0001', message: 'ATTENDANCE_NOT_COVERED_BY_SUBSCRIPTION' }).code).toBe('NO_ACTIVE_SUBSCRIPTION');
  });

  it('falls back to a generic error for unknown conditions', () => {
    expect(mapDbError({ code: '23505', message: 'duplicate key "something_else"' }).code).toBe('CONFLICT');
    expect(mapDbError({ code: '57014', message: 'canceling statement' }).code).toBe('INTERNAL_ERROR');
  });
});

describe('toAppError', () => {
  it('keeps AppError as is', () => {
    const e = new AppError('FORBIDDEN');
    expect(toAppError(e)).toBe(e);
  });

  it('turns zod errors into VALIDATION_ERROR with field details', () => {
    const r = z.object({ email: z.email() }).strict().safeParse({ email: 'nope', role: 'admin' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const e = toAppError(r.error);
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.status).toBe(400);
      expect(JSON.stringify(e.details)).toContain('email');
    }
  });

  it('hides unknown errors behind INTERNAL_ERROR', () => {
    const e = toAppError(new Error('secret stack detail'));
    expect(e.code).toBe('INTERNAL_ERROR');
    expect(e.message).not.toContain('secret');
  });
});
