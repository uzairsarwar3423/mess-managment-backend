import { z } from 'zod';
import { pagination } from '../../common/schemas';

export const studentHistoryQuery = pagination.strict();

export const adminListQuery = pagination
  .extend({
    status: z.enum(['scheduled', 'active', 'expired', 'cancelled']).optional(),
    expiring_within_days: z.coerce.number().int().min(1).max(30).optional(),
    q: z.string().trim().min(2).max(60).optional(),
  })
  .strict();

export const cancelBody = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

export type StudentHistoryQuery = z.infer<typeof studentHistoryQuery>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
export type CancelBody = z.infer<typeof cancelBody>;
