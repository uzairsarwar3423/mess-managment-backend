import type { Writable } from 'node:stream';
import { AppError } from '../../common/errors/AppError';
import type { AuthContext, RequestMeta } from '../../common/types';
import { now } from '../../lib/clock';
import {
  renderDailyAttendance,
  renderMonthlyAttendance,
  renderPayments,
  renderStudentStatement,
} from '../../lib/pdf/reportPdfs';
import type { ReportMeta } from '../../lib/pdf/pdfKit';
import * as adminsRepository from '../admins/admins.repository';
import * as attendance from '../attendance/attendance.service';
import * as auditService from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/auditActions';
import * as paymentsService from '../payments/payments.service';
import { loadMessConfig, type MessConfig } from '../settings/settings.service';
import { addDays, businessDate, monthBounds, zonedTimeToUtc } from '../settings/time';
import * as studentsRepository from '../students/students.repository';
import { effectiveStatus } from '../subscriptions/subscriptions.dto';
import * as subscriptionsRepository from '../subscriptions/subscriptions.repository';
import {
  dateLabel, dateTimeLabel, localDate, longDateLabel, methodLabel, money, monthLabel, statusLabel, timeLabel,
} from './format';
import * as repository from './reports.repository';
import type {
  DailyPdfQuery, MonthlyPdfQuery, OverviewQuery, PaymentsPdfQuery, StatementPdfQuery,
} from './reports.schemas';

// ---------------------------------------------------------------- admin dashboard

/** Admin home screen (docs/api-documentation.md section 10). */
export async function adminDashboard(auth: AuthContext) {
  const config = await loadMessConfig(auth.messId);
  const t = now();
  const date = businessDate(t, config.timezone);
  const bounds = monthBounds(date.slice(0, 7));

  const c = await repository.dashboardCounts({
    messId: auth.messId,
    date,
    monthStart: bounds.start,
    monthNext: addDays(bounds.end, 1),
    expiringBy: addDays(date, 6), // "within 7 days" = today plus the next 6
  });

  return {
    server_time: t.toISOString(),
    date,
    meals_today: { lunch: c.lunch_today, dinner: c.dinner_today },
    active_students: c.active_students,
    students_with_active_subscription: c.students_with_active_subscription,
    pending_payments: c.pending_payments,
    expiring_within_7_days: c.expiring_soon,
    revenue_this_month: Number(c.revenue_month).toFixed(2),
    active_qr_codes: c.active_qr_codes,
  };
}

// ---------------------------------------------------------------- overview analytics

/** One decimal, e.g. 119.4. */
const avg = (total: number, days: number): number => (days === 0 ? 0 : Math.round((total / days) * 10) / 10);

/**
 * Month analytics for the Reports screen. Averages are per day on which that meal was actually
 * served (a day with no attendance for the meal does not drag the average down).
 */
export async function overview(auth: AuthContext, query: OverviewQuery) {
  const config = await loadMessConfig(auth.messId);
  const month = query.month ?? businessDate(now(), config.timezone).slice(0, 7);
  const o = await repository.overview(auth.messId, monthBounds(month).start);

  const daily = o.daily ?? [];
  return {
    month: o.month,
    revenue: Number(o.revenue).toFixed(2),
    payments_approved: o.payments_approved,
    payments_rejected: o.payments_rejected,
    lunch_total: o.lunch_total,
    dinner_total: o.dinner_total,
    students_with_coverage: o.students_with_coverage,
    daily,
    avg_lunch_per_day: avg(o.lunch_total, daily.filter((d) => d.lunch > 0).length),
    avg_dinner_per_day: avg(o.dinner_total, daily.filter((d) => d.dinner > 0).length),
  };
}

// ---------------------------------------------------------------- PDFs

/** A PDF ready to stream: all data is loaded (so any error is still a normal JSON error). */
export interface PdfDocument {
  filename: string;
  render: (out: Writable) => Promise<void>;
}

async function reportMeta(auth: AuthContext, config: MessConfig): Promise<ReportMeta> {
  const admin = await adminsRepository.findById(auth.userId);
  return {
    messName: config.mess.name,
    generatedAt: dateTimeLabel(now().toISOString(), config.timezone),
    generatedBy: admin?.full_name ?? 'Admin',
  };
}

/** BR-19: every report download is attributable. A failed audit write blocks the download. */
async function audit(auth: AuthContext, report: string, params: Record<string, unknown>, meta: RequestMeta): Promise<void> {
  await auditService.record({
    messId: auth.messId,
    actorId: auth.userId,
    actorRole: auth.role,
    action: AUDIT_ACTIONS.REPORT_DOWNLOAD,
    entityType: 'report',
    metadata: { report, ...params },
    meta,
  });
}

export async function monthlyAttendancePdf(auth: AuthContext, query: MonthlyPdfQuery, meta: RequestMeta): Promise<PdfDocument> {
  const config = await loadMessConfig(auth.messId);
  const data = await attendance.monthly(auth, { month: query.month });
  await audit(auth, 'attendance-monthly', { month: query.month }, meta);

  return {
    filename: `attendance-monthly-${query.month}.pdf`,
    render: async (out) =>
      renderMonthlyAttendance(
        {
          meta: await reportMeta(auth, config),
          monthLabel: monthLabel(query.month),
          daysInMonth: data.days_in_month,
          students: data.students.map((s) => ({
            code: s.student_code, name: s.full_name, lunch: s.lunch_count, dinner: s.dinner_count, total: s.total_count, marks: s.marks,
          })),
          totals: data.totals,
        },
        out,
      ),
  };
}

export async function dailyAttendancePdf(auth: AuthContext, query: DailyPdfQuery, meta: RequestMeta): Promise<PdfDocument> {
  const config = await loadMessConfig(auth.messId);
  const date = query.date ?? businessDate(now(), config.timezone);

  const meals = await Promise.all(
    (['lunch', 'dinner'] as const).map(async (meal) => {
      const d = await attendance.daily(auth, { date, meal_type: meal, include_not_marked: query.include_not_marked });
      return {
        label: meal === 'lunch' ? 'Lunch' : 'Dinner',
        eligible: d.counts.eligible,
        // The API lists newest first; a printed sheet reads better in order of arrival.
        records: [...d.records].reverse().map((r) => ({
          time: timeLabel(r.marked_at, config.timezone),
          code: r.student?.student_code ?? '',
          name: r.student?.full_name ?? '',
          table: r.qr_label ?? (r.source === 'manual' ? 'manual entry' : ''),
        })),
        notMarked: 'not_marked' in d && d.not_marked
          ? d.not_marked.map((s) => ({ code: s.student_code, name: s.full_name }))
          : undefined,
      };
    }),
  );
  await audit(auth, 'attendance-daily', { date, include_not_marked: query.include_not_marked }, meta);

  return {
    filename: `attendance-daily-${date}.pdf`,
    render: async (out) =>
      renderDailyAttendance({ meta: await reportMeta(auth, config), dateLabel: longDateLabel(date), meals }, out),
  };
}

export async function paymentsPdf(auth: AuthContext, query: PaymentsPdfQuery, meta: RequestMeta): Promise<PdfDocument> {
  const config = await loadMessConfig(auth.messId);
  const bounds = monthBounds(query.month);
  const rows = await repository.paymentsLedger({
    messId: auth.messId,
    status: query.status,
    fromIso: zonedTimeToUtc(bounds.start, '00:00', config.timezone).toISOString(),
    toIso: zonedTimeToUtc(addDays(bounds.end, 1), '00:00', config.timezone).toISOString(),
  });
  await audit(auth, 'payments', { month: query.month, status: query.status }, meta);

  // With status=all only approved payments count towards the money total.
  const counted = query.status === 'all' ? rows.filter((r) => r.status === 'approved') : rows;
  const total = counted.reduce((n, r) => n + Number(r.amount), 0);
  const decided = query.status === 'approved' || query.status === 'rejected';

  return {
    filename: `payments-${query.month}-${query.status}.pdf`,
    render: async (out) =>
      renderPayments(
        {
          meta: await reportMeta(auth, config),
          periodLabel: `${monthLabel(query.month)} - ${query.status === 'all' ? 'all payments (total counts approved only)' : `${query.status} payments`}`,
          rows: rows.map((r) => {
            const when = decided ? (r.reviewed_at ?? r.submitted_at) : r.submitted_at;
            return {
              date: dateLabel(localDate(when, config.timezone)),
              student: r.student ? `${r.student.student_code} ${r.student.full_name}` : '',
              method: methodLabel(r.method),
              paidTo: [r.paid_to?.account_title, r.paid_to?.account_number].filter(Boolean).join(' - '),
              transactionId: r.transaction_id ?? '-',
              amount: money(r.amount),
              status: statusLabel(r.status),
              reviewer: r.reviewer?.full_name ?? '',
            };
          }),
          totalLabel: money(total),
        },
        out,
      ),
  };
}

export async function studentStatementPdf(auth: AuthContext, query: StatementPdfQuery, meta: RequestMeta): Promise<PdfDocument> {
  const student = await studentsRepository.findInMess(query.student_id, auth.messId);
  if (!student) throw new AppError('NOT_FOUND'); // other mess / unknown id

  const config = await loadMessConfig(auth.messId);
  const today = businessDate(now(), config.timezone);
  const bounds = monthBounds(query.month);

  const [calendar, subs, payments] = await Promise.all([
    attendance.calendarFor(auth.messId, student.id, { month: query.month }),
    subscriptionsRepository.listOverlapping(student.id, bounds.start, bounds.end),
    paymentsService.listForAdmin(
      auth,
      { page: 1, limit: 100, status: 'all', from: bounds.start, to: bounds.end },
      student.id,
    ),
  ]);
  await audit(auth, 'student-statement', { month: query.month, student_id: student.id }, meta);

  const present = (mark: { marked: boolean; marked_at: string | null }): string =>
    mark.marked && mark.marked_at ? `Present ${timeLabel(mark.marked_at, config.timezone)}` : '';

  return {
    filename: `student-statement-${student.student_code}-${query.month}.pdf`,
    render: async (out) =>
      renderStudentStatement(
        {
          meta: await reportMeta(auth, config),
          monthLabel: monthLabel(query.month),
          student: { name: student.full_name, code: student.student_code, email: student.email, phone: student.phone ?? '-' },
          subscriptions: subs.map((s) => ({
            period: `${dateLabel(s.start_date)} to ${dateLabel(s.end_date)}`,
            status: statusLabel(effectiveStatus(s, today)),
            amount: money(s.amount),
          })),
          payments: payments.data.map((p) => ({
            date: dateLabel(localDate(p.submitted_at, config.timezone)),
            method: methodLabel(p.method),
            transactionId: p.transaction_id ?? '-',
            amount: money(p.amount),
            status: statusLabel(p.status),
          })),
          days: calendar.days.map((d) => {
            const past = d.covered && d.date < today;
            return {
              date: dateLabel(d.date),
              covered: d.covered ? 'Yes' : 'No',
              lunch: present(d.lunch) || (past ? 'Missed' : '-'),
              dinner: present(d.dinner) || (past ? 'Missed' : '-'),
            };
          }),
          summary: {
            lunch: calendar.summary.lunch_count,
            dinner: calendar.summary.dinner_count,
            coveredDays: calendar.summary.covered_days,
            missedMeals: calendar.summary.missed_meals,
          },
        },
        out,
      ),
  };
}
