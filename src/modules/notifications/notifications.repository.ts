import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';

export type NotificationType =
  | 'payment_approved'
  | 'payment_rejected'
  | 'subscription_expiring'
  | 'subscription_expired'
  | 'general';

export interface NewNotification {
  mess_id: string;
  student_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export async function insert(notification: NewNotification): Promise<void> {
  const { error } = await getDb().from('notifications').insert(notification);
  throwIfError(error);
}

/** Has this student already been sent a notification of this type about this subscription? (job de-duplication) */
export async function existsForSubscription(
  studentId: string,
  type: NotificationType,
  subscriptionId: string,
): Promise<boolean> {
  const { data, error } = await getDb()
    .from('notifications')
    .select('id')
    .eq('student_id', studentId)
    .eq('type', type)
    .contains('data', { subscription_id: subscriptionId })
    .limit(1);
  throwIfError(error);
  return (data?.length ?? 0) > 0;
}

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export async function countUnread(studentId: string): Promise<number> {
  const { count, error } = await getDb()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('is_read', false);
  throwIfError(error);
  return count ?? 0;
}

export async function listForStudent(
  studentId: string,
  unreadOnly: boolean,
  from: number,
  to: number,
): Promise<{ rows: NotificationRow[]; total: number }> {
  let query = getDb()
    .from('notifications')
    .select('id, type, title, body, data, is_read, created_at', { count: 'exact' })
    .eq('student_id', studentId);
  if (unreadOnly) query = query.eq('is_read', false);
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to);
  throwIfError(error);
  return { rows: (data as NotificationRow[] | null) ?? [], total: count ?? 0 };
}

/** Marks one of the student's notifications read. Returns false when it does not exist / is not theirs. */
export async function markRead(id: string, studentId: string, readAt: string): Promise<boolean> {
  const { data, error } = await getDb()
    .from('notifications')
    .update({ is_read: true, read_at: readAt })
    .eq('id', id)
    .eq('student_id', studentId)
    .select('id');
  throwIfError(error);
  return (data?.length ?? 0) > 0;
}

export async function markAllRead(studentId: string, readAt: string): Promise<number> {
  const { data, error } = await getDb()
    .from('notifications')
    .update({ is_read: true, read_at: readAt })
    .eq('student_id', studentId)
    .eq('is_read', false)
    .select('id');
  throwIfError(error);
  return data?.length ?? 0;
}
