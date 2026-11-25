import { AppError } from '../../common/errors/AppError';
import type { AuthContext, RequestMeta } from '../../common/types';
import { logger } from '../../lib/logger';
import type { Coordinates } from '../../lib/geo';
import * as auditService from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/auditActions';
import * as paymentsRepository from '../payments/payments.repository';
import * as accountsRepository from './paymentAccounts.repository';
import * as repository from './settings.repository';
import type { MessRow, SettingsRow } from './settings.repository';
import { toSettingsDto, toStudentAccountDto } from './settings.dto';
import {
  applySettingsPatch,
  assertValidSettings,
  diffValues,
  toDbPatch,
  toEditable,
} from './settings.logic';
import type { UpdateSettingsBody } from './settings.schemas';
import type { MealWindows } from './time';

/** Everything other modules need to know about the mess, in convenient types. */
export interface MessConfig {
  mess: MessRow;
  settings: SettingsRow;
  timezone: string;
  monthlyFee: number;
  currency: string;
  subscriptionDays: number;
  expiryReminderDays: number;
  windows: MealWindows;
  geofence: { enabled: boolean; center: Coordinates | null; radiusM: number };
}

/** Loads mess + settings. A missing row means the seed script was not run. */
export async function loadMessConfig(messId: string): Promise<MessConfig> {
  const [mess, settings] = await Promise.all([repository.findMess(messId), repository.findSettings(messId)]);
  if (!mess || !settings) {
    logger.error({ mess_id: messId }, 'mess or mess_settings row missing: run database/seed/0007_seed_default_mess.sql');
    throw new AppError('INTERNAL_ERROR');
  }
  return {
    mess,
    settings,
    timezone: mess.timezone,
    monthlyFee: Number(settings.monthly_fee),
    currency: settings.currency,
    subscriptionDays: settings.subscription_days,
    expiryReminderDays: settings.expiry_reminder_days,
    windows: {
      lunch: { start: settings.lunch_start, end: settings.lunch_end },
      dinner: { start: settings.dinner_start, end: settings.dinner_end },
    },
    geofence: {
      enabled: settings.geofence_enabled,
      center:
        settings.latitude !== null && settings.longitude !== null
          ? { latitude: settings.latitude, longitude: settings.longitude }
          : null,
      radiusM: settings.geofence_radius_m,
    },
  };
}

export async function getSettings(auth: AuthContext) {
  const { mess, settings } = await loadMessConfig(auth.messId);
  return toSettingsDto(mess, settings);
}

/** Super admin only (enforced by the route). Cross-field rules are checked on the merged result. */
export async function updateSettings(auth: AuthContext, body: UpdateSettingsBody, meta: RequestMeta) {
  const { mess, settings } = await loadMessConfig(auth.messId);

  const current = toEditable(settings);
  const next = applySettingsPatch(current, body);
  assertValidSettings(next);

  const dbPatch = toDbPatch(current, next);
  if (Object.keys(dbPatch).length === 0) return toSettingsDto(mess, settings); // nothing actually changed

  const updated = await repository.updateSettings(auth.messId, dbPatch, auth.userId);
  if (!updated) throw new AppError('INTERNAL_ERROR');

  const { before, after } = diffValues(current, next);
  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.SETTINGS_UPDATE,
    entityType: 'settings',
    entityId: auth.messId,
    metadata: { before, after },
    meta,
  });

  return toSettingsDto(mess, updated);
}

/** GET /student/payment-instructions: fee, active accounts (plain text) and the pending flag. */
export async function getPaymentInstructions(auth: AuthContext) {
  const [config, accounts, hasPending] = await Promise.all([
    loadMessConfig(auth.messId),
    accountsRepository.list(auth.messId, false),
    paymentsRepository.hasPendingPayment(auth.userId),
  ]);
  return {
    monthly_fee: config.monthlyFee.toFixed(2),
    currency: config.currency,
    subscription_days: config.subscriptionDays,
    accounts: accounts.map(toStudentAccountDto),
    instructions: config.settings.payment_instructions,
    has_pending_payment: hasPending,
  };
}
