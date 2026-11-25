import { Router } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/http/asyncHandler';
import { ok } from '../../common/http/respond';
import { uploadSignatureLimiter } from '../../common/middleware/rateLimit';
import { validate } from '../../common/middleware/validate';
import { signatureBody, type SignatureBody } from './uploads.schemas';
import * as service from './uploads.service';

/** Mounted at /api/v1/uploads with `authenticate` + `requireRole('student')` (v1: only students upload). */
export const uploadsRouter = Router();

uploadsRouter.post(
  '/signature',
  uploadSignatureLimiter(),
  validate({ body: signatureBody }),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new AppError('UNAUTHORIZED');
    const { purpose } = req.valid.body as SignatureBody;
    ok(res, service.createSignature(req.auth, purpose));
  }),
);
