import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/AppError';
import { setClock } from '../../src/lib/clock';
import { pageCount, pdfText } from '../helpers/pdf';

const m = vi.hoisted(() => ({
  reports: { dashboardCounts: vi.fn(), overview: vi.fn(), paymentsLedger: vi.fn() },
  att: { monthly: vi.fn(), daily: vi.fn(), eligibleStatus: vi.fn(), listForStudentRange: vi.fn(), history: vi.fn(), findOne: vi.fn(), insert: vi.fn() },
  subs: { listOverlapping: vi.fn(), findCovering: vi.fn() },
  payments: { listForAdmin: vi.fn(), findLatestForStudent: vi.fn() },
  students: { findById: vi.fn(), findInMess: vi.fn(), searchIds: vi.fn() },
  admins: { findById: vi.fn() },
  settings: { findMess: vi.fn(), findSettings: vi.fn() },
  audit: { insert: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
}));

vi.mock('../../src/modules/reports/reports.repository', () => m.reports);
vi.mock('../../src/modules/attendance/attendance.repository', () => m.att);
vi.mock('../../src/modules/subscriptions/subscriptions.repository', () => m.subs);
vi.mock('../../src/modules/payments/payments.repository', () => m.payments);
vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/settings/settings.repository', () => m.settings);
vi.mock('../../src/modules/audit/audit.repository', () => m.audit);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);

import { createApp } from '../../src/app';

const app = createApp({ readinessCheck: async () => undefined });
const MESS = '11111111-1111-4111-8111-111111111111';
const ADMIN = '55555555-5555-4555-8555-555555555555';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const TODAY = '2026-11-25';

const settingsRow = () => ({
  mess_id: MESS, monthly_fee: 8500, currency: 'PKR', subscription_days: 30, lunch_start: '10:00:00', lunch_end: '16:00:00',
  dinner_start: '16:45:00', dinner_end: '20:45:00', expiry_reminder_days: 3, payment_instructions: null,
  geofence_enabled: false, latitude: null, longitude: null, geofence_radius_m: 150, updated_at: 'x',
});
const adminRow = (role = 'admin') => ({
  id: ADMIN, mess_id: MESS, email: 'sara@example.com', role, is_active: true, full_name: 'Sara Admin', phone: null, created_at: 'x',
});

function loginAsAdmin(role = 'admin'): void {
  m.verify.verifyAccessToken.mockResolvedValue({ sub: ADMIN, email: 'sara@example.com' });
  m.admins.findById.mockResolvedValue(adminRow(role));
  m.students.findById.mockResolvedValue(null);
}
function loginAsStudent(): void {
  m.verify.verifyAccessToken.mockResolvedValue({ sub: STUDENT, email: 's@example.com' });
  m.students.findById.mockResolvedValue({ id: STUDENT, mess_id: MESS, email: 's@example.com', is_active: true });
  m.admins.findById.mockResolvedValue(null);
}

/** Fetches a PDF as raw bytes. */
const pdf = (path: string) =>
  request(app).get(`/api/v1/admin/reports/${path}`).set('Authorization', 'Bearer t').buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, res.headers['content-type']?.includes('pdf') ? Buffer.concat(chunks) : JSON.parse(Buffer.concat(chunks).toString())));
  });
const api = (path: string) => request(app).get(`/api/v1/admin/reports/${path}`).set('Authorization', 'Bearer t');

beforeEach(() => {
  vi.resetAllMocks();
  setClock(() => new Date('2026-11-25T07:05:00Z')); // 12:05 Karachi
  m.settings.findMess.mockResolvedValue({ id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' });
  m.settings.findSettings.mockResolvedValue(settingsRow());
  m.audit.insert.mockResolvedValue(undefined);
  loginAsAdmin();
});
afterEach(() => setClock(null));

const lastAudit = () => m.audit.insert.mock.calls.at(-1)![0];

// =====================================================================================================
describe('GET /admin/reports/overview', () => {
  const o = (over: Record<string, unknown> = {}) => ({
    month: '2026-11', revenue: 17000, payments_approved: 2, payments_rejected: 1, lunch_total: 25, dinner_total: 12,
    students_with_coverage: 5,
    daily: [
      { date: '2026-11-01', lunch: 10, dinner: 4 }, { date: '2026-11-02', lunch: 15, dinner: 8 }, { date: '2026-11-03', lunch: 0, dinner: 0 },
    ], ...over,
  });

  it('returns the month analytics with per-day averages over days the meal was served', async () => {
    m.reports.overview.mockResolvedValue(o());
    const res = await api('overview?month=2026-11');
    expect(res.status).toBe(200);
    expect(m.reports.overview).toHaveBeenCalledWith(MESS, '2026-11-01');
    expect(res.body.data).toMatchObject({
      month: '2026-11', revenue: '17000.00', payments_approved: 2, payments_rejected: 1, lunch_total: 25, dinner_total: 12,
      students_with_coverage: 5, avg_lunch_per_day: 12.5, avg_dinner_per_day: 6,
    });
    expect(res.body.data.daily).toHaveLength(3);
  });

  it('defaults to the current month; an empty month gives zeros (no division by zero)', async () => {
    m.reports.overview.mockResolvedValue(o({ revenue: 0, lunch_total: 0, dinner_total: 0, daily: [] }));
    const res = await api('overview');
    expect(m.reports.overview).toHaveBeenCalledWith(MESS, '2026-11-01');
    expect(res.body.data).toMatchObject({ revenue: '0.00', avg_lunch_per_day: 0, avg_dinner_per_day: 0 });
  });

  it('validates the month and the role', async () => {
    expect((await api('overview?month=nov')).status).toBe(400);
    expect((await api('overview?month=2026-13')).status).toBe(400);
    loginAsStudent();
    expect((await api('overview')).status).toBe(403);
  });
});

// =====================================================================================================
describe('PDF: attendance-monthly', () => {
  beforeEach(() => {
    m.att.monthly.mockResolvedValue([
      { student_id: STUDENT, student_code: 'S00042', full_name: 'Ali Khan', lunch_count: 20, dinner_count: 19, total_count: 39, marks: { '01': 'LD' } },
      { student_id: 'u2', student_code: 'S00077', full_name: 'Bilal Ahmed', lunch_count: 5, dinner_count: 4, total_count: 9, marks: {} },
    ]);
  });

  it('streams a landscape PDF named after the month, with the data and the admin who generated it', async () => {
    const res = await pdf('attendance-monthly.pdf?month=2026-11');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="attendance-monthly-2026-11.pdf"');
    expect(res.headers['cache-control']).toBe('no-store');

    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(body);
    expect(text).toContain('November 2026');
    expect(text).toContain('Ali Khan');
    expect(text).toContain('Bilal Ahmed');
    expect(text).toContain('Total lunches: 25');
    expect(text).toContain('Total dinners: 23');
    expect(text).toContain('Generated 25 Nov 2026, 12:05 by Sara Admin');
    expect(pageCount(body)).toBe(2);
    expect(m.att.monthly).toHaveBeenCalledWith(MESS, '2026-11-01');
  });

  it('audits the download (BR-19)', async () => {
    await pdf('attendance-monthly.pdf?month=2026-11');
    expect(lastAudit()).toMatchObject({
      action: 'report.download', actor_id: ADMIN, actor_role: 'admin', entity_type: 'report',
      metadata: { report: 'attendance-monthly', month: '2026-11' },
    });
  });

  it('a failed audit write blocks the download and the error is still JSON', async () => {
    m.audit.insert.mockRejectedValue(new AppError('INTERNAL_ERROR'));
    const res = await pdf('attendance-monthly.pdf?month=2026-11');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.success).toBe(false);
  });

  it('requires a valid month; students are refused', async () => {
    expect((await pdf('attendance-monthly.pdf')).status).toBe(400);
    expect((await pdf('attendance-monthly.pdf?month=2026-1')).status).toBe(400);
    loginAsStudent();
    expect((await pdf('attendance-monthly.pdf?month=2026-11')).status).toBe(403);
  });
});

// =====================================================================================================
describe('PDF: attendance-daily', () => {
  beforeEach(() => {
    m.att.daily.mockImplementation(async (_mess: string, _date: string, meal: string) =>
      meal === 'lunch'
        ? [
            { id: 'a2', marked_at: '2026-11-25T07:20:00Z', source: 'qr', scan_distance_m: 30, student: { id: 'u2', student_code: 'S00077', full_name: 'Bilal Ahmed' }, qr: { label: 'Table 5' } },
            { id: 'a1', marked_at: '2026-11-25T07:00:00Z', source: 'qr', scan_distance_m: 40, student: { id: STUDENT, student_code: 'S00042', full_name: 'Ali Khan' }, qr: { label: 'Table 3' } },
            { id: 'a0', marked_at: '2026-11-25T06:50:00Z', source: 'manual', scan_distance_m: null, student: { id: 'u3', student_code: 'S00078', full_name: 'Danish' }, qr: null },
          ]
        : [],
    );
    m.att.eligibleStatus.mockResolvedValue([
      { student_id: STUDENT, student_code: 'S00042', full_name: 'Ali Khan', marked: true },
      { student_id: 'u9', student_code: 'S00099', full_name: 'Zainab Absent', marked: false },
    ]);
  });

  it('defaults to today, lists both meals in order of arrival with local times and QR labels', async () => {
    const res = await pdf('attendance-daily.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="attendance-daily-2026-11-25.pdf"');
    const text = pdfText(res.body as Buffer);
    expect(text).toContain('Wednesday, 25 Nov 2026');
    expect(text).toContain('Lunch: 3 present of 2 eligible');
    expect(text).toContain('Dinner: 0 present of 2 eligible');
    expect(text).toContain('Table 3');
    expect(text).toContain('manual entry');
    expect(text.indexOf('11:50')).toBeLessThan(text.indexOf('12:00')); // arrival order, Karachi time
    expect(text.indexOf('12:00')).toBeLessThan(text.indexOf('12:20'));
    expect(text).not.toContain('Zainab Absent'); // not-marked list is optional
    expect(m.att.daily).toHaveBeenCalledWith(MESS, '2026-11-25', 'lunch');
  });

  it('can include the eligible-but-not-marked list for a chosen date', async () => {
    const res = await pdf('attendance-daily.pdf?date=2026-11-20&include_not_marked=true');
    const text = pdfText(res.body as Buffer);
    expect(text).toContain('Friday, 20 Nov 2026');
    expect(text).toContain('Lunch: eligible but not marked (1)');
    expect(text).toContain('Zainab Absent');
    expect(m.att.daily).toHaveBeenCalledWith(MESS, '2026-11-20', 'dinner');
    expect(lastAudit().metadata).toEqual({ report: 'attendance-daily', date: '2026-11-20', include_not_marked: true });
  });

  it('rejects an impossible date', async () => {
    expect((await pdf('attendance-daily.pdf?date=2026-02-31')).status).toBe(400);
  });
});

// =====================================================================================================
describe('PDF: payments', () => {
  const ledger = (over: Record<string, unknown> = {}) => ({
    id: 'p1', method: 'jazzcash', amount: 8500, transaction_id: 'T24112500123', status: 'approved',
    submitted_at: '2026-11-24T10:00:00Z', reviewed_at: '2026-11-25T07:00:00Z',
    paid_to: { account_title: 'Main Mess', account_number: '03111234567', bank_name: null },
    student: { student_code: 'S00042', full_name: 'Ali Khan' }, reviewer: { full_name: 'Sara Admin' }, ...over,
  });

  it('lists approved payments of the month (Karachi dates) with a total', async () => {
    m.reports.paymentsLedger.mockResolvedValue([ledger(), ledger({ id: 'p2', transaction_id: 'T24112500456', method: 'bank', amount: '8500.00' })]);
    const res = await pdf('payments.pdf?month=2026-11');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="payments-2026-11-approved.pdf"');
    expect(m.reports.paymentsLedger).toHaveBeenCalledWith({
      messId: MESS, status: 'approved',
      fromIso: '2026-10-31T19:00:00.000Z', // 1 Nov 00:00 Karachi
      toIso: '2026-11-30T19:00:00.000Z', // 1 Dec 00:00 Karachi
    });
    const text = pdfText(res.body as Buffer);
    expect(text).toContain('Payments ledger');
    expect(text).toContain('November 2026 - approved payments');
    expect(text).toContain('S00042 Ali Khan');
    expect(text).toContain('JazzCash');
    expect(text).toContain('Bank');
    expect(text).toContain('Main Mess - 03111234567');
    expect(text).toContain('T24112500456');
    expect(text).toContain('Total: Rs. 17,000');
    expect(text).toContain('Sara Admin');
    expect(lastAudit().metadata).toEqual({ report: 'payments', month: '2026-11', status: 'approved' });
  });

  it('status=all counts only approved payments in the total and says so', async () => {
    m.reports.paymentsLedger.mockResolvedValue([ledger(), ledger({ id: 'p2', status: 'rejected', amount: 8500 }), ledger({ id: 'p3', status: 'pending', amount: 8500 })]);
    const res = await pdf('payments.pdf?month=2026-11&status=all');
    const text = pdfText(res.body as Buffer);
    expect(m.reports.paymentsLedger).toHaveBeenCalledWith(expect.objectContaining({ status: 'all' }));
    expect(text).toContain('all payments (total counts approved only)');
    expect(text).toContain('Payments listed: 3');
    expect(text).toContain('Total: Rs. 8,500');
  });

  it('an empty period still produces a valid PDF', async () => {
    m.reports.paymentsLedger.mockResolvedValue([]);
    const res = await pdf('payments.pdf?month=2026-11');
    expect(res.status).toBe(200);
    expect(pdfText(res.body as Buffer)).toContain('No payments in this period.');
  });

  it('validates month and status', async () => {
    expect((await pdf('payments.pdf')).status).toBe(400);
    expect((await pdf('payments.pdf?month=2026-11&status=weird')).status).toBe(400);
  });
});

// =====================================================================================================
describe('PDF: student-statement', () => {
  const studentRow = () => ({
    id: STUDENT, mess_id: MESS, student_code: 'S00042', email: 'ali@example.com', full_name: 'Ali Khan', phone: '03001234567',
    roll_number: null, profile_image_url: null, is_active: true, created_at: 'x',
  });
  const q = `student-statement.pdf?student_id=${STUDENT}&month=2026-11`;

  beforeEach(() => {
    m.students.findInMess.mockResolvedValue(studentRow());
    m.subs.listOverlapping.mockResolvedValue([
      { id: 's1', start_date: '2026-11-10', end_date: '2026-12-09', status: 'active', amount: 8500, mess_id: MESS, student_id: STUDENT, payment_id: 'p', created_at: 'x' },
    ]);
    m.att.listForStudentRange.mockResolvedValue([
      { attendance_date: '2026-11-10', meal_type: 'lunch', marked_at: '2026-11-10T07:05:00Z' },
    ]);
    m.payments.listForAdmin.mockResolvedValue({
      rows: [{ id: 'p1', method: 'easypaisa', amount: 8500, transaction_id: 'T24110900123', status: 'approved', submitted_at: '2026-11-09T10:00:00Z', reviewed_at: null, student: null, reviewer: null }],
      total: 1,
    });
  });

  it('builds the statement: profile, subscriptions, payments and a line per day', async () => {
    const res = await pdf(q);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="student-statement-S00042-2026-11.pdf"');
    const text = pdfText(res.body as Buffer);
    expect(text).toContain('Ali Khan (S00042) - November 2026');
    expect(text).toContain('ali@example.com');
    expect(text).toContain('10 Nov 2026 to 9 Dec 2026');
    expect(text).toContain('Active');
    expect(text).toContain('Rs. 8,500');
    expect(text).toContain('T24110900123');
    expect(text).toContain('EasyPaisa');
    expect(text).toContain('Present 12:05');
    expect(text).toContain('Missed'); // covered days before today without a mark
    expect(text).toContain('1 lunches, 0 dinners');
    expect(m.subs.listOverlapping).toHaveBeenCalledWith(STUDENT, '2026-11-01', '2026-11-30');
    expect(m.payments.listForAdmin).toHaveBeenCalledWith(expect.objectContaining({ messId: MESS, studentId: STUDENT, status: 'all' }));
    expect(lastAudit().metadata).toEqual({ report: 'student-statement', month: '2026-11', student_id: STUDENT });
  });

  it('a student of another mess (or unknown id) is NOT_FOUND and nothing is audited', async () => {
    m.students.findInMess.mockResolvedValue(null);
    const res = await pdf(q);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(m.students.findInMess).toHaveBeenCalledWith(STUDENT, MESS);
    expect(m.audit.insert).not.toHaveBeenCalled();
  });

  it('validates its parameters', async () => {
    expect((await pdf('student-statement.pdf?month=2026-11')).status).toBe(400);
    expect((await pdf('student-statement.pdf?student_id=nope&month=2026-11')).status).toBe(400);
    expect((await pdf(`student-statement.pdf?student_id=${STUDENT}`)).status).toBe(400);
  });
});
