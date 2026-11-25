import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../common/errors/AppError';
import { createAuthClient } from '../../lib/supabase';

export interface VerifiedToken {
  /** auth.users.id */
  sub: string;
  email: string;
}

let verifierClient: SupabaseClient | null = null;

/** One long-lived client: it caches the project's JWKS so verification is local (no network per request). */
function getVerifier(): SupabaseClient {
  if (!verifierClient) verifierClient = createAuthClient();
  return verifierClient;
}

/**
 * Verifies a Supabase access token (signature via JWKS, expiry) and returns the identity.
 * Roles are NOT read from the token: the caller resolves them from the students/admins tables.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedToken> {
  // Cheap shape check first: three base64url segments, sane length. Anything else is not a JWT.
  if (token.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]*$/.test(token)) throw new AppError('UNAUTHORIZED');

  let result: Awaited<ReturnType<SupabaseClient['auth']['getClaims']>>;
  try {
    result = await getVerifier().auth.getClaims(token);
  } catch {
    // The library throws (instead of returning an error) for undecodable tokens.
    throw new AppError('UNAUTHORIZED');
  }
  const { data, error } = result;

  if (error || !data) {
    const msg = error?.message ?? '';
    if (/expired/i.test(msg)) throw new AppError('TOKEN_EXPIRED');
    if (error?.name === 'AuthRetryableFetchError') throw new AppError('SERVICE_UNAVAILABLE');
    throw new AppError('UNAUTHORIZED');
  }

  const claims = data.claims as { sub?: unknown; email?: unknown; aud?: unknown; role?: unknown };
  // Anonymous/service tokens have no `sub`; only end-user tokens are accepted.
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) throw new AppError('UNAUTHORIZED');
  if (claims.aud !== 'authenticated' || claims.role !== 'authenticated') throw new AppError('UNAUTHORIZED');

  return { sub: claims.sub, email: typeof claims.email === 'string' ? claims.email : '' };
}
