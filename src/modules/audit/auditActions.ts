/** Audit action names: `entity.verb`. Add new actions here only. */
export const AUDIT_ACTIONS = {
  PAYMENT_APPROVE: 'payment.approve',
  PAYMENT_REJECT: 'payment.reject',
  SUBSCRIPTION_CANCEL: 'subscription.cancel',
  QR_CREATE: 'qr.create',
  QR_REVOKE: 'qr.revoke',
  STUDENT_ACTIVATE: 'student.activate',
  STUDENT_DEACTIVATE: 'student.deactivate',
  ATTENDANCE_MANUAL: 'attendance.manual',
  SETTINGS_UPDATE: 'settings.update',
  PAYMENT_ACCOUNT_CREATE: 'payment_account.create',
  PAYMENT_ACCOUNT_UPDATE: 'payment_account.update',
  ADMIN_CREATE: 'admin.create',
  ADMIN_UPDATE: 'admin.update',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  REPORT_DOWNLOAD: 'report.download',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
