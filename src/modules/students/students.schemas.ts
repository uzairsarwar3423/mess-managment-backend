import { z } from 'zod';
import { fullName, isoDate, mealType, month, pagination, phonePk } from '../../common/schemas';

export const updateProfileBody = z
  .object({
    full_name: fullName,
    phone: phonePk,
    roll_number: z.string().trim().min(1).max(30).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to change' });

export const profileImageBody = z.object({ public_id: z.string().trim().min(10).max(300) }).strict();

export const adminListQuery = pagination
  .extend({
    q: z.string().trim().min(2).max(60).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    subscription: z.enum(['active', 'expiring', 'expired', 'scheduled', 'none']).optional(),
    sort: z.enum(['name', 'code', 'created_at']).default('name'),
  })
  .strict();

export const setStatusBody = z
  .object({ is_active: z.boolean(), reason: z.string().trim().min(5).max(300).optional() })
  .strict()
  .refine((v) => v.is_active || Boolean(v.reason), { path: ['reason'], message: 'A reason is required to deactivate a student' });

/** Either `month` (calendar view) or a date range (history list), never both. */
export const studentAttendanceQuery = pagination
  .extend({
    month: month.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    meal_type: mealType.optional(),
  })
  .strict()
  .refine((v) => !v.month || (!v.from && !v.to && !v.meal_type), {
    message: 'Use either "month" or "from"/"to", not both',
  });

export type UpdateProfileBody = z.infer<typeof updateProfileBody>;
export type ProfileImageBody = z.infer<typeof profileImageBody>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
export type SetStatusBody = z.infer<typeof setStatusBody>;
export type StudentAttendanceQuery = z.infer<typeof studentAttendanceQuery>;
