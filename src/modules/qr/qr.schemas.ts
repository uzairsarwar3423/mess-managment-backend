import { z } from 'zod';
import { QR_STATUSES } from '../../config/constants';
import { pagination } from '../../common/schemas';

export const listQrQuery = pagination
  .extend({ status: z.enum([...QR_STATUSES, 'all'] as const).default('active') })
  .strict();

export const createQrBody = z.object({ label: z.string().trim().min(2).max(60) }).strict();

export const revokeQrBody = z.object({ reason: z.string().trim().min(5).max(300) }).strict();

export type ListQrQuery = z.infer<typeof listQrQuery>;
export type CreateQrBody = z.infer<typeof createQrBody>;
export type RevokeQrBody = z.infer<typeof revokeQrBody>;
