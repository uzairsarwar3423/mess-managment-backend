import type { Role } from '../../config/constants';
import * as adminsRepository from '../admins/admins.repository';
import type { AdminRow } from '../admins/admins.repository';
import * as studentsRepository from '../students/students.repository';
import type { StudentRow } from '../students/students.repository';

export type ResolvedProfile =
  | { role: 'student'; id: string; messId: string; email: string; isActive: boolean; row: StudentRow }
  | { role: Exclude<Role, 'student'>; id: string; messId: string; email: string; isActive: boolean; row: AdminRow };

/**
 * Role resolution: an auth user is an admin if an `admins` row exists, else a student if a
 * `students` row exists, else nothing. Both lookups are primary-key reads, run in parallel.
 * Roles come from our tables, never from client-editable token metadata.
 */
export async function resolveProfile(userId: string): Promise<ResolvedProfile | null> {
  const [admin, student] = await Promise.all([
    adminsRepository.findById(userId),
    studentsRepository.findById(userId),
  ]);

  if (admin) {
    return { role: admin.role, id: admin.id, messId: admin.mess_id, email: admin.email, isActive: admin.is_active, row: admin };
  }
  if (student) {
    return { role: 'student', id: student.id, messId: student.mess_id, email: student.email, isActive: student.is_active, row: student };
  }
  return null;
}
