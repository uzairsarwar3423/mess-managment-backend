-- ---------------------------------------------------------------- messes
create table messes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 100),
  code        text not null unique check (code ~ '^[a-z0-9-]{2,30}$'),
  timezone    text not null default 'Asia/Karachi',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- admins
create table admins (
  id          uuid primary key references auth.users(id) on delete cascade,
  mess_id     uuid not null references messes(id),
  email       citext not null,
  full_name   text not null check (char_length(full_name) between 2 and 100),
  phone       text,
  role        text not null default 'admin',
  is_active   boolean not null default true,
  created_by  uuid references admins(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint admins_email_key unique (email),
  constraint ck_admins_role check (role in ('admin', 'super_admin'))
);

-- ---------------------------------------------------------------- mess_settings
create table mess_settings (
  mess_id                   uuid primary key references messes(id) on delete cascade,
  monthly_fee               numeric(10,2) not null default 8500.00 check (monthly_fee > 0),
  currency                  char(3)  not null default 'PKR',
  subscription_days         smallint not null default 30 check (subscription_days between 1 and 366),
  lunch_start               time not null default '10:00',
  lunch_end                 time not null default '16:00',
  dinner_start              time not null default '16:45',
  dinner_end                time not null default '20:45',
  expiry_reminder_days      smallint not null default 3  check (expiry_reminder_days between 0 and 14),
  payment_instructions      text,
  geofence_enabled          boolean not null default false,
  latitude                  numeric(9,6) check (latitude  between -90  and 90),
  longitude                 numeric(9,6) check (longitude between -180 and 180),
  geofence_radius_m         smallint not null default 150 check (geofence_radius_m between 20 and 2000),
  updated_by                uuid references admins(id),
  updated_at                timestamptz not null default now(),
  constraint ck_settings_lunch_window   check (lunch_end > lunch_start),
  constraint ck_settings_dinner_window  check (dinner_end > dinner_start),
  constraint ck_settings_no_overlap     check (lunch_end <= dinner_start),
  constraint ck_settings_geofence       check (not geofence_enabled or (latitude is not null and longitude is not null))
);

-- ---------------------------------------------------------------- payment_accounts
create table payment_accounts (
  id             uuid primary key default gen_random_uuid(),
  mess_id        uuid not null references messes(id),
  method         text not null,
  account_title  text not null check (char_length(account_title) between 2 and 100),
  account_number text not null check (char_length(account_number) between 4 and 40),
  bank_name      text,
  merchant_name  text,
  instructions   text,
  display_order  smallint not null default 0,
  is_active      boolean not null default true,
  created_by     uuid references admins(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ck_payment_accounts_method check (method in ('easypaisa', 'jazzcash', 'nayapay', 'sadapay', 'bank')),
  constraint ck_payment_accounts_bank   check (method <> 'bank' or bank_name is not null)
);

-- ---------------------------------------------------------------- students
create sequence student_code_seq start 1;

create table students (
  id                       uuid primary key references auth.users(id) on delete cascade,
  mess_id                  uuid not null references messes(id),
  student_code             text not null unique
                             default ('S' || lpad(nextval('student_code_seq')::text, 5, '0')),
  email                    citext not null,
  full_name                text not null check (char_length(full_name) between 2 and 100),
  phone                    text check (phone is null or phone ~ '^(\+92|0)3[0-9]{9}$'),
  roll_number              text,
  profile_image_url        text,
  profile_image_public_id  text,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint students_email_key unique (email)
);

-- ---------------------------------------------------------------- payments
create table payments (
  id                    uuid primary key default gen_random_uuid(),
  mess_id               uuid not null references messes(id),
  student_id            uuid not null references students(id) on delete restrict,
  payment_account_id    uuid not null references payment_accounts(id) on delete restrict,
  method                text not null,
  paid_to               jsonb not null,
  amount                numeric(10,2) not null check (amount > 0),
  transaction_id        text not null,
  screenshot_public_id  text not null,
  screenshot_url        text not null,
  screenshot_etag       text,
  screenshot_bytes      integer check (screenshot_bytes > 0),
  status                text not null default 'pending',
  rejection_reason      text,
  submitted_at          timestamptz not null default now(),
  reviewed_by           uuid references admins(id),
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ck_payments_method check (method in ('easypaisa', 'jazzcash', 'nayapay', 'sadapay', 'bank')),
  constraint ck_payments_txn    check (transaction_id ~ '^[A-Za-z0-9-]{6,40}$'),
  constraint ck_payments_status check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint ck_payments_review_fields check (
    (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
    or
    (status in ('pending', 'cancelled') and reviewed_by is null and reviewed_at is null)
  ),
  constraint ck_payments_rejection_reason check (
    (status = 'rejected' and rejection_reason is not null and char_length(btrim(rejection_reason)) >= 5)
    or
    (status <> 'rejected' and rejection_reason is null)
  )
);

-- ---------------------------------------------------------------- subscriptions
create table subscriptions (
  id            uuid primary key default gen_random_uuid(),
  mess_id       uuid not null references messes(id),
  student_id    uuid not null references students(id) on delete restrict,
  payment_id    uuid not null unique references payments(id) on delete restrict,
  start_date    date not null,
  end_date      date not null,
  status        text not null,
  amount        numeric(10,2) not null check (amount > 0),
  cancelled_at  timestamptz,
  cancelled_by  uuid references admins(id),
  cancel_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ck_subscriptions_status check (status in ('scheduled', 'active', 'expired', 'cancelled')),
  constraint ck_subscriptions_dates  check (end_date >= start_date),
  constraint ck_subscriptions_cancel check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint ex_subscriptions_no_overlap exclude using gist (
    student_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('scheduled', 'active'))
);

-- ---------------------------------------------------------------- qr_codes (printed static QR codes)
create table qr_codes (
  id             uuid primary key default gen_random_uuid(),
  mess_id        uuid not null references messes(id),
  label          text not null check (char_length(label) between 2 and 60),
  status         text not null default 'active',
  created_by     uuid not null references admins(id),
  created_at     timestamptz not null default now(),
  revoked_by     uuid references admins(id),
  revoked_at     timestamptz,
  revoke_reason  text,
  constraint ck_qr_status  check (status in ('active', 'revoked')),
  constraint ck_qr_revoked check (
    (status = 'active'  and revoked_at is null     and revoked_by is null     and revoke_reason is null)
    or
    (status = 'revoked' and revoked_at is not null and revoked_by is not null and revoke_reason is not null)
  )
);

-- ---------------------------------------------------------------- attendance
create table attendance (
  id               uuid primary key default gen_random_uuid(),
  mess_id          uuid not null references messes(id),
  student_id       uuid not null references students(id) on delete restrict,
  subscription_id  uuid not null references subscriptions(id) on delete restrict,
  qr_code_id       uuid references qr_codes(id) on delete restrict,
  meal_type        text not null,
  attendance_date  date not null,
  marked_at        timestamptz not null default now(),
  source           text not null default 'qr',
  marked_by        uuid references admins(id),
  scan_distance_m  integer check (scan_distance_m >= 0),
  created_at       timestamptz not null default now(),
  constraint ck_attendance_meal   check (meal_type in ('lunch', 'dinner')),
  constraint ck_attendance_source check (source in ('qr', 'manual')),
  constraint ck_attendance_source_fields check (
    (source = 'qr'     and qr_code_id is not null and marked_by is null)
    or
    (source = 'manual' and marked_by is not null)
  ),
  -- BR-03 / BR-06: one row per student per date per meal, enforced by the database
  constraint uq_attendance_student_date_meal unique (student_id, attendance_date, meal_type)
);

-- ---------------------------------------------------------------- notifications
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  mess_id     uuid not null references messes(id),
  student_id  uuid not null references students(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}'::jsonb,
  is_read     boolean not null default false,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint ck_notifications_type check (type in (
    'payment_approved', 'payment_rejected', 'subscription_expiring', 'subscription_expired', 'general'))
);

-- ---------------------------------------------------------------- push_tokens
create table push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  token         text not null unique,
  platform      text not null default 'android' check (platform = 'android'),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- audit_logs
create table audit_logs (
  id           bigint generated always as identity primary key,
  mess_id      uuid references messes(id),
  actor_id     uuid,
  actor_role   text check (actor_role in ('student', 'admin', 'super_admin', 'system')),
  action       text not null,
  entity_type  text,
  entity_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- updated_at triggers
create trigger trg_messes_updated        before update on messes        for each row execute function set_updated_at();
create trigger trg_admins_updated        before update on admins        for each row execute function set_updated_at();
create trigger trg_mess_settings_updated before update on mess_settings for each row execute function set_updated_at();
create trigger trg_students_updated      before update on students      for each row execute function set_updated_at();
create trigger trg_payments_updated      before update on payments      for each row execute function set_updated_at();
create trigger trg_subscriptions_updated before update on subscriptions for each row execute function set_updated_at();
create trigger trg_payment_accounts_updated before update on payment_accounts for each row execute function set_updated_at();
