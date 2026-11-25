// Single definition of enums. Mirrors the CHECK constraints in database/migrations/0002_core_tables.sql.

export const ROLES = ['student', 'admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

export const ADMIN_ROLES = ['admin', 'super_admin'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const MEAL_TYPES = ['lunch', 'dinner'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const PAYMENT_METHODS = ['easypaisa', 'jazzcash', 'nayapay', 'sadapay', 'bank'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ['scheduled', 'active', 'expired', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const QR_STATUSES = ['active', 'revoked'] as const;
export type QrStatus = (typeof QR_STATUSES)[number];

export const ATTENDANCE_SOURCES = ['qr', 'manual'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

/** Prefix printed in front of every QR token so scanners can ignore unrelated QR codes. */
export const QR_PREFIX = 'MQ1:';

/** Geofence tuning (see docs/qr-code-system.md section 7). */
export const GEOFENCE = {
  /** Reject fixes less accurate than this (metres). */
  MAX_ACCURACY_M: 150,
  /** At most this much of the reported accuracy is subtracted from the measured distance. */
  MAX_ACCURACY_CREDIT_M: 100,
} as const;
