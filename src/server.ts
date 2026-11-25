import { createApp } from './app';
import { env } from './config/env';
import { logConnectionStatus } from './lib/connectionChecks';
import { startJobs, type JobsHandle } from './jobs';
import { logger } from './lib/logger';

const app = createApp();
let jobs: JobsHandle | null = null;

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'mess-api listening');
  void logConnectionStatus();
  if (env.ENABLE_JOBS) jobs = startJobs();
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  jobs?.stop();
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'error while closing server');
      process.exit(1);
    }
    process.exit(0);
  });
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
