import { AppError } from '../../common/errors/AppError';
import { buildMeta } from '../../common/http/respond';
import { toRange } from '../../common/pagination';
import type { AuthContext, RequestMeta } from '../../common/types';
import { now } from '../../lib/clock';
import * as auditService from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/auditActions';
import * as notifications from '../notifications/notifications.service';
import { templates } from '../notifications/templates';
import * as paymentAccounts from '../settings/paymentAccounts.service';
import { loadMessConfig } from '../settings/settings.service';
import { addDays, businessDate, zonedTimeToUtc } from '../settings/time';
import { toSubscriptionDto } from '../subscriptions/subscriptions.dto';
import * as uploads from '../uploads/uploads.service';
import { toAdminDetail, toAdminListItem, toStudentPaymentDto } from './payments.dto';
import * as repository from './payments.repository';
import type { PaymentRow } from './payments.repository';
import type { AdminListQuery, StudentListQuery, SubmitPaymentBody } from './payments.schemas';

// ---------------------------------------------------------------- student

/**
 * Submit a payment claim (docs/payment-workflow.md section 3.2). The amount comes from settings
 * (BR-09), the method from the chosen account, the asset is re-verified with Cloudinary.
 */
export async function submit(auth: AuthContext, body: SubmitPaymentBody) {
  // Cheapest check first: BR-08 (one pending payment).
  if (await repository.hasPendingPayment(auth.userId)) throw new AppError('PENDING_PAYMENT_EXISTS');

  const account = await paymentAccounts.findActiveAccount(auth.messId, body.payment_account_id);
  if (!account) throw new AppError('INVALID_PAYMENT_ACCOUNT');

  if (await repository.isAssetUsed(body.screenshot_public_id)) {
    throw new AppError('INVALID_UPLOAD', 'This screenshot was already used for another payment.');
  }
  const asset = await uploads.verifyAsset(auth.userId, 'payment_screenshot', body.screenshot_public_id);
  const config = await loadMessConfig(auth.messId);

  try {
    const row = await repository.insert({
      mess_id: auth.messId,
      student_id: auth.userId,
      payment_account_id: account.id,
      method: account.method,
      paid_to: {
        account_title: account.account_title,
        account_number: account.account_number,
        bank_name: account.bank_name,
        merchant_name: account.merchant_name,
      },
      amount: config.monthlyFee.toFixed(2),
      transaction_id: body.transaction_id,
      screenshot_public_id: asset.publicId,
      screenshot_url: asset.secureUrl,
      screenshot_etag: asset.etag,
      screenshot_bytes: asset.bytes,
    });
    return toStudentPaymentDto(row);
  } catch (err) {
    // Lost a race / reused transaction id: the uploaded image is now an orphan.
    if (err instanceof AppError && (err.code === 'DUPLICATE_TRANSACTION' || err.code === 'PENDING_PAYMENT_EXISTS')) {
      await uploads.deleteAsset(asset.publicId, 'authenticated');
    }
    throw err;
  }
}

export async function listMine(auth: AuthContext, query: StudentListQuery) {
  const { from, to } = toRange(query.page, query.limit);
  const { rows, total } = await repository.listForStudent(auth.userId, query.status, from, to);
  return { data: rows.map(toStudentPaymentDto), meta: buildMeta(query.page, query.limit, total) };
}

/** Another student's payment is reported as NOT_FOUND (never confirm it exists). */
export async function getMine(auth: AuthContext, id: string) {
  const row = await repository.findForStudent(id, auth.userId);
  if (!row) throw new AppError('NOT_FOUND');
  return toStudentPaymentDto(row);
}

export async function cancelMine(auth: AuthContext, id: string) {
  const cancelled = await repository.cancelPending(id, auth.userId);
  if (cancelled) return toStudentPaymentDto(cancelled);

  const existing = await repository.findForStudent(id, auth.userId);
  if (!existing) throw new AppError('NOT_FOUND');
  throw new AppError('PAYMENT_NOT_PENDING');
}

// ---------------------------------------------------------------- admin

/** Date filters are business dates in the mess time zone. */
async function dateRange(messId: string, from?: string, to?: string) {
  if (!from && !to) return {};
  const { timezone } = await loadMessConfig(messId);
  return {
    fromIso: from ? zonedTimeToUtc(from, '00:00', timezone).toISOString() : undefined,
    toIso: to ? zonedTimeToUtc(addDays(to, 1), '00:00', timezone).toISOString() : undefined,
  };
}

export async function listForAdmin(auth: AuthContext, query: AdminListQuery, studentId?: string) {
  const { from, to } = toRange(query.page, query.limit);
  const range = await dateRange(auth.messId, query.from, query.to);
  const { rows, total } = await repository.listForAdmin({
    messId: auth.messId,
    status: query.status,
    method: query.method,
    paymentAccountId: query.payment_account_id,
    q: query.q,
    studentId,
    ...range,
    from,
    to,
  });
  return { data: rows.map(toAdminListItem), meta: buildMeta(query.page, query.limit, total) };
}

async function requireForAdmin(auth: AuthContext, id: string): Promise<PaymentRow> {
  const row = await repository.findForAdmin(id, auth.messId); // scoped to the admin's mess
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}

export async function getForAdmin(auth: AuthContext, id: string) {
  const row = await requireForAdmin(auth, id);
  const duplicates = await repository.findDuplicateSignals(row);
  return toAdminDetail(row, duplicates);
}

/** Who/when already decided, so a losing admin sees "already approved by X at T". */
async function notPendingError(auth: AuthContext, id: string): Promise<AppError> {
  const current = await repository.findForAdmin(id, auth.messId);
  if (!current) return new AppError('NOT_FOUND');
  return new AppError('PAYMENT_NOT_PENDING', undefined, {
    status: current.status,
    reviewed_by: current.reviewer?.full_name ?? null,
    reviewed_at: current.reviewed_at,
  });
}

/**
 * Approve = the ONLY way a subscription is created (BR-05). The SQL function locks the payment,
 * re-checks it is pending and the admin is active, creates the subscription, and writes the audit
 * row, all in one transaction. Notification afterwards is best effort.
 */
export async function approve(auth: AuthContext, id: string) {
  const payment = await requireForAdmin(auth, id);

  let subscription;
  try {
    subscription = await repository.approve(payment.id, auth.userId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'PAYMENT_NOT_PENDING') throw await notPendingError(auth, id);
    throw err;
  }

  const [reviewed, config] = await Promise.all([repository.findForAdmin(id, auth.messId), loadMessConfig(auth.messId)]);
  const today = businessDate(now(), config.timezone);

  const text = templates.paymentApproved(subscription.end_date);
  await notifications.notifyStudent({
    messId: auth.messId,
    studentId: payment.student_id,
    type: 'payment_approved',
    ...text,
    data: { payment_id: payment.id, subscription_id: subscription.id },
  });

  return {
    payment: { id: payment.id, status: 'approved' as const, reviewed_at: reviewed?.reviewed_at ?? null },
    subscription: toSubscriptionDto(subscription, today, config.expiryReminderDays),
  };
}

export async function reject(auth: AuthContext, id: string, reason: string, meta: RequestMeta) {
  const payment = await requireForAdmin(auth, id);

  const rejected = await repository.rejectPending(id, auth.messId, auth.userId, reason, now().toISOString());
  if (!rejected) throw await notPendingError(auth, id);

  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.PAYMENT_REJECT,
    entityType: 'payment',
    entityId: id,
    metadata: { student_id: payment.student_id, reason, transaction_id: payment.transaction_id, amount: String(payment.amount) },
    meta,
  });

  await notifications.notifyStudent({
    messId: auth.messId,
    studentId: payment.student_id,
    type: 'payment_rejected',
    ...templates.paymentRejected(reason),
    data: { payment_id: id },
  });

  return { id, status: 'rejected' as const, rejection_reason: reason, reviewed_at: rejected.reviewed_at };
}
