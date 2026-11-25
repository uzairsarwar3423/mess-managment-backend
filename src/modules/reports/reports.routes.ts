import { Router, type Request, type Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/http/asyncHandler';
import { ok } from '../../common/http/respond';
import { pdfLimiter } from '../../common/middleware/rateLimit';
import { validate } from '../../common/middleware/validate';
import type { AuthContext, RequestMeta } from '../../common/types';
import {
  dailyPdfQuery, monthlyPdfQuery, overviewQuery, paymentsPdfQuery, statementPdfQuery,
  type DailyPdfQuery, type MonthlyPdfQuery, type OverviewQuery, type PaymentsPdfQuery, type StatementPdfQuery,
} from './reports.schemas';
import * as service from './reports.service';
import type { PdfDocument } from './reports.service';

function authOf(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHORIZED');
  return req.auth;
}

const metaOf = (req: Request): RequestMeta => ({ ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null });

/**
 * All data is loaded (and the download audited) BEFORE any byte is written, so every failure is still
 * a normal JSON error; the PDF headers are set only on success.
 */
async function sendPdf(res: Response, pdf: PdfDocument): Promise<void> {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  await pdf.render(res);
}

/** Mounted under /api/v1/admin (role guard: admin | super_admin). */
export const adminReportsRouter = Router();

adminReportsRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    ok(res, await service.adminDashboard(authOf(req)));
  }),
);

adminReportsRouter.get(
  '/reports/overview',
  validate({ query: overviewQuery }),
  asyncHandler(async (req, res) => {
    ok(res, await service.overview(authOf(req), req.valid.query as OverviewQuery));
  }),
);

adminReportsRouter.get(
  '/reports/attendance-monthly.pdf',
  pdfLimiter(),
  validate({ query: monthlyPdfQuery }),
  asyncHandler(async (req, res) => {
    await sendPdf(res, await service.monthlyAttendancePdf(authOf(req), req.valid.query as MonthlyPdfQuery, metaOf(req)));
  }),
);

adminReportsRouter.get(
  '/reports/attendance-daily.pdf',
  pdfLimiter(),
  validate({ query: dailyPdfQuery }),
  asyncHandler(async (req, res) => {
    await sendPdf(res, await service.dailyAttendancePdf(authOf(req), req.valid.query as DailyPdfQuery, metaOf(req)));
  }),
);

adminReportsRouter.get(
  '/reports/payments.pdf',
  pdfLimiter(),
  validate({ query: paymentsPdfQuery }),
  asyncHandler(async (req, res) => {
    await sendPdf(res, await service.paymentsPdf(authOf(req), req.valid.query as PaymentsPdfQuery, metaOf(req)));
  }),
);

adminReportsRouter.get(
  '/reports/student-statement.pdf',
  pdfLimiter(),
  validate({ query: statementPdfQuery }),
  asyncHandler(async (req, res) => {
    await sendPdf(res, await service.studentStatementPdf(authOf(req), req.valid.query as StatementPdfQuery, metaOf(req)));
  }),
);
