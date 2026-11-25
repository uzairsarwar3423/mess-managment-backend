import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';

export interface StudentRow {
  id: string;
  mess_id: string;
  student_code: string;
  email: string;
  full_name: string;
  phone: string | null;
  roll_number: string | null;
  profile_image_url: string | null;
  /** Internal (used to replace/delete the Cloudinary asset); never exposed by the DTO. */
  profile_image_public_id?: string | null;
  is_active: boolean;
  created_at: string;
}

const COLUMNS =
  'id, mess_id, student_code, email, full_name, phone, roll_number, profile_image_url, profile_image_public_id, is_active, created_at';
const asRow = (d: unknown): StudentRow => d as StudentRow;

export interface NewStudent {
  id: string;
  mess_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  roll_number: string | null;
}

export async function findById(id: string): Promise<StudentRow | null> {
  const { data, error } = await getDb().from('students').select(COLUMNS).eq('id', id).maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

/** Lookup scoped to a mess (admin screens): another mess's student is simply not found. */
export async function findInMess(id: string, messId: string): Promise<StudentRow | null> {
  const { data, error } = await getDb()
    .from('students')
    .select(COLUMNS)
    .eq('id', id)
    .eq('mess_id', messId)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

/** The unique constraints (`students_email_key`, primary key) surface as mapped AppErrors. */
export async function insert(student: NewStudent): Promise<StudentRow> {
  const { data, error } = await getDb().from('students').insert(student).select(COLUMNS).single();
  throwIfError(error);
  return asRow(data);
}

export type ProfilePatch = Partial<Pick<StudentRow, 'full_name' | 'phone' | 'roll_number'>>;

export async function updateProfile(id: string, patch: ProfilePatch): Promise<StudentRow | null> {
  const { data, error } = await getDb().from('students').update(patch).eq('id', id).select(COLUMNS).maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

export async function setProfileImage(
  id: string,
  image: { url: string; publicId: string } | null,
): Promise<StudentRow | null> {
  const { data, error } = await getDb()
    .from('students')
    .update({ profile_image_url: image?.url ?? null, profile_image_public_id: image?.publicId ?? null })
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

export async function setActive(id: string, messId: string, isActive: boolean): Promise<StudentRow | null> {
  const { data, error } = await getDb()
    .from('students')
    .update({ is_active: isActive })
    .eq('id', id)
    .eq('mess_id', messId)
    .select(COLUMNS)
    .maybeSingle();
  throwIfError(error);
  return data ? asRow(data) : null;
}

/** Ids of students in a mess whose name, code or email contains `text` (used by admin search). */
export async function searchIds(messId: string, text: string): Promise<string[]> {
  const safe = text.replace(/[^A-Za-z0-9 @._-]/g, '').trim();
  if (safe.length < 2) return [];
  const { data, error } = await getDb()
    .from('students')
    .select('id')
    .eq('mess_id', messId)
    .or(`full_name.ilike.*${safe}*,student_code.ilike.*${safe}*,email.ilike.*${safe}*`)
    .limit(200);
  throwIfError(error);
  return ((data as { id: string }[] | null) ?? []).map((r) => r.id);
}

export interface AdminStudentListRow {
  id: string;
  student_code: string;
  email: string;
  full_name: string;
  phone: string | null;
  roll_number: string | null;
  profile_image_url: string | null;
  is_active: boolean;
  created_at: string;
  subscription_status: 'none' | 'expired' | 'scheduled' | 'active';
  subscription_end_date: string | null;
  total_count: number | string;
}

export interface AdminStudentFilters {
  messId: string;
  today: string;
  q?: string;
  active?: boolean;
  subscription?: 'active' | 'expiring' | 'expired' | 'scheduled' | 'none';
  expiringBy: string;
  sort: 'name' | 'code' | 'created_at';
  limit: number;
  offset: number;
}

/** SQL function `admin_list_students` (search + filters + subscription state + total, one query). */
export async function listForAdmin(f: AdminStudentFilters): Promise<{ rows: AdminStudentListRow[]; total: number }> {
  const safeQ = f.q ? f.q.replace(/[^A-Za-z0-9 @._+-]/g, '').trim() : null;
  const { data, error } = await getDb().rpc('admin_list_students', {
    p_mess_id: f.messId,
    p_today: f.today,
    p_q: safeQ || null,
    p_active: f.active ?? null,
    p_sub: f.subscription ?? null,
    p_expiring_by: f.expiringBy,
    p_sort: f.sort,
    p_limit: f.limit,
    p_offset: f.offset,
  });
  throwIfError(error);
  const rows = (data as AdminStudentListRow[] | null) ?? [];
  return { rows, total: rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0 };
}
