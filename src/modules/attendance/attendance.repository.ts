import type { AttendanceSource, MealType } from '../../config/constants';
import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';

export interface AttendanceRow {
  id: string;
  mess_id: string;
  student_id: string;
  subscription_id: string;
  qr_code_id: string | null;
  meal_type: MealType;
  attendance_date: string;
  marked_at: string;
  source: AttendanceSource;
  marked_by: string | null;
  scan_distance_m: number | null;
}

export interface AttendanceWithRelations extends AttendanceRow {
  student?: { id: string; student_code: string; full_name: string } | null;
  qr?: { label: string } | null;
}

const COLUMNS =
  'id, mess_id, student_id, subscription_id, qr_code_id, meal_type, attendance_date, marked_at, source, marked_by, scan_distance_m';
const WITH_QR = `${COLUMNS}, qr:qr_codes(label)`;
const WITH_RELATIONS = `${COLUMNS}, student:students(id, student_code, full_name), qr:qr_codes(label)`;

export interface NewAttendance {
  mess_id: string;
  student_id: string;
  subscription_id: string;
  qr_code_id: string | null;
  meal_type: MealType;
  attendance_date: string;
  source: AttendanceSource;
  marked_by: string | null;
  scan_distance_m: number | null;
}

/**
 * `uq_attendance_student_date_meal` (BR-03/06) is the real duplicate guard: a violation surfaces as
 * ALREADY_MARKED. `marked_at` is set by the database clock (BR-07).
 */
export async function insert(row: NewAttendance): Promise<AttendanceRow> {
  const { data, error } = await getDb().from('attendance').insert(row).select(COLUMNS).single();
  throwIfError(error);
  return data as unknown as AttendanceRow;
}

export async function findOne(studentId: string, date: string, meal: MealType): Promise<AttendanceRow | null> {
  const { data, error } = await getDb()
    .from('attendance')
    .select(COLUMNS)
    .eq('student_id', studentId)
    .eq('attendance_date', date)
    .eq('meal_type', meal)
    .maybeSingle();
  throwIfError(error);
  return (data as unknown as AttendanceRow | null) ?? null;
}

/** All of a student's rows between two dates (inclusive). A month has at most 62 rows. */
export async function listForStudentRange(studentId: string, from: string, to: string): Promise<AttendanceRow[]> {
  const { data, error } = await getDb()
    .from('attendance')
    .select(COLUMNS)
    .eq('student_id', studentId)
    .gte('attendance_date', from)
    .lte('attendance_date', to)
    .order('attendance_date', { ascending: true });
  throwIfError(error);
  return (data as unknown as AttendanceRow[] | null) ?? [];
}

export async function history(
  studentId: string,
  from: string,
  to: string,
  meal: MealType | undefined,
  rangeFrom: number,
  rangeTo: number,
): Promise<{ rows: (AttendanceRow & { qr?: { label: string } | null })[]; total: number }> {
  let query = getDb()
    .from('attendance')
    .select(WITH_QR, { count: 'exact' })
    .eq('student_id', studentId)
    .gte('attendance_date', from)
    .lte('attendance_date', to);
  if (meal) query = query.eq('meal_type', meal);
  const { data, error, count } = await query
    .order('attendance_date', { ascending: false })
    .order('marked_at', { ascending: false })
    .range(rangeFrom, rangeTo);
  throwIfError(error);
  return { rows: (data as unknown as (AttendanceRow & { qr?: { label: string } | null })[] | null) ?? [], total: count ?? 0 };
}

/** Everyone who marked a meal on a date (admin daily list). Bounded by the number of students. */
export async function daily(messId: string, date: string, meal: MealType): Promise<AttendanceWithRelations[]> {
  const { data, error } = await getDb()
    .from('attendance')
    .select(WITH_RELATIONS)
    .eq('mess_id', messId)
    .eq('attendance_date', date)
    .eq('meal_type', meal)
    .order('marked_at', { ascending: false })
    .limit(1000);
  throwIfError(error);
  return (data as unknown as AttendanceWithRelations[] | null) ?? [];
}

export interface EligibleStatus {
  student_id: string;
  student_code: string;
  full_name: string;
  marked: boolean;
}

export async function eligibleStatus(messId: string, date: string, meal: MealType): Promise<EligibleStatus[]> {
  const { data, error } = await getDb().rpc('eligible_attendance_status', {
    p_mess_id: messId,
    p_date: date,
    p_meal: meal,
  });
  throwIfError(error);
  return (data as EligibleStatus[] | null) ?? [];
}

export interface MonthlyRow {
  student_id: string;
  student_code: string;
  full_name: string;
  lunch_count: number;
  dinner_count: number;
  total_count: number;
  marks: Record<string, string>;
}

export async function monthly(messId: string, firstDayOfMonth: string): Promise<MonthlyRow[]> {
  const { data, error } = await getDb().rpc('monthly_attendance_marks', {
    p_mess_id: messId,
    p_month: firstDayOfMonth,
  });
  throwIfError(error);
  return (data as MonthlyRow[] | null) ?? [];
}
