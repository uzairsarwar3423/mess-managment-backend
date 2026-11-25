import jwt from 'jsonwebtoken';
import { QR_PREFIX } from '../../config/constants';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';

const ISSUER = 'mess-qr';
const VERSION = 1;

export interface QrClaims {
  /** qr_codes.id */
  qid: string;
  /** messes.id */
  mid: string;
}

/**
 * Signs the value printed in a static QR code: `MQ1:<jwt>` (HS256, issuer `mess-qr`, no expiry).
 * Printed codes stay valid until the `qr_codes` row is revoked, so there is deliberately no `exp`.
 * The token carries no personal data, meal or date.
 */
export function signQrToken(claims: QrClaims, secret: string = env.QR_SIGNING_SECRET): string {
  const token = jwt.sign({ v: VERSION, qid: claims.qid, mid: claims.mid }, secret, {
    algorithm: 'HS256',
    issuer: ISSUER,
  });
  return `${QR_PREFIX}${token}`;
}

/**
 * Verifies signature, algorithm (pinned to HS256), issuer and claim shapes.
 * Any problem -> QR_INVALID (the client never learns why). The caller must still load the
 * `qr_codes` row and check mess + revocation.
 */
export function verifyQrToken(value: string, secret: string = env.QR_SIGNING_SECRET): QrClaims {
  if (typeof value !== 'string' || !value.startsWith(QR_PREFIX)) throw new AppError('QR_INVALID');
  const raw = value.slice(QR_PREFIX.length);

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(raw, secret, { algorithms: ['HS256'], issuer: ISSUER });
  } catch {
    throw new AppError('QR_INVALID');
  }

  if (typeof payload === 'string' || payload.v !== VERSION) throw new AppError('QR_INVALID');
  const { qid, mid } = payload as { qid?: unknown; mid?: unknown };
  if (typeof qid !== 'string' || typeof mid !== 'string') throw new AppError('QR_INVALID');
  return { qid, mid };
}
