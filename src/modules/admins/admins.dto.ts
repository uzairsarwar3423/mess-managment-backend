import type { AdminRow } from './admins.repository';

export function toAdminDto(row: AdminRow) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    phone: row.phone,
    role: row.role,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}
