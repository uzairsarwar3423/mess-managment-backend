import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

let dbClient: SupabaseClient | null = null;

/**
 * Service-role client: bypasses RLS. Used ONLY by repositories. Lazily created so
 * unit tests that never touch the database do not need real credentials.
 */
export function getDb(): SupabaseClient {
  if (!dbClient) {
    dbClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
  }
  return dbClient;
}

/**
 * A fresh anon-key client per auth operation (sign-in, OTP, refresh) so sessions are
 * never shared between users. The anon key never leaves the backend.
 */
export function createAuthClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, clientOptions);
}
