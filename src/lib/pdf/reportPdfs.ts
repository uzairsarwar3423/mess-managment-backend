import type { Writable } from 'node:stream';
import { createReport, drawTable, heading, paragraph, type Column, type ReportMeta } from './pdfKit';

/** The four report PDFs. They take plain, already-formatted data (no database, no time zones). */

// ---------------------------------------------------------------- monthly attendance (landscape)

export interface MonthlyAttendancePdf {
  meta: ReportMeta;
  monthLabel: string; // "November 2026"
  daysInMonth: number;
  students: { code: string; name: string; lunch: number; dinner: number; total: number; marks: Record<string, string> }[];
  totals: { lunch: number; dinner: number };
}

export async function renderMonthlyAttendance(data: MonthlyAttendancePdf, out: Writable): Promise<void> {
  const r = createReport({ title: 'Monthly attendance', subtitle: data.monthLabel, meta: data.meta, landscape: true, out });

  paragraph(r, `Students listed: ${data.students.length}    Total lunches: ${data.totals.lunch}    Total dinners: ${data.totals.dinner}`, { size: 10 });

  heading(r, 'Totals per student');
  drawTable(
    r,
    [
      { header: '#', width: 30, align: 'right' },
      { header: 'Code', width: 70 },
      { header: 'Name', width: 300 },
      { header: 'Lunch', width: 90, align: 'right' },
      { header: 'Dinner', width: 90, align: 'right' },
      { header: 'Total', width: 90, align: 'right' },
    ],
    data.students.map((s, i) => [String(i + 1), s.code, s.name, String(s.lunch), String(s.dinner), String(s.total)]),
    { totalsRow: ['', '', 'All students', String(data.totals.lunch), String(data.totals.dinner), String(data.totals.lunch + data.totals.dinner)], emptyText: 'No students had attendance or coverage this month.' },
  );

  // Day-by-day matrix: L = lunch, D = dinner, LD = both, - = none
  r.doc.addPage();
  heading(r, 'Day by day  (L = lunch, D = dinner, LD = both)');
  const dayWidth = Math.floor((r.width - 45 - 115 - 35) / data.daysInMonth);
  const columns: Column[] = [
    { header: 'Code', width: 45 },
    { header: 'Name', width: 115 },
    ...Array.from({ length: data.daysInMonth }, (_, i) => ({ header: String(i + 1), width: dayWidth, align: 'center' as const })),
    { header: 'Tot', width: 35, align: 'right' },
  ];
  drawTable(
    r,
    columns,
    data.students.map((s) => [
      s.code,
      s.name,
      ...Array.from({ length: data.daysInMonth }, (_, i) => s.marks[String(i + 1).padStart(2, '0')] ?? '-'),
      String(s.total),
    ]),
    { fontSize: 6.5, rowHeight: 13, emptyText: 'No data.' },
  );
  await r.finish();
}

// ---------------------------------------------------------------- daily attendance (portrait)

export interface DailyAttendancePdf {
  meta: ReportMeta;
  dateLabel: string; // "Wednesday, 25 Nov 2026"
  meals: {
    label: string; // "Lunch"
    eligible: number;
    records: { time: string; code: string; name: string; table: string }[];
    notMarked?: { code: string; name: string }[];
  }[];
}

export async function renderDailyAttendance(data: DailyAttendancePdf, out: Writable): Promise<void> {
  const r = createReport({ title: 'Daily attendance', subtitle: data.dateLabel, meta: data.meta, out });
  for (const meal of data.meals) {
    heading(r, `${meal.label}: ${meal.records.length} present of ${meal.eligible} eligible`);
    drawTable(
      r,
      [
        { header: '#', width: 30, align: 'right' },
        { header: 'Time', width: 55 },
        { header: 'Code', width: 70 },
        { header: 'Name', width: 240 },
        { header: 'QR / table', width: 120 },
      ],
      meal.records.map((x, i) => [String(i + 1), x.time, x.code, x.name, x.table]),
      { emptyText: 'Nobody marked this meal.' },
    );
    if (meal.notMarked) {
      heading(r, `${meal.label}: eligible but not marked (${meal.notMarked.length})`, 10);
      drawTable(
        r,
        [
          { header: '#', width: 30, align: 'right' },
          { header: 'Code', width: 70 },
          { header: 'Name', width: 415 },
        ],
        meal.notMarked.map((x, i) => [String(i + 1), x.code, x.name]),
        { emptyText: 'Everyone eligible has marked.' },
      );
    }
  }
  await r.finish();
}

// ---------------------------------------------------------------- payments ledger (landscape)

export interface PaymentsPdf {
  meta: ReportMeta;
  periodLabel: string; // "November 2026 - approved payments"
  rows: { date: string; student: string; method: string; paidTo: string; transactionId: string; amount: string; reviewer: string; status: string }[];
  totalLabel: string; // "Rs. 17,000"
}

export async function renderPayments(data: PaymentsPdf, out: Writable): Promise<void> {
  const r = createReport({ title: 'Payments ledger', subtitle: data.periodLabel, meta: data.meta, landscape: true, out });
  paragraph(r, `Payments listed: ${data.rows.length}    Total: ${data.totalLabel}`);
  drawTable(
    r,
    [
      { header: 'Date', width: 80 },
      { header: 'Student', width: 150 },
      { header: 'Method', width: 65 },
      { header: 'Paid to', width: 150 },
      { header: 'Transaction ID', width: 110 },
      { header: 'Amount', width: 70, align: 'right' },
      { header: 'Status', width: 55 },
      { header: 'Reviewed by', width: 82 },
    ],
    data.rows.map((x) => [x.date, x.student, x.method, x.paidTo, x.transactionId, x.amount, x.status, x.reviewer]),
    { totalsRow: ['', '', '', '', 'Total', data.totalLabel, '', ''], emptyText: 'No payments in this period.' },
  );
  await r.finish();
}

// ---------------------------------------------------------------- student statement (portrait)

export interface StudentStatementPdf {
  meta: ReportMeta;
  monthLabel: string;
  student: { name: string; code: string; email: string; phone: string };
  subscriptions: { period: string; status: string; amount: string }[];
  payments: { date: string; method: string; transactionId: string; amount: string; status: string }[];
  days: { date: string; covered: string; lunch: string; dinner: string }[];
  summary: { lunch: number; dinner: number; coveredDays: number; missedMeals: number };
}

export async function renderStudentStatement(data: StudentStatementPdf, out: Writable): Promise<void> {
  const r = createReport({ title: 'Student statement', subtitle: `${data.student.name} (${data.student.code}) - ${data.monthLabel}`, meta: data.meta, out });
  paragraph(r, `Email: ${data.student.email}    Phone: ${data.student.phone}`, { gray: true });

  heading(r, 'Subscriptions');
  drawTable(
    r,
    [{ header: 'Period', width: 260 }, { header: 'Status', width: 120 }, { header: 'Amount', width: 135, align: 'right' }],
    data.subscriptions.map((s) => [s.period, s.status, s.amount]),
    { emptyText: 'No subscription in this month.' },
  );

  heading(r, 'Payments this month');
  drawTable(
    r,
    [
      { header: 'Date', width: 90 }, { header: 'Method', width: 80 }, { header: 'Transaction ID', width: 160 },
      { header: 'Amount', width: 90, align: 'right' }, { header: 'Status', width: 95 },
    ],
    data.payments.map((p) => [p.date, p.method, p.transactionId, p.amount, p.status]),
    { emptyText: 'No payments this month.' },
  );

  heading(r, `Attendance: ${data.summary.lunch} lunches, ${data.summary.dinner} dinners, ${data.summary.missedMeals} missed meals on ${data.summary.coveredDays} covered days`);
  drawTable(
    r,
    [
      { header: 'Date', width: 110 }, { header: 'Covered', width: 80 },
      { header: 'Lunch', width: 160 }, { header: 'Dinner', width: 165 },
    ],
    data.days.map((d) => [d.date, d.covered, d.lunch, d.dinner]),
    { fontSize: 8, rowHeight: 14 },
  );
  await r.finish();
}
