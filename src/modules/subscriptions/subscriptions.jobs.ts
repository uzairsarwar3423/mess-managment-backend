import { now } from '../../lib/clock';
import { logger } from '../../lib/logger';
import * as notificationsRepository from '../notifications/notifications.repository';
import * as notifications from '../notifications/notifications.service';
import { templates } from '../notifications/templates';
import { loadMessConfig } from '../settings/settings.service';
import * as settingsRepository from '../settings/settings.repository';
import { addDays, businessDate } from '../settings/time';
import * as repository from './subscriptions.repository';

/**
 * Nightly status refresh: scheduled -> active, active -> expired (docs/payment-workflow.md section 6).
 * NOT correctness-critical: attendance and the API judge validity by DATE, so a missed run only delays
 * the stored `status` column and reports that read it.
 */
export async function refreshStatuses(): Promise<number> {
  const changed = await repository.refreshStatuses();
  logger.info({ job: 'refreshSubscriptionStatuses', changed }, 'subscription statuses refreshed');
  return changed;
}

export interface ReminderResult {
  expiring: number;
  expired: number;
}

/**
 * Daily reminders for every active mess:
 *  - "expiring": subscriptions whose days_remaining equals `expiry_reminder_days` today (the same moment the
 *    app starts showing "expiring soon"), unless a renewal is already queued behind them;
 *  - "expired": subscriptions that ended yesterday and have no renewal.
 * Each (student, type, subscription) is notified at most once, so restarts and re-runs are harmless.
 */
export async function sendExpiryReminders(): Promise<ReminderResult> {
  const result: ReminderResult = { expiring: 0, expired: 0 };
  for (const messId of await settingsRepository.listActiveMessIds()) {
    const one = await remindMess(messId);
    result.expiring += one.expiring;
    result.expired += one.expired;
  }
  logger.info({ job: 'sendExpiryReminders', ...result }, 'expiry reminders sent');
  return result;
}

async function remindMess(messId: string): Promise<ReminderResult> {
  const config = await loadMessConfig(messId);
  const today = businessDate(now(), config.timezone);
  const result: ReminderResult = { expiring: 0, expired: 0 };

  // days_remaining counts today, so "N days left" means the last day is today + N - 1.
  if (config.expiryReminderDays >= 1) {
    const lastDay = addDays(today, config.expiryReminderDays - 1);
    for (const sub of await repository.findEndingOn(messId, lastDay)) {
      if (sub.start_date > today) continue; // a scheduled period that has not started is not "expiring"
      if (await shouldNotify(sub, 'subscription_expiring')) {
        await notifications.notifyStudent({
          messId,
          studentId: sub.student_id,
          type: 'subscription_expiring',
          ...templates.subscriptionExpiring(sub.end_date, config.expiryReminderDays),
          data: { subscription_id: sub.id },
        });
        result.expiring++;
      }
    }
  }

  for (const sub of await repository.findEndingOn(messId, addDays(today, -1))) {
    if (await shouldNotify(sub, 'subscription_expired')) {
      await notifications.notifyStudent({
        messId,
        studentId: sub.student_id,
        type: 'subscription_expired',
        ...templates.subscriptionExpired(sub.end_date),
        data: { subscription_id: sub.id },
      });
      result.expired++;
    }
  }
  return result;
}

async function shouldNotify(
  sub: { id: string; student_id: string; end_date: string; student: { is_active: boolean } | null },
  type: 'subscription_expiring' | 'subscription_expired',
): Promise<boolean> {
  if (!sub.student?.is_active) return false; // disabled students are not nudged
  if ((await repository.countStartingAfter(sub.student_id, sub.end_date)) > 0) return false; // already renewed
  if (await notificationsRepository.existsForSubscription(sub.student_id, type, sub.id)) return false;
  return true;
}
