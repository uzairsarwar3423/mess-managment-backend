import type { RequestHandler } from 'express';
import { resolveProfile } from '../../modules/auth/profileResolver';
import { verifyAccessToken } from '../../modules/auth/tokenVerifier';
import { AppError } from '../errors/AppError';

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Verifies the bearer token, resolves the role from our tables, rejects disabled accounts
 * (BR-16: takes effect immediately, not when the token expires) and sets `req.auth`.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const match = BEARER.exec(req.header('authorization') ?? '');
    if (!match?.[1]) throw new AppError('UNAUTHORIZED');
    const accessToken = match[1];

    const { sub, email } = await verifyAccessToken(accessToken);

    const profile = await resolveProfile(sub);
    if (!profile) throw new AppError('UNAUTHORIZED');
    if (!profile.isActive) throw new AppError('ACCOUNT_DISABLED');

    req.auth = {
      userId: profile.id,
      role: profile.role,
      messId: profile.messId,
      email: email || profile.email,
      accessToken,
    };
    next();
  } catch (err) {
    next(err);
  }
};
