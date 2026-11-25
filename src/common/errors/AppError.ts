import { ERROR_CODES, type ErrorCode } from './errorCodes';

/** An error that is safe to show to the client. Thrown by services and middleware. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? ERROR_CODES[code].message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.details = details;
  }
}

export const notFound = (message?: string): AppError => new AppError('NOT_FOUND', message);
export const forbidden = (message?: string): AppError => new AppError('FORBIDDEN', message);
export const conflict = (message?: string, details?: unknown): AppError =>
  new AppError('CONFLICT', message, details);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
