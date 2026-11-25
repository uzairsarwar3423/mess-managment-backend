import type { StudentRow } from './students.repository';

/** API shape of a student (docs/api-documentation.md "StudentDto"). Internal columns never leak. */
export function toStudentDto(row: StudentRow) {
  return {
    id: row.id,
    student_code: row.student_code,
    email: row.email,
    full_name: row.full_name,
    phone: row.phone,
    roll_number: row.roll_number,
    profile_image_url: row.profile_image_url,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}
