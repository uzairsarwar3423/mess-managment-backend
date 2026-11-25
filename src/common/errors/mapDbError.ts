import { AppError } from './AppError';
import type { ErrorCode } from './errorCodes';

/** Shape of errors returned by supabase-js (PostgREST): SQLSTATE in `code`, text in `message`. */
export interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** Constraint / index name -> application error (docs/backend-architecture.md section 8.2). */
const CONSTRAINT_MAP: Record<string, ErrorCode> = {
  uq_attendance_student_date_meal: 'ALREADY_MARKED',
  uq_payments_one_pending_per_student: 'PENDING_PAYMENT_EXISTS',
  uq_payments_transaction: 'DUPLICATE_TRANSACTION',
  uq_qr_label_active: 'QR_LABEL_EXISTS',
  students_email_key: 'EMAIL_ALREADY_REGISTERED',
  admins_email_key: 'EMAIL_ALREADY_REGISTERED',
  ex_subscriptions_no_overlap: 'SUBSCRIPTION_OVERLAP',
};

/** Raised exceptions from SQL functions (errcode P0001 / P0002). */
const RAISE_MAP: Record<string, ErrorCode> = {
  PAYMENT_NOT_PENDING: 'PAYMENT_NOT_PENDING',
  PAYMENT_NOT_FOUND: 'NOT_FOUND',
  ADMIN_NOT_AUTHORIZED: 'FORBIDDEN',
  ATTENDANCE_NOT_COVERED_BY_SUBSCRIPTION: 'NO_ACTIVE_SUBSCRIPTION',
};

export function looksLikeDbError(err: unknown): err is DbErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as DbErrorLike).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((err as DbErrorLike).code as string)
  );
}

/**
 * Converts a Postgres/PostgREST error into an AppError. Returns an INTERNAL_ERROR AppError for
 * anything unrecognised so callers can always `throw mapDbError(error)`.
 */
export function mapDbError(err: DbErrorLike): AppError {
  const text = `${err.message ?? ''} ${err.details ?? ''}`;

  switch (err.code) {
    case '23505': // unique_violation
    case '23P01': {
      // exclusion_violation
      for (const [name, code] of Object.entries(CONSTRAINT_MAP)) {
        if (text.includes(name)) return new AppError(code);
      }
      return new AppError('CONFLICT');
    }
    case '23503': // foreign_key_violation
      return new AppError('CONFLICT');
    case '23514': // check_violation: validation missed something
      return new AppError('VALIDATION_ERROR');
    case 'P0001':
    case 'P0002': {
      for (const [name, code] of Object.entries(RAISE_MAP)) {
        if (text.includes(name)) return new AppError(code);
      }
      return new AppError('INTERNAL_ERROR');
    }
    default:
      return new AppError('INTERNAL_ERROR');
  }
}
