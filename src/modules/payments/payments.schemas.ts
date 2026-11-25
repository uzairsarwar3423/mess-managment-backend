import { z } from 'zod';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '../../config/constants';
import { isoDate, pagination, uuid } from '../../common/schemas';

/**
 * NOTE: no `amount` or `method`: the server sets the amount (BR-09) and derives the method from the account.
 * The transaction ID is OPTIONAL: the student proves the payment with the screenshot (the admin checks it by eye).
 */
export const submitPaymentBody = z
  .object({
    payment_account_id: uuid,
    transaction_id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{6,40}$/, 'Transaction ID must be 6-40 letters, digits or dashes')
      .optional(),
    screenshot_public_id: z.string().trim().min(10).max(300),
  })
  .strict();

export const studentListQuery = pagination.extend({ status: z.enum(PAYMENT_STATUSES).optional() }).strict();

export const adminListQuery = pagination
  .extend({
    status: z.enum([...PAYMENT_STATUSES, 'all'] as const).default('pending'),
    method: z.enum(PAYMENT_METHODS).optional(),
    payment_account_id: uuid.optional(),
    q: z.string().trim().min(2).max(60).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict();

export const approveBody = z.object({}).strict();

export const rejectBody = z.object({ reason: z.string().trim().min(5).max(300) }).strict();

export type SubmitPaymentBody = z.infer<typeof submitPaymentBody>;
export type StudentListQuery = z.infer<typeof studentListQuery>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
export type RejectBody = z.infer<typeof rejectBody>;
