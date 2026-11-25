import cron from 'node-cron';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { refreshStatuses, sendExpiryReminders } from '../modules/subscriptions/subscriptions.jobs';

/**
 * Cron jobs (docs/backend-architecture.md section 12). They run in-process on the SINGLE production
 * instance (D-17); set ENABLE_JOBS=false on any other process. Schedules use APP_TIMEZONE (the one mess
 * of v1); the date logic inside each job uses the mess's own time zone.
 */
const SCHEDULES = {
  refreshStatuses: '5 0 * * *', // 00:05 every day
  expiryReminders: '0 9 * * *', // 09:00 every day
} as const;

type Task = () => Promise<unknown>;

/** Runs a job without ever throwing and without overlapping itself. */
export function guarded(name: string, task: Task): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      logger.warn({ job: name }, 'previous run still in progress, skipping');
      return;
    }
    running = true;
    try {
      await task();
    } catch (err) {
      logger.error({ job: name, err }, 'job failed');
    } finally {
      running = false;
    }
  };
}

export interface JobsHandle {
  stop: () => void;
}

export function startJobs(): JobsHandle {
  const refresh = guarded('refreshSubscriptionStatuses', refreshStatuses);
  const reminders = guarded('sendExpiryReminders', sendExpiryReminders);

  const tasks = [
    cron.schedule(SCHEDULES.refreshStatuses, () => void refresh(), { timezone: env.APP_TIMEZONE }),
    cron.schedule(SCHEDULES.expiryReminders, () => void reminders(), { timezone: env.APP_TIMEZONE }),
  ];

  // Catch up after a restart or downtime (statuses only; reminders are de-duplicated but wait for 09:00).
  void refresh();

  logger.info({ timezone: env.APP_TIMEZONE, schedules: SCHEDULES }, 'cron jobs started');
  return { stop: () => tasks.forEach((t) => void t.stop()) };
}
