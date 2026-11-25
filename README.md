# Mess Management — Backend

Node.js + Express + TypeScript REST API. Design docs: `D:\mess-management-docs` (start with `backend-architecture.md`).

## Setup

```powershell
npm install
copy .env.example .env      # then fill in the values (never commit .env)
npm run dev                 # http://localhost:8080/health
```

| Script | What it does |
|--------|--------------|
| `npm run dev` | Run with auto-reload (`tsx watch`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit + integration tests (no real Supabase needed) |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run admin:create -- --email a@b.com --name "Name"` | Create the first super admin of a mess |
| `npm run cloudinary:check` | Check the Cloudinary key can read, upload and delete |

## Deploy

Push to `main` and GitHub tests, builds and deploys to the VPS by itself. One-time setup: **[DEPLOY.md](DEPLOY.md)**.

## Database

Apply `database/migrations/0001…0006_*.sql` `0008_attendance_functions.sql` and `0009_dashboard_and_student_list.sql` in order in the Supabase SQL editor (or `supabase db push`), then `database/seed/0007_seed_default_mess.sql`. Put the generated `messes.id` into `DEFAULT_MESS_ID`. Create the first super admin as described in `database-schema.md` §10.

## Status

Done: config/env validation, logging, error envelope, request id, rate limits, validation + role guard middleware, health endpoints, QR token signing, geofence, meal-window/time helpers, SQL migrations.
Auth module (done, tested with mocks only): student register / verify-email / resend / login, admin login, refresh, logout, forgot / reset / change password, plus the `authenticate` middleware (JWKS token check + role from the `students`/`admins` tables).
Settings module (done, tested with mocks only): `GET/PATCH /admin/settings` (super admin edits: fee, 30-day period, meal windows, geofence), `GET/POST/PATCH /admin/payment-accounts` (plain-text EasyPaisa / JazzCash / NayaPay / SadaPay / bank accounts, hide instead of delete), `GET /student/payment-instructions`, `GET /admin/me`. Role guards are applied at the `/student` and `/admin` mount points in `src/routes/index.ts`.
Payments + uploads (done, tested with mocks only): `POST /uploads/signature` (Cloudinary signed uploads), `POST/GET /student/payments`, `GET /student/payments/:id`, `POST /student/payments/:id/cancel`, `GET /admin/payments` (+ history/filters/search), `GET /admin/payments/:id` (permanent signed screenshot URL + duplicate hints), `POST /admin/payments/:id/approve` (atomic SQL function `approve_payment`), `POST /admin/payments/:id/reject`. Approve/reject notify the student (in-app row + Expo push, best effort).
QR codes + attendance (done, API tested with mocks; SQL tested on real Postgres): `GET/POST /admin/qr-codes`, `GET /admin/qr-codes/:id`, `GET /admin/qr-codes/:id/print.pdf`, `POST /admin/qr-codes/:id/revoke`; `POST /student/attendance/scan` (meal + date chosen by the server, geofence, one per meal), `GET /student/attendance/today|calendar|history`; `GET /admin/attendance/daily|monthly`, `POST /admin/attendance/manual`.
Database tests: `tests/db` runs all migrations on PGlite (real PostgreSQL in-process) and checks constraints, triggers, `approve_payment`, the status job, read functions and RLS. Migration `0008_attendance_functions.sql` was added (apply it after 0006).
Subscriptions + jobs (done, tested with mocks): `GET /student/subscription` (active / expiring_soon / scheduled / expired / none, judged by DATES so a late job cannot give wrong answers), `GET /student/subscriptions`, `GET /admin/subscriptions` (filters, expiring window, search), `GET /admin/subscriptions/:id`, `POST /admin/subscriptions/:id/cancel` (any admin; reason, audit, notifies the student, warns if a renewal is queued behind it). Cron jobs (`ENABLE_JOBS=true`, single instance): nightly status refresh at 00:05 + catch-up at startup, expiry reminders at 09:00 (once per student per subscription).
Students + dashboards + notifications (done, API tested with mocks; SQL tested on real Postgres): `GET/PATCH /student/me`, `PUT/DELETE /student/me/profile-image`, `GET /student/dashboard`; `GET /admin/students` (search, status, subscription state, sort), `GET /admin/students/:id`, `PATCH /admin/students/:id/status` (reason, audit, Supabase ban), `GET /admin/students/:id/subscriptions|payments|attendance`, `GET /admin/dashboard`; `GET /notifications`, `POST /notifications/:id/read|read-all`, `POST /devices/push-token[/unregister]`. Migration `0009_dashboard_and_student_list.sql` added (apply after 0008).
Reports + PDFs (done, tested with mocks; PDFs generated and inspected for real): `GET /admin/reports/overview`, `GET /admin/reports/attendance-monthly.pdf`, `attendance-daily.pdf`, `payments.pdf`, `student-statement.pdf` (A4, mess header, "Generated … by <admin>", "Page X of Y", repeated table headers, 300 students ≈ 10 pages; every download is audited as `report.download`; 10/min/user).
Admins management + audit log (done, tested with mocks): `GET/POST /admin/admins`, `PATCH /admin/admins/:id`, `GET /admin/audit-logs` (all super admin only). Creating an admin makes a pre-verified Supabase login + the `admins` row (rolled back on failure); nobody can change their own role/enabled flag; the last active super admin is protected.

**Backend API is complete.** Next: clean up and build the two apps (Student App first), then deployment on the VPS.

### Supabase settings the auth module relies on
- Auth → Providers → Email: **Confirm email ON**, minimum password length 8.
- Auth → Email templates: *Confirm signup* and *Reset password* must show `{{ .Token }}` (6-digit code), not the link.
- Auth → SMTP: Google SMTP (`smtp.gmail.com`, App Password).
- Create the first super admin manually (see `database-schema.md` §10); there is no admin sign-up endpoint.
