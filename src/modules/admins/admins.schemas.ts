import { z } from 'zod';
import { ADMIN_ROLES } from '../../config/constants';
import { email, fullName, isoDate, pagination, password, uuid } from '../../common/schemas';

export const phoneOptional = z.string().trim().min(5).max(20);

export const createAdminBody = z
  .object({
    full_name: fullName,
    email,
    phone: phoneOptional.optional(),
    role: z.enum(ADMIN_ROLES),
    temporary_password: password,
  })
  .strict();

export const updateAdminBody = z
  .object({ role: z.enum(ADMIN_ROLES), is_active: z.boolean(), full_name: fullName, phone: phoneOptional.nullable() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to change' });

export const listAdminsQuery = pagination.strict();

export const auditQuery = pagination
  .extend({
    action: z.string().trim().min(3).max(60).optional(),
    entity_type: z.string().trim().min(2).max(40).optional(),
    entity_id: uuid.optional(),
    actor_id: uuid.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict();

export type CreateAdminBody = z.infer<typeof createAdminBody>;
export type UpdateAdminBody = z.infer<typeof updateAdminBody>;
export type AuditQuery = z.infer<typeof auditQuery>;
