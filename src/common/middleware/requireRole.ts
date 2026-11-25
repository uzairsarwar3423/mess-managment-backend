import type { RequestHandler } from 'express';
import type { Role } from '../../config/constants';
import { AppError } from '../errors/AppError';

/** Allows the request only when the authenticated user has one of the given roles. Fails closed. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new AppError('UNAUTHORIZED'));
    if (!roles.includes(req.auth.role)) return next(new AppError('FORBIDDEN'));
    next();
  };
}
