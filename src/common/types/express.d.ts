import type { AuthContext, ValidatedRequest } from './index';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id (also returned as X-Request-Id). */
      requestId: string;
      /** Present on routes behind `authenticate`. */
      auth?: AuthContext;
      /** Output of the `validate` middleware (parsed, typed by the route's schema). */
      valid: ValidatedRequest;
    }
  }
}

export {};
