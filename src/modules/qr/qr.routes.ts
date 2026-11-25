import { Router } from 'express';
import { asyncHandler } from '../../common/http/asyncHandler';
import { pdfLimiter } from '../../common/middleware/rateLimit';
import { validate } from '../../common/middleware/validate';
import { idParam } from '../../common/schemas';
import * as controller from './qr.controller';
import { createQrBody, listQrQuery, revokeQrBody } from './qr.schemas';

/** Mounted under /api/v1/admin (role guard: admin | super_admin). Any active admin manages QR codes. */
export const adminQrRouter = Router();

adminQrRouter.get('/qr-codes', validate({ query: listQrQuery }), asyncHandler(controller.list));
adminQrRouter.post('/qr-codes', validate({ body: createQrBody }), asyncHandler(controller.create));
adminQrRouter.get('/qr-codes/:id', validate({ params: idParam }), asyncHandler(controller.get));
adminQrRouter.get('/qr-codes/:id/print.pdf', pdfLimiter(), validate({ params: idParam }), asyncHandler(controller.printPdf));
adminQrRouter.post('/qr-codes/:id/revoke', validate({ params: idParam, body: revokeQrBody }), asyncHandler(controller.revoke));
