import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/AppError';
import { setClock } from '../../src/lib/clock';

const m = vi.hoisted(() => ({
  qr: { insert: vi.fn(), findByIdAnyMess: vi.fn(), findById: vi.fn(), list: vi.fn(), revokeActive: vi.fn(), stats: vi.fn() },
  att: {
    insert: vi.fn(), findOne: vi.fn(), listForStudentRange: vi.fn(), history: vi.fn(), daily: vi.fn(),
    eligibleStatus: vi.fn(), monthly: vi.fn(),
  },
  subs: { findCovering: vi.fn(), listOverlapping: vi.fn() },
  settings: { findMess: vi.fn(), findSettings: vi.fn(), updateSettings: vi.fn() },
  students: { findById: vi.fn(), insert: vi.fn(), searchIds: vi.fn() },
  admins: { findById: vi.fn() },
  audit: { insert: vi.fn() },
  verify: { verifyAccessToken: vi.fn() },
}));

vi.mock('../../src/modules/qr/qr.repository', () => m.qr);
vi.mock('../../src/modules/attendance/attendance.repository', () => m.att);
vi.mock('../../src/modules/subscriptions/subscriptions.repository', () => m.subs);
vi.mock('../../src/modules/settings/settings.repository', () => m.settings);
vi.mock('../../src/modules/students/students.repository', () => m.students);
vi.mock('../../src/modules/admins/admins.repository', () => m.admins);
vi.mock('../../src/modules/audit/audit.repository', () => m.audit);
vi.mock('../../src/modules/auth/tokenVerifier', () => m.verify);
// The 20/min scan limiter is exercised in scanRateLimit.test.ts; here it would accumulate across tests.
vi.mock('../../src/common/middleware/rateLimit', async (orig) => ({
  ...(await orig<typeof import('../../src/common/middleware/rateLimit')>()),
  scanLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { createApp } from '../../src/app';
import { signQrToken, verifyQrToken } from '../../src/modules/qr/qrToken';

const app = createApp({ readinessCheck: async () => undefined });
const MESS = '11111111-1111-4111-8111-111111111111';
const OTHER_MESS = '99999999-9999-4999-8999-999999999999';
const USER = '33333333-3333-4333-8333-333333333333';
const ADMIN = '55555555-5555-4555-8555-555555555555';
const QR = '88888888-8888-4888-8888-888888888888';
const SUB = '77777777-7777-4777-8777-777777777777';

// Frozen "now" values (Karachi = UTC+5)
const LUNCH_TIME = '2026-11-25T07:00:00Z'; // 12:00 local
const DINNER_TIME = '2026-11-25T12:00:00Z'; // 17:00 local
const GAP_TIME = '2026-11-25T11:20:00Z'; // 16:20 local, between meals
const NIGHT_TIME = '2026-11-25T16:30:00Z'; // 21:30 local, after dinner

const MESS_LAT = 31.5204;
const MESS_LNG = 74.3587;

const settingsRow = (over: Record<string, unknown> = {}) => ({
  mess_id: MESS, monthly_fee: 8500, currency: 'PKR', subscription_days: 30,
  lunch_start: '10:00:00', lunch_end: '16:00:00', dinner_start: '16:45:00', dinner_end: '20:45:00',
  expiry_reminder_days: 3, payment_instructions: null, geofence_enabled: false, latitude: null, longitude: null,
  geofence_radius_m: 150, updated_at: '2026-11-25T00:00:00Z', ...over,
});
const geofenceOn = () => settingsRow({ geofence_enabled: true, latitude: MESS_LAT, longitude: MESS_LNG });
const qrRow = (over: Record<string, unknown> = {}) => ({
  id: QR, mess_id: MESS, label: 'Table 3', status: 'active', created_by: ADMIN, created_at: '2026-11-01T00:00:00Z',
  revoked_by: null, revoked_at: null, revoke_reason: null, creator: { id: ADMIN, full_name: 'Sara' }, ...over,
});
const subRow = () => ({
  id: SUB, mess_id: MESS, student_id: USER, payment_id: 'p1', start_date: '2026-11-10', end_date: '2026-12-09',
  status: 'active', amount: 8500, created_at: '2026-11-10T00:00:00Z',
});
const attRow = (over: Record<string, unknown> = {}) => ({
  id: 'a1', mess_id: MESS, student_id: USER, subscription_id: SUB, qr_code_id: QR, meal_type: 'lunch',
  attendance_date: '2026-11-25', marked_at: '2026-11-25T07:00:00Z', source: 'qr', marked_by: null, scan_distance_m: null, ...over,
});

const TOKEN = () => signQrToken({ qid: QR, mid: MESS });

type Who = 'student' | 'admin' | 'super_admin';
function loginAs(who: Who, id = USER): void {
  m.verify.verifyAccessToken.mockResolvedValue({ sub: id, email: 'x@example.com' });
  if (who === 'student') {
    m.students.findById.mockImplementation(async (sid: string) => (sid === id ? { id, mess_id: MESS, email: 'x@example.com', is_active: true } : null));
    m.admins.findById.mockResolvedValue(null);
  } else {
    m.admins.findById.mockResolvedValue({ id, mess_id: MESS, email: 'x@example.com', role: who, is_active: true, full_name: 'Boss', phone: null, created_at: '2026-11-01T00:00:00Z' });
    m.students.findById.mockResolvedValue(null);
  }
}
const api = (method: 'get' | 'post', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', 'Bearer some.jwt.token');

beforeEach(() => {
  vi.resetAllMocks();
  setClock(() => new Date(LUNCH_TIME));
  m.settings.findMess.mockResolvedValue({ id: MESS, name: 'Main Mess', timezone: 'Asia/Karachi' });
  m.settings.findSettings.mockResolvedValue(settingsRow());
  m.audit.insert.mockResolvedValue(undefined);
  m.qr.findByIdAnyMess.mockResolvedValue(qrRow());
  m.subs.findCovering.mockResolvedValue(subRow());
  m.att.findOne.mockResolvedValue(null);
  m.att.insert.mockImplementation(async (r) => attRow({ ...r, marked_at: new Date(LUNCH_TIME).toISOString() }));
});
afterEach(() => setClock(null));

// =====================================================================================================
describe('POST /student/attendance/scan', () => {
  const scan = (body: object = { token: TOKEN() }) => api('post', '/student/attendance/scan').send(body);
  beforeEach(() => loginAs('student'));

  it('marks Lunch at 12:00, choosing the meal and date on the server', async () => {
    const res = await scan();
    expect(res.status).toBe(201);
    expect(m.att.insert).toHaveBeenCalledWith({
      mess_id: MESS, student_id: USER, subscription_id: SUB, qr_code_id: QR,
      meal_type: 'lunch', attendance_date: '2026-11-25', source: 'qr', marked_by: null, scan_distance_m: null,
    });
    expect(res.body.data.attendance).toMatchObject({ meal_type: 'lunch', attendance_date: '2026-11-25', source: 'qr' });
    expect(res.body.data.subscription).toEqual({ end_date: '2026-12-09', days_remaining: 15 });
  });

  it('marks Dinner at 17:00 with the same QR code', async () => {
    setClock(() => new Date(DINNER_TIME));
    await scan();
    expect(m.att.insert).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'dinner' }));
  });

  it('uses the mess-local date near midnight UTC', async () => {
    setClock(() => new Date('2026-11-25T15:00:00Z')); // 20:00 local, dinner
    await scan();
    expect(m.att.insert).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'dinner', attendance_date: '2026-11-25' }));
  });

  it.each([
    ['between meals (16:20)', GAP_TIME],
    ['after dinner (21:30)', NIGHT_TIME],
    ['before lunch (09:00)', '2026-11-25T04:00:00Z'],
  ])('refuses %s with the next window', async (_l, time) => {
    setClock(() => new Date(time));
    const res = await scan();
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OUTSIDE_MEAL_WINDOW');
    expect(res.body.error.details.next_window).toEqual(expect.objectContaining({ meal: expect.any(String), starts_at: expect.any(String) }));
    expect(m.subs.findCovering).not.toHaveBeenCalled();
    expect(m.att.insert).not.toHaveBeenCalled();
  });

  it('tells the student when dinner opens', async () => {
    setClock(() => new Date(GAP_TIME));
    const res = await scan();
    expect(res.body.error.details.next_window).toEqual({ meal: 'dinner', starts_at: '2026-11-25T11:45:00.000Z' });
  });

  it('ignores any meal/date the client tries to send (T6)', async () => {
    const res = await scan({ token: TOKEN(), meal_type: 'dinner', attendance_date: '2026-01-01' });
    expect(res.status).toBe(400);
    expect(m.att.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['no MQ1 prefix', { token: 'x'.repeat(40) }],
    ['too short', { token: 'MQ1:' }],
    ['bad location', { token: `MQ1:${'x'.repeat(30)}`, location: { latitude: 999, longitude: 0, accuracy_m: 5, mocked: false } }],
  ])('rejects %s before any lookup', async (_l, body) => {
    const res = await scan(body);
    expect(res.status).toBe(400);
    expect(m.qr.findByIdAnyMess).not.toHaveBeenCalled();
  });

  it('QR_INVALID for a forged token and for an unknown code', async () => {
    const forged = await scan({ token: `${TOKEN().slice(0, -4)}abcd` });
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('QR_INVALID');

    m.qr.findByIdAnyMess.mockResolvedValue(null);
    expect((await scan()).body.error.code).toBe('QR_INVALID');
  });

  it("WRONG_MESS for another mess's code", async () => {
    m.qr.findByIdAnyMess.mockResolvedValue(qrRow({ mess_id: OTHER_MESS }));
    const res = await scan({ token: signQrToken({ qid: QR, mid: OTHER_MESS }) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WRONG_MESS');
  });

  it('QR_REVOKED once an admin revokes the code', async () => {
    m.qr.findByIdAnyMess.mockResolvedValue(qrRow({ status: 'revoked' }));
    const res = await scan();
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QR_REVOKED');
    expect(m.att.insert).not.toHaveBeenCalled();
  });

  it('NO_ACTIVE_SUBSCRIPTION without coverage (BR-04)', async () => {
    m.subs.findCovering.mockResolvedValue(null);
    const res = await scan();
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_ACTIVE_SUBSCRIPTION');
    expect(m.subs.findCovering).toHaveBeenCalledWith(USER, '2026-11-25');
  });

  it('ALREADY_MARKED returns the original time (pre-check)', async () => {
    m.att.findOne.mockResolvedValue(attRow());
    const res = await scan();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_MARKED');
    expect(res.body.error.details).toEqual({ meal_type: 'lunch', marked_at: '2026-11-25T07:00:00Z' });
    expect(m.att.insert).not.toHaveBeenCalled();
  });

  it('a concurrent duplicate loses on the database constraint (BR-06)', async () => {
    m.att.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(attRow({ marked_at: '2026-11-25T06:59:59Z' }));
    m.att.insert.mockRejectedValue(new AppError('ALREADY_MARKED'));
    const res = await scan();
    expect(res.status).toBe(409);
    expect(res.body.error.details.marked_at).toBe('2026-11-25T06:59:59Z');
  });

  it('only students can scan', async () => {
    loginAs('admin', ADMIN);
    expect((await scan()).status).toBe(403);
    expect((await request(app).post('/api/v1/student/attendance/scan').send({ token: TOKEN() })).status).toBe(401);
  });

});

// =====================================================================================================
describe('scan with the geofence enabled (D-11)', () => {
  beforeEach(() => {
    loginAs('student');
    m.settings.findSettings.mockResolvedValue(geofenceOn());
  });
  const scan = (location?: object) => api('post', '/student/attendance/scan').send({ token: TOKEN(), ...(location ? { location } : {}) });
  const at = (dLat: number, over: object = {}) => ({
    latitude: MESS_LAT + dLat, longitude: MESS_LNG, accuracy_m: 15, mocked: false, ...over,
  });

  it('requires a location', async () => {
    const res = await scan();
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LOCATION_REQUIRED');
    expect(res.body.error.details).toEqual({ reason: 'missing' });
  });

  it('asks to retry when the GPS fix is too inaccurate', async () => {
    const res = await scan(at(0, { accuracy_m: 400 }));
    expect(res.body.error).toMatchObject({ code: 'LOCATION_REQUIRED', details: { reason: 'inaccurate' } });
  });

  it('refuses a mocked location and a phone far from the mess', async () => {
    expect((await scan(at(0, { mocked: true }))).body.error.code).toBe('OUTSIDE_MESS_AREA');
    const far = await scan(at(0.02)); // ~2.2 km
    expect(far.status).toBe(422);
    expect(far.body.error.code).toBe('OUTSIDE_MESS_AREA');
    expect(m.att.insert).not.toHaveBeenCalled();
  });

  it('accepts a phone at the mess and stores only the distance, not the coordinates', async () => {
    const res = await scan(at(0.0004)); // ~45 m
    expect(res.status).toBe(201);
    const inserted = m.att.insert.mock.calls[0]![0];
    expect(inserted.scan_distance_m).toBeGreaterThan(30);
    expect(inserted.scan_distance_m).toBeLessThan(60);
    expect(JSON.stringify(inserted)).not.toContain(String(MESS_LAT + 0.0004));
  });

  it('checks the geofence only after subscription and duplicate checks', async () => {
    m.subs.findCovering.mockResolvedValue(null);
    expect((await scan()).body.error.code).toBe('NO_ACTIVE_SUBSCRIPTION');
  });

  it('a location sent while the geofence is OFF is ignored and never stored', async () => {
    m.settings.findSettings.mockResolvedValue(settingsRow());
    const res = await scan(at(0.02));
    expect(res.status).toBe(201);
    expect(m.att.insert.mock.calls[0]![0].scan_distance_m).toBeNull();
  });
});

// =====================================================================================================
describe('student reads', () => {
  beforeEach(() => loginAs('student'));

  it('today: current meal, next window, location flag and what is marked', async () => {
    m.att.listForStudentRange.mockResolvedValue([attRow()]);
    const res = await api('get', '/student/attendance/today');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      date: '2026-11-25', current_meal: 'lunch', location_required: false,
      lunch: { marked: true, marked_at: '2026-11-25T07:00:00Z' }, dinner: { marked: false, marked_at: null },
    });
    expect(res.body.data.next_window).toEqual({ meal: 'dinner', starts_at: '2026-11-25T11:45:00.000Z' });
    expect(m.att.listForStudentRange).toHaveBeenCalledWith(USER, '2026-11-25', '2026-11-25');
  });

  it('today reports location_required when the geofence is on', async () => {
    m.settings.findSettings.mockResolvedValue(geofenceOn());
    m.att.listForStudentRange.mockResolvedValue([]);
    expect((await api('get', '/student/attendance/today')).body.data.location_required).toBe(true);
  });

  it('calendar: every day of the month, coverage and missed meals before today', async () => {
    m.subs.listOverlapping.mockResolvedValue([{ id: SUB, start_date: '2026-11-10', end_date: '2026-12-09', status: 'active' }]);
    m.att.listForStudentRange.mockResolvedValue([
      attRow({ attendance_date: '2026-11-10', meal_type: 'lunch', marked_at: '2026-11-10T07:00:00Z' }),
      attRow({ id: 'a2', attendance_date: '2026-11-10', meal_type: 'dinner', marked_at: '2026-11-10T12:00:00Z' }),
    ]);
    const res = await api('get', '/student/attendance/calendar?month=2026-11');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ month: '2026-11', timezone: 'Asia/Karachi', server_date: '2026-11-25' });
    expect(res.body.data.days).toHaveLength(30);
    expect(res.body.data.days[9]).toMatchObject({ date: '2026-11-10', covered: true, lunch: { marked: true }, dinner: { marked: true } });
    expect(res.body.data.days[8]).toMatchObject({ date: '2026-11-09', covered: false });
    // covered days before today without a mark: Nov 11..24 = 14 days x 2 meals
    expect(res.body.data.summary).toEqual({ lunch_count: 1, dinner_count: 1, covered_days: 21, missed_meals: 28 });
    expect(m.subs.listOverlapping).toHaveBeenCalledWith(USER, '2026-11-01', '2026-11-30');
  });

  it('calendar rejects bad or out-of-range months', async () => {
    expect((await api('get', '/student/attendance/calendar')).status).toBe(400);
    expect((await api('get', '/student/attendance/calendar?month=2026-13')).status).toBe(400);
    expect((await api('get', '/student/attendance/calendar?month=2027-06')).status).toBe(400); // too far ahead
    expect((await api('get', '/student/attendance/calendar?month=2020-01')).status).toBe(400); // too far back
    m.subs.listOverlapping.mockResolvedValue([]);
    m.att.listForStudentRange.mockResolvedValue([]);
    expect((await api('get', '/student/attendance/calendar?month=2026-12')).status).toBe(200); // next month is allowed
  });

  it('history: defaults to the last 30 days, pages and filters by meal', async () => {
    m.att.history.mockResolvedValue({ rows: [attRow()], total: 61 });
    const res = await api('get', '/student/attendance/history?meal_type=lunch&page=2&limit=30');
    expect(res.status).toBe(200);
    expect(m.att.history).toHaveBeenCalledWith(USER, '2026-10-27', '2026-11-25', 'lunch', 30, 59);
    expect(res.body.meta).toEqual({ page: 2, limit: 30, total: 61, total_pages: 3 });
    expect(res.body.data[0]).toEqual({ id: 'a1', meal_type: 'lunch', attendance_date: '2026-11-25', marked_at: '2026-11-25T07:00:00Z', source: 'qr' });
  });

  it('history validates the range', async () => {
    expect((await api('get', '/student/attendance/history?from=2026-11-20&to=2026-11-01')).status).toBe(400);
    expect((await api('get', '/student/attendance/history?from=2024-01-01&to=2026-11-01')).status).toBe(400);
    expect((await api('get', '/student/attendance/history?meal_type=brunch')).status).toBe(400);
  });
});

// =====================================================================================================
describe('admin QR codes', () => {
  beforeEach(() => loginAs('admin', ADMIN));

  it('lists codes with today\'s scan counts', async () => {
    m.qr.list.mockResolvedValue({ rows: [qrRow()], total: 1 });
    m.qr.stats.mockResolvedValue([{ qr_code_id: QR, scans_today: 14, scans_total: 812, last_scan_at: '2026-11-25T06:00:00Z' }]);
    const res = await api('get', '/admin/qr-codes');
    expect(res.status).toBe(200);
    expect(m.qr.list).toHaveBeenCalledWith(MESS, 'active', 0, 19);
    expect(m.qr.stats).toHaveBeenCalledWith(MESS, '2026-11-25');
    expect(res.body.data[0]).toMatchObject({ id: QR, label: 'Table 3', status: 'active', scans_today: 14, last_scan_at: '2026-11-25T06:00:00Z', created_by: { full_name: 'Sara' } });
    expect(res.body.meta.total).toBe(1);
  });

  it('creates a code (any admin) and audits it', async () => {
    m.qr.insert.mockResolvedValue(qrRow());
    const res = await api('post', '/admin/qr-codes').send({ label: 'Table 3' });
    expect(res.status).toBe(201);
    expect(m.qr.insert).toHaveBeenCalledWith(MESS, 'Table 3', ADMIN);
    expect(m.audit.insert.mock.calls[0]![0]).toMatchObject({ action: 'qr.create', entity_id: QR, metadata: { label: 'Table 3' } });
  });

  it('rejects a duplicate active label and bad input', async () => {
    m.qr.insert.mockRejectedValue(new AppError('QR_LABEL_EXISTS'));
    expect((await api('post', '/admin/qr-codes').send({ label: 'Table 3' })).status).toBe(409);
    expect((await api('post', '/admin/qr-codes').send({ label: 'x' })).status).toBe(400);
    expect((await api('post', '/admin/qr-codes').send({ label: 'Table 4', status: 'active' })).status).toBe(400);
  });

  it('returns a QR value that verifies and binds to this code and mess', async () => {
    m.qr.findById.mockResolvedValue(qrRow());
    m.qr.stats.mockResolvedValue([{ qr_code_id: QR, scans_today: 3, scans_total: 40, last_scan_at: null }]);
    const res = await api('get', `/admin/qr-codes/${QR}`);
    expect(res.status).toBe(200);
    expect(verifyQrToken(res.body.data.qr_value)).toEqual({ qid: QR, mid: MESS });
    expect(res.body.data).toMatchObject({ scans_today: 3, scans_total: 40 });
    expect(m.qr.findById).toHaveBeenCalledWith(QR, MESS);
  });

  it('issues no value for a revoked code', async () => {
    m.qr.findById.mockResolvedValue(qrRow({ status: 'revoked', revoked_at: '2026-11-20T00:00:00Z', revoke_reason: 'Leaked' }));
    m.qr.stats.mockResolvedValue([]);
    const res = await api('get', `/admin/qr-codes/${QR}`);
    expect(res.body.data.qr_value).toBeNull();
    expect(res.body.data.revoke_reason).toBe('Leaked');
  });

  it('serves a real print-ready PDF for an active code', async () => {
    m.qr.findById.mockResolvedValue(qrRow());
    const res = await api('get', `/admin/qr-codes/${QR}/print.pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="qr-table-3.pdf"');
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(5_000); // contains the QR image
  });

  it('will not print a revoked code, and errors stay JSON', async () => {
    m.qr.findById.mockResolvedValue(qrRow({ status: 'revoked' }));
    const res = await api('get', `/admin/qr-codes/${QR}/print.pdf`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QR_ALREADY_REVOKED');
  });

  it('revokes with a reason and audits it', async () => {
    m.qr.findById.mockResolvedValue(qrRow());
    m.qr.revokeActive.mockResolvedValue(qrRow({ status: 'revoked', revoked_at: LUNCH_TIME, revoke_reason: 'Photo shared in a group' }));
    const res = await api('post', `/admin/qr-codes/${QR}/revoke`).send({ reason: 'Photo shared in a group' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('revoked');
    expect(m.qr.revokeActive).toHaveBeenCalledWith(QR, MESS, ADMIN, 'Photo shared in a group', '2026-11-25T07:00:00.000Z');
    expect(m.audit.insert.mock.calls[0]![0]).toMatchObject({ action: 'qr.revoke', metadata: { label: 'Table 3', reason: 'Photo shared in a group' } });
  });

  it('revoke needs a reason, a known code and an active status', async () => {
    expect((await api('post', `/admin/qr-codes/${QR}/revoke`).send({ reason: 'no' })).status).toBe(400);
    m.qr.findById.mockResolvedValue(null);
    expect((await api('post', `/admin/qr-codes/${QR}/revoke`).send({ reason: 'Leaked online' })).status).toBe(404);
    m.qr.findById.mockResolvedValue(qrRow({ status: 'revoked' }));
    expect((await api('post', `/admin/qr-codes/${QR}/revoke`).send({ reason: 'Leaked online' })).body.error.code).toBe('QR_ALREADY_REVOKED');
    m.qr.findById.mockResolvedValue(qrRow());
    m.qr.revokeActive.mockResolvedValue(null); // lost a race
    expect((await api('post', `/admin/qr-codes/${QR}/revoke`).send({ reason: 'Leaked online' })).status).toBe(409);
  });

  it('students cannot manage QR codes', async () => {
    loginAs('student');
    expect((await api('get', '/admin/qr-codes')).status).toBe(403);
  });
});

// =====================================================================================================
describe('admin attendance views', () => {
  beforeEach(() => loginAs('admin', ADMIN));

  it('daily: present / eligible / not marked, with QR label and distance', async () => {
    m.att.daily.mockResolvedValue([
      { ...attRow(), student: { id: USER, student_code: 'S00042', full_name: 'Ali Khan' }, qr: { label: 'Table 3' }, scan_distance_m: 42 },
    ]);
    m.att.eligibleStatus.mockResolvedValue([
      { student_id: USER, student_code: 'S00042', full_name: 'Ali Khan', marked: true },
      { student_id: 'u2', student_code: 'S00077', full_name: 'Bilal', marked: false },
      { student_id: 'u3', student_code: 'S00078', full_name: 'Danish', marked: false },
    ]);
    const res = await api('get', '/admin/attendance/daily?meal_type=lunch');
    expect(res.status).toBe(200);
    expect(m.att.daily).toHaveBeenCalledWith(MESS, '2026-11-25', 'lunch');
    expect(res.body.data).toMatchObject({ date: '2026-11-25', meal_type: 'lunch', counts: { present: 1, eligible: 3, not_marked: 2 } });
    expect(res.body.data.records[0]).toEqual({
      id: 'a1', student: { id: USER, student_code: 'S00042', full_name: 'Ali Khan' }, marked_at: '2026-11-25T07:00:00Z',
      source: 'qr', qr_label: 'Table 3', scan_distance_m: 42,
    });
    expect(res.body.data.not_marked).toBeUndefined();
  });

  it('daily: lists the not-yet-marked students on request, for a chosen date', async () => {
    m.att.daily.mockResolvedValue([]);
    m.att.eligibleStatus.mockResolvedValue([{ student_id: 'u2', student_code: 'S00077', full_name: 'Bilal', marked: false }]);
    const res = await api('get', '/admin/attendance/daily?meal_type=dinner&date=2026-11-20&include_not_marked=true');
    expect(m.att.daily).toHaveBeenCalledWith(MESS, '2026-11-20', 'dinner');
    expect(res.body.data.not_marked).toEqual([{ student_id: 'u2', student_code: 'S00077', full_name: 'Bilal' }]);
  });

  it('daily requires a meal and a valid date', async () => {
    expect((await api('get', '/admin/attendance/daily')).status).toBe(400);
    expect((await api('get', '/admin/attendance/daily?meal_type=lunch&date=2026-02-31')).status).toBe(400);
  });

  it('monthly: totals, marks and the q filter', async () => {
    m.att.monthly.mockResolvedValue([
      { student_id: USER, student_code: 'S00042', full_name: 'Ali Khan', lunch_count: 20, dinner_count: 19, total_count: 39, marks: { '01': 'LD', '02': 'L' } },
      { student_id: 'u2', student_code: 'S00077', full_name: 'Bilal Ahmed', lunch_count: 5, dinner_count: 4, total_count: 9, marks: {} },
    ]);
    const all = await api('get', '/admin/attendance/monthly?month=2026-11');
    expect(m.att.monthly).toHaveBeenCalledWith(MESS, '2026-11-01');
    expect(all.body.data).toMatchObject({ month: '2026-11', days_in_month: 30, totals: { lunch: 25, dinner: 23 } });
    expect(all.body.data.students[0].marks).toEqual({ '01': 'LD', '02': 'L' });

    const filtered = await api('get', '/admin/attendance/monthly?month=2026-11&q=bilal');
    expect(filtered.body.data.students).toHaveLength(1);
    expect(filtered.body.data.totals).toEqual({ lunch: 5, dinner: 4 });
    expect((await api('get', '/admin/attendance/monthly?month=nov')).status).toBe(400);
  });

  describe('manual attendance (D-06)', () => {
    const manual = (over: object = {}) =>
      api('post', '/admin/attendance/manual').send({ student_id: USER, meal_type: 'lunch', date: '2026-11-24', reason: 'Phone battery died', ...over });
    beforeEach(() => {
      m.students.findById.mockResolvedValue({ id: USER, mess_id: MESS, is_active: true });
      m.att.insert.mockImplementation(async (r) => attRow({ ...r, id: 'manual1' }));
    });

    it('records a manual entry with the admin as author and audits it', async () => {
      const res = await manual();
      expect(res.status).toBe(201);
      expect(m.subs.findCovering).toHaveBeenCalledWith(USER, '2026-11-24', { includeExpired: true });
      expect(m.att.insert).toHaveBeenCalledWith({
        mess_id: MESS, student_id: USER, subscription_id: SUB, qr_code_id: null,
        meal_type: 'lunch', attendance_date: '2026-11-24', source: 'manual', marked_by: ADMIN, scan_distance_m: null,
      });
      expect(m.audit.insert.mock.calls[0]![0]).toMatchObject({
        action: 'attendance.manual', actor_id: ADMIN,
        metadata: { student_id: USER, meal_type: 'lunch', date: '2026-11-24', reason: 'Phone battery died' },
      });
    });

    it.each([
      ['a future date', { date: '2026-11-26' }],
      ['more than 7 days back', { date: '2026-11-17' }],
      ['no reason', { reason: 'no' }],
      ['an extra field', { source: 'qr' }],
    ])('rejects %s', async (_l, over) => {
      expect((await manual(over)).status).toBe(400);
      expect(m.att.insert).not.toHaveBeenCalled();
    });

    it('applies the same rules as a scan: student of this mess, subscription, no duplicate', async () => {
      m.students.findById.mockResolvedValue({ id: USER, mess_id: OTHER_MESS });
      expect((await manual()).status).toBe(404);
      m.students.findById.mockResolvedValue({ id: USER, mess_id: MESS });
      m.subs.findCovering.mockResolvedValue(null);
      expect((await manual()).body.error.code).toBe('NO_ACTIVE_SUBSCRIPTION');
      m.subs.findCovering.mockResolvedValue(subRow());
      m.att.findOne.mockResolvedValue(attRow());
      expect((await manual()).body.error.code).toBe('ALREADY_MARKED');
    });
  });

  it('students cannot reach the admin views', async () => {
    loginAs('student');
    expect((await api('get', '/admin/attendance/daily?meal_type=lunch')).status).toBe(403);
    expect((await api('post', '/admin/attendance/manual').send({})).status).toBe(403);
  });
});
