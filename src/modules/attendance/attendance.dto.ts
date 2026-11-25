import type { AttendanceRow, AttendanceWithRelations } from './attendance.repository';

/** docs/api-documentation.md "AttendanceDto". */
export function toAttendanceDto(a: AttendanceRow) {
  return {
    id: a.id,
    meal_type: a.meal_type,
    attendance_date: a.attendance_date,
    marked_at: a.marked_at,
    source: a.source,
  };
}

/** Row of the admin daily list. */
export function toDailyRecord(a: AttendanceWithRelations) {
  return {
    id: a.id,
    student: a.student
      ? { id: a.student.id, student_code: a.student.student_code, full_name: a.student.full_name }
      : null,
    marked_at: a.marked_at,
    source: a.source,
    qr_label: a.qr?.label ?? null,
    scan_distance_m: a.scan_distance_m,
  };
}
