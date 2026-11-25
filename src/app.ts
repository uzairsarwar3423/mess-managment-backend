import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { AppError } from './common/errors/AppError';
import { asyncHandler } from './common/http/asyncHandler';
import { ok } from './common/http/respond';
import { errorHandler } from './common/middleware/errorHandler';
import { httpLogger } from './common/middleware/httpLogger';
import { notFoundHandler } from './common/middleware/notFound';
import { globalLimiter } from './common/middleware/rateLimit';
import { requestId } from './common/middleware/requestId';
import { getDb } from './lib/supabase';
import { apiRouter } from './routes';

export interface AppOptions {
  /** Resolves when the database is reachable; rejects otherwise. Injectable for tests. */
  readinessCheck?: () => Promise<void>;
}

async function defaultReadinessCheck(): Promise<void> {
  const { error } = await getDb().from('messes').select('id').limit(1);
  if (error) throw error;
}

/** Builds the Express app without listening (so tests can use it with supertest). */
export function createApp(options: AppOptions = {}): Express {
  const readinessCheck = options.readinessCheck ?? defaultReadinessCheck;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false }));
  app.use(httpLogger);

  // Health endpoints are unauthenticated and not rate limited (uptime monitors poll them).
  app.get('/health', (_req, res) => {
    ok(res, { status: 'ok', uptime_s: Math.round(process.uptime()) });
  });
  app.get(
    '/health/ready',
    asyncHandler(async (_req, res) => {
      try {
        await readinessCheck();
      } catch {
        throw new AppError('SERVICE_UNAVAILABLE', 'Database is not reachable.');
      }
      ok(res, { status: 'ready' });
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(globalLimiter());

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
