import { z } from 'zod';
import { boolQuery, isoDate, mealType, month, pagination, uuid } from '../../common/schemas';
import { QR_PREFIX } from '../../config/constants';

export const scanBody = z
  .object({
    token: z.string().min(20).max(2000).startsWith(QR_PREFIX, 'Not a mess QR code'),
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy_m: z.number().min(0).max(5000),
        mocked: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const calendarQuery = z.object({ month }).strict();

export const historyQuery = pagination
  .extend({ from: isoDate.optional(), to: isoDate.optional(), meal_type: mealType.optional() })
  .strict();

export const dailyQuery = z
  .object({
    date: isoDate.optional(),
    meal_type: mealType,
    include_not_marked: boolQuery.default(false),
  })
  .strict();

export const monthlyQuery = z.object({ month, q: z.string().trim().min(1).max(60).optional() }).strict();

export const manualBody = z
  .object({
    student_id: uuid,
    meal_type: mealType,
    date: isoDate,
    reason: z.string().trim().min(5).max(300),
  })
  .strict();

export type ScanBody = z.infer<typeof scanBody>;
export type CalendarQuery = z.infer<typeof calendarQuery>;
export type HistoryQuery = z.infer<typeof historyQuery>;
export type DailyQuery = z.infer<typeof dailyQuery>;
export type MonthlyQuery = z.infer<typeof monthlyQuery>;
export type ManualBody = z.infer<typeof manualBody>;
