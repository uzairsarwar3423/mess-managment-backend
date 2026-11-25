import type { AttendanceRow, AttendanceWithRelations } from './attendance.repository';

/**
 * The number printed on the student's receipt: date + the first 6 characters of the attendance id, e.g.
 * MR-20261126-3F9A2C. It is derived (nothing extra is stored), and the admin's daily list shows the same number,
 * so staff can match a receipt shown on a phone to the record.
 */
export function receiptNumber(a: Pick<AttendanceRow, 'id' | 'attendance_date'>): string {
  return `MR-${a.attendance_date.replace(/-/g, '')}-${a.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/** docs/api-documentation.md "AttendanceDto". `qr_label` = which table code was scanned (null for manual entries). */
export function toAttendanceDto(a: AttendanceRow & { qr?: { label: string } | null }) {
  return {
    id: a.id,
    meal_type: a.meal_type,
    attendance_date: a.attendance_date,
    marked_at: a.marked_at,
    source: a.source,
    receipt_no: receiptNumber(a),
    qr_label: a.qr?.label ?? null,
  };
}

/** Row of the admin daily list. */
export function toDailyRecord(a: AttendanceWithRelations) {
  return {
    id: a.id,
    receipt_no: receiptNumber(a),
    student: a.student
      ? { id: a.student.id, student_code: a.student.student_code, full_name: a.student.full_name }
      : null,
    marked_at: a.marked_at,
    source: a.source,
    qr_label: a.qr?.label ?? null,
    scan_distance_m: a.scan_distance_m,
  };
}
