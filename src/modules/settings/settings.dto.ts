import type { PaymentAccountRow } from './paymentAccounts.repository';
import type { MessRow, SettingsRow } from './settings.repository';

const hm = (t: string): string => t.slice(0, 5);

/** GET /admin/settings (docs/api-documentation.md section 11). */
export function toSettingsDto(mess: MessRow, s: SettingsRow) {
  return {
    mess: { id: mess.id, name: mess.name, timezone: mess.timezone },
    monthly_fee: Number(s.monthly_fee).toFixed(2),
    currency: s.currency,
    subscription_days: s.subscription_days,
    meal_windows: {
      lunch: { start: hm(s.lunch_start), end: hm(s.lunch_end) },
      dinner: { start: hm(s.dinner_start), end: hm(s.dinner_end) },
    },
    expiry_reminder_days: s.expiry_reminder_days,
    payment_instructions: s.payment_instructions,
    geofence: {
      enabled: s.geofence_enabled,
      latitude: s.latitude,
      longitude: s.longitude,
      radius_m: s.geofence_radius_m,
    },
    updated_at: s.updated_at,
  };
}

/** What a student sees: no internal ordering/active flags. */
export function toStudentAccountDto(a: PaymentAccountRow) {
  return {
    id: a.id,
    method: a.method,
    account_title: a.account_title,
    account_number: a.account_number,
    bank_name: a.bank_name,
    merchant_name: a.merchant_name,
    instructions: a.instructions,
  };
}

export function toAdminAccountDto(a: PaymentAccountRow) {
  return { ...toStudentAccountDto(a), display_order: a.display_order, is_active: a.is_active };
}
