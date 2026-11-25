import type { Role } from '../../config/constants';

/** Set by the `authenticate` middleware from the verified JWT + database lookup. */
export interface AuthContext {
  userId: string;
  role: Role;
  messId: string;
  email: string;
  /** Raw bearer token, kept only so services can revoke sessions. Never log it. */
  accessToken: string;
}

export interface ValidatedRequest {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
}

/** Request metadata passed to services that write audit entries. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}
