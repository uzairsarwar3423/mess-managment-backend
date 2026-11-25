import { AppError } from '../../common/errors/AppError';
import type { PaymentAccountPatch, PaymentAccountRow } from './paymentAccounts.repository';
import type { SettingsPatch, SettingsRow } from './settings.repository';
import type { UpdateAccountBody, UpdateSettingsBody } from './settings.schemas';

/** Pure functions (no I/O) so the rules are easy to unit test. */

/** The editable settings in API-friendly form: times as "HH:mm", fee as a 2-decimal string. */
export interface EditableSettings {
  monthly_fee: string;
  subscription_days: number;
  lunch_start: string;
  lunch_end: string;
  dinner_start: string;
  dinner_end: string;
  expiry_reminder_days: number;
  payment_instructions: string | null;
  geofence_enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
}

const hm = (t: string): string => t.slice(0, 5);

export function toEditable(row: SettingsRow): EditableSettings {
  return {
    monthly_fee: Number(row.monthly_fee).toFixed(2),
    subscription_days: row.subscription_days,
    lunch_start: hm(row.lunch_start),
    lunch_end: hm(row.lunch_end),
    dinner_start: hm(row.dinner_start),
    dinner_end: hm(row.dinner_end),
    expiry_reminder_days: row.expiry_reminder_days,
    payment_instructions: row.payment_instructions,
    geofence_enabled: row.geofence_enabled,
    latitude: row.latitude,
    longitude: row.longitude,
    geofence_radius_m: row.geofence_radius_m,
  };
}

/** Applies a validated API patch on top of the current settings. */
export function applySettingsPatch(current: EditableSettings, body: UpdateSettingsBody): EditableSettings {
  const next: EditableSettings = { ...current };
  if (body.monthly_fee !== undefined) next.monthly_fee = Number(body.monthly_fee).toFixed(2);
  if (body.subscription_days !== undefined) next.subscription_days = body.subscription_days;
  if (body.meal_windows?.lunch) {
    next.lunch_start = body.meal_windows.lunch.start;
    next.lunch_end = body.meal_windows.lunch.end;
  }
  if (body.meal_windows?.dinner) {
    next.dinner_start = body.meal_windows.dinner.start;
    next.dinner_end = body.meal_windows.dinner.end;
  }
  if (body.expiry_reminder_days !== undefined) next.expiry_reminder_days = body.expiry_reminder_days;
  if (body.payment_instructions !== undefined) {
    next.payment_instructions = body.payment_instructions === '' ? null : body.payment_instructions;
  }
  if (body.geofence) {
    if (body.geofence.enabled !== undefined) next.geofence_enabled = body.geofence.enabled;
    if (body.geofence.latitude !== undefined) next.latitude = body.geofence.latitude;
    if (body.geofence.longitude !== undefined) next.longitude = body.geofence.longitude;
    if (body.geofence.radius_m !== undefined) next.geofence_radius_m = body.geofence.radius_m;
  }
  return next;
}

/** Cross-field rules (the database CHECK constraints are the backstop). */
export function assertValidSettings(s: EditableSettings): void {
  const fail = (message: string): never => {
    throw new AppError('VALIDATION_ERROR', message);
  };
  if (s.lunch_end <= s.lunch_start) fail('Lunch must end after it starts.');
  if (s.dinner_end <= s.dinner_start) fail('Dinner must end after it starts.');
  if (s.lunch_end > s.dinner_start) fail('Dinner cannot start before Lunch ends.');
  if (s.geofence_enabled && (s.latitude === null || s.longitude === null)) {
    fail('Set the mess location (latitude and longitude) before enabling the geofence.');
  }
}

/** Columns to write, only for values that actually changed. */
export function toDbPatch(current: EditableSettings, next: EditableSettings): SettingsPatch {
  const patch: Record<string, unknown> = {};
  (Object.keys(next) as (keyof EditableSettings)[]).forEach((key) => {
    if (next[key] !== current[key]) patch[key] = next[key];
  });
  return patch as SettingsPatch;
}

/** before/after of the changed keys, for the audit log. */
export function diffValues<T extends object>(
  before: T,
  after: T,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  (Object.keys(after) as (keyof T)[]).forEach((key) => {
    if (after[key] !== before[key]) {
      b[key as string] = before[key];
      a[key as string] = after[key];
    }
  });
  return { before: b, after: a };
}

// ---------------------------------------------------------------- payment accounts

export type AccountFields = Pick<
  PaymentAccountRow,
  'method' | 'account_title' | 'account_number' | 'bank_name' | 'merchant_name' | 'instructions' | 'display_order' | 'is_active'
>;

export function toAccountFields(row: PaymentAccountRow): AccountFields {
  return {
    method: row.method,
    account_title: row.account_title,
    account_number: row.account_number,
    bank_name: row.bank_name,
    merchant_name: row.merchant_name,
    instructions: row.instructions,
    display_order: row.display_order,
    is_active: row.is_active,
  };
}

/** A bank account must name its bank (mirrors ck_payment_accounts_bank). */
export function assertValidAccount(a: Pick<AccountFields, 'method' | 'bank_name'>): void {
  if (a.method === 'bank' && !a.bank_name) {
    throw new AppError('VALIDATION_ERROR', 'Bank name is required for bank accounts.');
  }
}

export function applyAccountPatch(current: AccountFields, body: UpdateAccountBody): AccountFields {
  return { ...current, ...body } as AccountFields;
}

export function toAccountDbPatch(current: AccountFields, next: AccountFields): PaymentAccountPatch {
  const patch: Record<string, unknown> = {};
  (Object.keys(next) as (keyof AccountFields)[]).forEach((key) => {
    if (next[key] !== current[key]) patch[key] = next[key];
  });
  return patch as PaymentAccountPatch;
}
