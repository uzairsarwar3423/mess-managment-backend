import { z } from 'zod';
import { boolQuery, pagination } from '../../common/schemas';

export const listQuery = pagination.extend({ unread_only: boolQuery.default(false) }).strict();

export const pushTokenBody = z
  .object({
    token: z
      .string()
      .trim()
      .max(200)
      .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'Not an Expo push token'),
    platform: z.literal('android').default('android'),
  })
  .strict();

export const unregisterBody = z.object({ token: z.string().trim().min(10).max(200) }).strict();

export type ListQuery = z.infer<typeof listQuery>;
export type PushTokenBody = z.infer<typeof pushTokenBody>;
