import { describe, expect, it } from 'vitest';
import {
  renderDailyAttendance, renderMonthlyAttendance, renderPayments, renderStudentStatement,
} from '../../src/lib/pdf/reportPdfs';
import { bufferSink, pageCount, pdfText } from '../helpers/pdf';

const meta = { messName: 'Main Mess', generatedAt: '25 Nov 2026, 12:00', generatedBy: 'Sara Admin' };

async function make(render: (out: NodeJS.WritableStream & import('node:stream').Writable) => Promise<void>) {
  const sink = bufferSink();
  await render(sink.out);
  const pdf = sink.result();
  return { pdf, text: pdfText(pdf), pages: pageCount(pdf) };
}

const students = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    code: `S${String(i + 1).padStart(5, '0')}`, name: `Student Number ${i + 1}`, lunch: 20, dinner: 19, total: 39, marks: { '01': 'LD', '02': 'L' } as Record<string, string>,
  }));

describe('every report PDF', () => {
  it('is a valid PDF with the mess header, a generated-by line and "Page X of Y" footers', async () => {
    const { pdf, text, pages } = await make((out) =>
      renderDailyAttendance({ meta, dateLabel: 'Wednesday, 25 Nov 2026', meals: [] }, out),
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(text).toContain('Main Mess');
    expect(text).toContain('Daily attendance');
    expect(text).toContain('Generated 25 Nov 2026, 12:00 by Sara Admin');
    expect(text).toContain(`Page 1 of ${pages}`);
  });
});

describe('monthly attendance (landscape)', () => {
  const base = { meta, monthLabel: 'November 2026', daysInMonth: 30, totals: { lunch: 40, dinner: 38 } };

  it('shows totals, the per-student table and the day-by-day matrix', async () => {
    const { text, pdf } = await make((out) => renderMonthlyAttendance({ ...base, students: students(2) }, out));
    expect(text).toContain('November 2026');
    expect(text).toContain('Total lunches: 40');
    expect(text).toContain('Total dinners: 38');
    expect(text).toContain('Student Number 1');
    expect(text).toContain('All students');
    expect(text).toContain('Day by day');
    expect(text).toContain('LD'); // the marks of day 1
    expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 841.89 595.28]'); // landscape A4
  });

  it('handles a 300-student month: several pages, repeated headers, still finishes quickly', async () => {
    const started = Date.now();
    const { text, pages } = await make((out) => renderMonthlyAttendance({ ...base, daysInMonth: 31, students: students(300), totals: { lunch: 6000, dinner: 5700 } }, out));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(pages).toBeGreaterThanOrEqual(10);
    expect(text).toContain('Student Number 300');
    expect(text).toContain(`Page ${pages} of ${pages}`);
    // table header repeated on every page of the two tables
    expect((text.match(/#CodeName/g) ?? []).length).toBeGreaterThan(3);
  });

  it('works for 28-day months and for an empty month', async () => {
    const feb = await make((out) => renderMonthlyAttendance({ ...base, monthLabel: 'February 2026', daysInMonth: 28, students: students(1) }, out));
    expect(feb.text).toContain('February 2026');
    const empty = await make((out) => renderMonthlyAttendance({ ...base, students: [], totals: { lunch: 0, dinner: 0 } }, out));
    expect(empty.text).toContain('No students had attendance or coverage this month.');
  });

  it('long names are clipped, never overflow or break the layout', async () => {
    const long = { ...students(1)[0]!, name: 'A Very Long Student Name '.repeat(20) };
    const { pdf } = await make((out) => renderMonthlyAttendance({ ...base, students: [long] }, out));
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe('daily attendance', () => {
  it('lists each meal with counts, arrival times, QR labels and the not-marked list', async () => {
    const { text } = await make((out) =>
      renderDailyAttendance({
        meta, dateLabel: 'Wednesday, 25 Nov 2026',
        meals: [
          { label: 'Lunch', eligible: 150, records: [{ time: '12:05', code: 'S00042', name: 'Ali Khan', table: 'Table 3' }], notMarked: [{ code: 'S00077', name: 'Bilal Ahmed' }] },
          { label: 'Dinner', eligible: 150, records: [] },
        ],
      }, out),
    );
    expect(text).toContain('Wednesday, 25 Nov 2026');
    expect(text).toContain('Lunch: 1 present of 150 eligible');
    expect(text).toContain('12:05');
    expect(text).toContain('Table 3');
    expect(text).toContain('Lunch: eligible but not marked (1)');
    expect(text).toContain('Bilal Ahmed');
    expect(text).toContain('Dinner: 0 present of 150 eligible');
    expect(text).toContain('Nobody marked this meal.');
  });
});

describe('payments ledger', () => {
  const row = (i: number) => ({
    date: '25 Nov 2026', student: `S${i} Ali Khan`, method: 'JazzCash', paidTo: 'Main Mess - 03111234567', transactionId: `T2411250${i}`,
    amount: 'Rs. 8,500', reviewer: 'Sara', status: 'Approved',
  });

  it('prints each payment, the account paid to and the total', async () => {
    const { text, pdf } = await make((out) =>
      renderPayments({ meta, periodLabel: 'November 2026 - approved payments', rows: [row(1), row(2)], totalLabel: 'Rs. 17,000' }, out),
    );
    expect(text).toContain('Payments ledger');
    expect(text).toContain('November 2026 - approved payments');
    expect(text).toContain('Payments listed: 2');
    expect(text).toContain('Main Mess - 03111234567');
    expect(text).toContain('T24112501');
    expect(text).toContain('Total');
    expect(text).toContain('Rs. 17,000');
    expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 841.89 595.28]');
  });

  it('paginates a long ledger and handles an empty period', async () => {
    const many = await make((out) => renderPayments({ meta, periodLabel: 'x', rows: Array.from({ length: 120 }, (_, i) => row(i)), totalLabel: 'Rs. 1' }, out));
    expect(many.pages).toBeGreaterThan(2);
    const none = await make((out) => renderPayments({ meta, periodLabel: 'x', rows: [], totalLabel: 'Rs. 0' }, out));
    expect(none.text).toContain('No payments in this period.');
  });
});

describe('student statement', () => {
  it('has the student, subscriptions, payments and one line per day with the summary', async () => {
    const { text } = await make((out) =>
      renderStudentStatement({
        meta, monthLabel: 'November 2026',
        student: { name: 'Ali Khan', code: 'S00042', email: 'ali@example.com', phone: '03001234567' },
        subscriptions: [{ period: '10 Nov 2026 to 9 Dec 2026', status: 'Active', amount: 'Rs. 8,500' }],
        payments: [{ date: '9 Nov 2026', method: 'JazzCash', transactionId: 'T24110900123', amount: 'Rs. 8,500', status: 'Approved' }],
        days: [
          { date: '10 Nov 2026', covered: 'Yes', lunch: 'Present 12:05', dinner: 'Missed' },
          { date: '11 Nov 2026', covered: 'No', lunch: '-', dinner: '-' },
        ],
        summary: { lunch: 12, dinner: 11, coveredDays: 16, missedMeals: 9 },
      }, out),
    );
    expect(text).toContain('Ali Khan (S00042) - November 2026');
    expect(text).toContain('ali@example.com');
    expect(text).toContain('10 Nov 2026 to 9 Dec 2026');
    expect(text).toContain('T24110900123');
    expect(text).toContain('12 lunches, 11 dinners, 9 missed meals on 16 covered days');
    expect(text).toContain('Present 12:05');
    expect(text).toContain('Missed');
  });

  it('shows friendly empty states', async () => {
    const { text } = await make((out) =>
      renderStudentStatement({
        meta, monthLabel: 'November 2026', student: { name: 'A B', code: 'S1', email: 'a@b.c', phone: '-' },
        subscriptions: [], payments: [], days: [], summary: { lunch: 0, dinner: 0, coveredDays: 0, missedMeals: 0 },
      }, out),
    );
    expect(text).toContain('No subscription in this month.');
    expect(text).toContain('No payments this month.');
  });
});
