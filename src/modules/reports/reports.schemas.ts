import { z } from 'zod';
import { boolQuery, isoDate, month, uuid } from '../../common/schemas';

export const overviewQuery = z.object({ month: month.optional() }).strict();

export const monthlyPdfQuery = z.object({ month }).strict();

export const dailyPdfQuery = z.object({ date: isoDate.optional(), include_not_marked: boolQuery.default(false) }).strict();

export const paymentsPdfQuery = z
  .object({
    month,
    status: z.enum(['approved', 'rejected', 'pending', 'cancelled', 'all']).default('approved'),
  })
  .strict();

export const statementPdfQuery = z.object({ student_id: uuid, month }).strict();

export type OverviewQuery = z.infer<typeof overviewQuery>;
export type MonthlyPdfQuery = z.infer<typeof monthlyPdfQuery>;
export type DailyPdfQuery = z.infer<typeof dailyPdfQuery>;
export type PaymentsPdfQuery = z.infer<typeof paymentsPdfQuery>;
export type StatementPdfQuery = z.infer<typeof statementPdfQuery>;
