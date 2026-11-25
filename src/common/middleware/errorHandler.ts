import type { ErrorRequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { looksLikeDbError, mapDbError } from '../errors/mapDbError';
import { logger } from '../../lib/logger';

/** Converts any thrown value into the standard error envelope. Must be the last middleware. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);

  const log = (req as { log?: typeof logger }).log ?? logger;
  if (appError.status >= 500) {
    log.error({ err, request_id: req.requestId }, 'unhandled error');
  } else if (appError.status === 422 || appError.status === 429) {
    log.warn({ code: appError.code, request_id: req.requestId }, 'request rejected');
  }

  if (res.headersSent) return;
  res.status(appError.status).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
    },
    request_id: req.requestId,
  });
};

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError(
      'VALIDATION_ERROR',
      undefined,
      err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    );
  }

  // body-parser: malformed JSON / payload too large
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.parse.failed') return new AppError('VALIDATION_ERROR', 'Malformed JSON body.');
  if (e?.type === 'entity.too.large') return new AppError('VALIDATION_ERROR', 'Request body is too large.');

  if (err instanceof jwt.TokenExpiredError) return new AppError('TOKEN_EXPIRED');
  if (err instanceof jwt.JsonWebTokenError) return new AppError('UNAUTHORIZED');

  if (looksLikeDbError(err)) return mapDbError(err);

  return new AppError('INTERNAL_ERROR');
}
