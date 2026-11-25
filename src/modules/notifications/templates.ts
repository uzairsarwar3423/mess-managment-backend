/** Notification texts. Keep them short: they also appear on the lock screen. */

/** "2026-12-24" -> "24 Dec 2026" */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export const templates = {
  paymentApproved: (endDate: string) => ({
    title: 'Payment approved',
    body: `Your subscription is active until ${formatDate(endDate)}.`,
  }),
  subscriptionExpiring: (endDate: string, daysLeft: number) => ({
    title: 'Subscription ending soon',
    body: `Your subscription ends on ${formatDate(endDate)} (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left). Renew to keep marking attendance.`,
  }),
  subscriptionExpired: (endDate: string) => ({
    title: 'Subscription expired',
    body: `Your subscription ended on ${formatDate(endDate)}. Renew to mark attendance again.`,
  }),
  subscriptionCancelled: (reason: string) => ({
    title: 'Subscription cancelled',
    body: `Your subscription was cancelled: ${reason}`,
  }),
  paymentRejected: (reason: string) => ({
    title: 'Payment rejected',
    body: `Reason: ${reason}`,
  }),
};
