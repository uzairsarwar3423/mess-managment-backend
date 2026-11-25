import { throwIfError } from '../../common/errors/throwIfError';
import { getDb } from '../../lib/supabase';

/** Removes one device token of a user (called on logout). No-op when it does not exist. */
export async function removeForUser(userId: string, token: string): Promise<void> {
  const { error } = await getDb().from('push_tokens').delete().eq('user_id', userId).eq('token', token);
  throwIfError(error);
}

export async function listForUser(userId: string): Promise<string[]> {
  const { data, error } = await getDb().from('push_tokens').select('token').eq('user_id', userId);
  throwIfError(error);
  return ((data as { token: string }[] | null) ?? []).map((r) => r.token);
}

/** Removes tokens that Expo reported as dead. */
export async function removeTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const { error } = await getDb().from('push_tokens').delete().in('token', tokens);
  throwIfError(error);
}

/** Registers a device token for a user. A token that was registered by someone else moves to the caller. */
export async function upsert(userId: string, token: string, platform: string, seenAt: string): Promise<void> {
  const { error } = await getDb()
    .from('push_tokens')
    .upsert({ user_id: userId, token, platform, last_seen_at: seenAt }, { onConflict: 'token' });
  throwIfError(error);
}
