import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../../config/env';
import { AppError } from '../errors/AppError';

interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** How to bucket requests. Defaults to the client IP. */
  key?: (req: Request) => string;
}

const ipKey = (req: Request): string => ipKeyGenerator(req.ip ?? '0.0.0.0');

/** Builds a limiter whose rejections use the standard error envelope. */
export function createLimiter({ windowMs, limit, key = ipKey }: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: key,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
  });
}

const MINUTE = 60_000;

/** Authenticated user id when available (after `authenticate`), otherwise the IP. */
export const userKey = (req: Request): string => req.auth?.userId ?? ipKey(req);

/** Email from the body (lower-cased) combined with the IP, for OTP-style endpoints. */
export const emailKey = (req: Request): string => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return `${email}|${ipKey(req)}`;
};

export const globalLimiter = (): RequestHandler =>
  createLimiter({ windowMs: env.RATE_LIMIT_WINDOW_MS, limit: env.RATE_LIMIT_MAX });

/** Login / register / verify / reset: 10 per 15 minutes. */
export const authLimiter = (): RequestHandler =>
  createLimiter({ windowMs: 15 * MINUTE, limit: 10, key: emailKey });

/** Resend / forgot-password: 3 per 10 minutes per email. */
export const resendLimiter = (): RequestHandler =>
  createLimiter({ windowMs: 10 * MINUTE, limit: 3, key: emailKey });

/** QR scan: 20 per minute per user. */
export const scanLimiter = (): RequestHandler =>
  createLimiter({ windowMs: MINUTE, limit: 20, key: userKey });

/** Cloudinary signatures: 10 per 10 minutes per user. */
export const uploadSignatureLimiter = (): RequestHandler =>
  createLimiter({ windowMs: 10 * MINUTE, limit: 10, key: userKey });

/** PDF generation: 10 per minute per user. */
export const pdfLimiter = (): RequestHandler =>
  createLimiter({ windowMs: MINUTE, limit: 10, key: userKey });
