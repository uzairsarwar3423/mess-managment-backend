import { signedImageUrl } from '../uploads/uploads.service';
import type { DuplicateHit, PaymentRow } from './payments.repository';

const money = (v: number | string): string => Number(v).toFixed(2);

function subscriptionIdOf(p: PaymentRow): string | null {
  const s = p.subscription;
  if (!s) return null;
  return Array.isArray(s) ? (s[0]?.id ?? null) : s.id;
}

/** Student view (docs/api-documentation.md "PaymentDto"). The screenshot URL is signed and does not expire. */
export function toStudentPaymentDto(p: PaymentRow) {
  return {
    id: p.id,
    amount: money(p.amount),
    method: p.method,
    transaction_id: p.transaction_id,
    paid_to: p.paid_to,
    status: p.status,
    rejection_reason: p.rejection_reason,
    submitted_at: p.submitted_at,
    reviewed_at: p.reviewed_at,
    reviewed_by_name: p.reviewer?.full_name ?? null,
    screenshot_url: signedImageUrl(p.screenshot_public_id),
    subscription_id: subscriptionIdOf(p),
  };
}

/** Row in the admin review queue. */
export function toAdminListItem(p: PaymentRow) {
  return {
    id: p.id,
    student: p.student
      ? { id: p.student.id, student_code: p.student.student_code, full_name: p.student.full_name }
      : null,
    amount: money(p.amount),
    method: p.method,
    transaction_id: p.transaction_id,
    status: p.status,
    submitted_at: p.submitted_at,
    reviewed_at: p.reviewed_at,
  };
}

const hit = (h: DuplicateHit) => ({ payment_id: h.id, status: h.status, student_name: h.student_name });

export function toAdminDetail(
  p: PaymentRow,
  duplicates: { sameTransaction: DuplicateHit[]; sameScreenshot: DuplicateHit[] },
) {
  return {
    id: p.id,
    student: p.student
      ? {
          id: p.student.id,
          student_code: p.student.student_code,
          full_name: p.student.full_name,
          phone: p.student.phone,
          email: p.student.email,
        }
      : null,
    amount: money(p.amount),
    method: p.method,
    transaction_id: p.transaction_id,
    paid_to: p.paid_to,
    status: p.status,
    screenshot_url: signedImageUrl(p.screenshot_public_id),
    submitted_at: p.submitted_at,
    reviewed_by: p.reviewer ? { id: p.reviewer.id, full_name: p.reviewer.full_name } : null,
    reviewed_at: p.reviewed_at,
    rejection_reason: p.rejection_reason,
    subscription_id: subscriptionIdOf(p),
    duplicate_signals: {
      same_transaction_id: duplicates.sameTransaction.map(hit),
      same_screenshot: duplicates.sameScreenshot.map(hit),
    },
  };
}
