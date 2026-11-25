-- ============================================================================
-- MESS DATABASE: ALL-IN-ONE SETUP (paste this whole file into Supabase > SQL Editor > Run)
-- Contains migrations 0001, 0002, 0003, 0004, 0005, 0006, 0008, 0009 and the starting data.
-- Run it ONCE on an empty project.
-- ============================================================================

-- ---------- 0001_extensions_and_helpers.sql ----------
create extension if not exists btree_gist;   -- needed for the subscription overlap exclusion constraint
create extension if not exists citext;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- 0002_core_tables.sql ----------
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

-- ---------- 0003_indexes.sql ----------
create index idx_admins_mess_active              on admins (mess_id, is_active);

create index idx_students_mess_active            on students (mess_id, is_active);
create index idx_students_mess_created           on students (mess_id, created_at desc);

-- BR-08: a student may have only one pending payment
create unique index uq_payments_one_pending_per_student
  on payments (student_id) where status = 'pending';
-- BR-10: a transaction id can back only one pending/approved payment per receiving account (case-insensitive)
create unique index uq_payments_transaction
  on payments (payment_account_id, upper(transaction_id)) where status in ('pending', 'approved');
create index idx_payments_mess_status_submitted  on payments (mess_id, status, submitted_at desc);
create index idx_payments_student_submitted      on payments (student_id, submitted_at desc);
create index idx_payment_accounts_mess_active    on payment_accounts (mess_id, is_active, display_order);
create index idx_payments_etag                   on payments (mess_id, screenshot_etag) where screenshot_etag is not null;

create index idx_subscriptions_student_end       on subscriptions (student_id, end_date desc);
create index idx_subscriptions_mess_status_end   on subscriptions (mess_id, status, end_date);

-- active QR labels are unique within a mess
create unique index uq_qr_label_active
  on qr_codes (mess_id, lower(label)) where status = 'active';
create index idx_qr_mess_status                  on qr_codes (mess_id, status);

create index idx_attendance_mess_date_meal       on attendance (mess_id, attendance_date, meal_type);
create index idx_attendance_subscription         on attendance (subscription_id);
create index idx_attendance_qr                   on attendance (qr_code_id);
-- (student_id, attendance_date, meal_type) is already indexed by uq_attendance_student_date_meal

create index idx_notifications_student_created   on notifications (student_id, created_at desc);
create index idx_notifications_unread            on notifications (student_id) where not is_read;

create index idx_push_tokens_user                on push_tokens (user_id);

create index idx_audit_mess_created              on audit_logs (mess_id, created_at desc);
create index idx_audit_entity                    on audit_logs (entity_type, entity_id);
create index idx_audit_actor_created             on audit_logs (actor_id, created_at desc);
create index idx_audit_action                    on audit_logs (action);

-- ---------- 0004_functions.sql ----------
-- ===== Audit log is append-only =====
create or replace function prevent_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

create trigger trg_audit_no_update before update or delete on audit_logs
  for each row execute function prevent_audit_mutation();

-- ===== BR-04 at database level: attendance must reference a valid subscription =====
create or replace function validate_attendance()
returns trigger language plpgsql as $$
declare
  v_sub subscriptions;
begin
  select * into v_sub from subscriptions where id = new.subscription_id;
  if not found
     or v_sub.student_id <> new.student_id
     or v_sub.status = 'cancelled'
     or new.attendance_date < v_sub.start_date
     or new.attendance_date > v_sub.end_date then
    raise exception 'ATTENDANCE_NOT_COVERED_BY_SUBSCRIPTION' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_attendance_validate before insert on attendance
  for each row execute function validate_attendance();

-- ===== Approve a payment and activate the subscription atomically (BR-05, BR-11, BR-12, BR-19) =====
create or replace function approve_payment(p_payment_id uuid, p_admin_id uuid)
returns subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment   payments;
  v_admin     admins;
  v_settings  mess_settings;
  v_tz        text;
  v_today     date;
  v_last_end  date;
  v_start     date;
  v_sub       subscriptions;
begin
  -- lock the payment row: concurrent approve/reject/cancel serialize here
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'PAYMENT_NOT_PENDING' using errcode = 'P0001';
  end if;

  select * into v_admin from admins
   where id = p_admin_id and is_active and mess_id = v_payment.mess_id;
  if not found then
    raise exception 'ADMIN_NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_settings from mess_settings where mess_id = v_payment.mess_id;
  select timezone into v_tz from messes where id = v_payment.mess_id;
  v_today := (now() at time zone v_tz)::date;

  -- serialize subscription creation per student
  perform 1 from students where id = v_payment.student_id for update;

  -- renewal extends current/scheduled coverage (BR-12)
  select max(end_date) into v_last_end
    from subscriptions
   where student_id = v_payment.student_id
     and status in ('active', 'scheduled')
     and end_date >= v_today;

  v_start := case when v_last_end is null then v_today else v_last_end + 1 end;

  insert into subscriptions (mess_id, student_id, payment_id, start_date, end_date, status, amount)
  values (
    v_payment.mess_id, v_payment.student_id, v_payment.id,
    v_start,
    v_start + (v_settings.subscription_days - 1),
    case when v_start <= v_today then 'active' else 'scheduled' end,
    v_payment.amount
  )
  returning * into v_sub;

  update payments
     set status = 'approved', reviewed_by = p_admin_id, reviewed_at = now()
   where id = p_payment_id;

  insert into audit_logs (mess_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
  values (
    v_payment.mess_id, p_admin_id, v_admin.role, 'payment.approve', 'payment', p_payment_id,
    jsonb_build_object(
      'student_id', v_payment.student_id,
      'amount', v_payment.amount,
      'method', v_payment.method,
      'transaction_id', v_payment.transaction_id,
      'subscription_id', v_sub.id,
      'start_date', v_sub.start_date,
      'end_date', v_sub.end_date
    )
  );

  return v_sub;
end;
$$;

-- ===== Daily status refresh (called by the nightly job; correctness never depends on it) =====
create or replace function refresh_subscription_statuses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired   integer;
  v_activated integer;
begin
  update subscriptions s
     set status = 'expired'
    from messes m
   where s.mess_id = m.id
     and s.status = 'active'
     and s.end_date < (now() at time zone m.timezone)::date;
  get diagnostics v_expired = row_count;

  update subscriptions s
     set status = 'active'
    from messes m
   where s.mess_id = m.id
     and s.status = 'scheduled'
     and s.start_date <= (now() at time zone m.timezone)::date;
  get diagnostics v_activated = row_count;

  return v_expired + v_activated;
end;
$$;

-- Only the backend (service_role) may execute these
revoke execute on function approve_payment(uuid, uuid)       from public, anon, authenticated;
revoke execute on function refresh_subscription_statuses()   from public, anon, authenticated;
grant  execute on function approve_payment(uuid, uuid)       to service_role;
grant  execute on function refresh_subscription_statuses()   to service_role;

-- ---------- 0005_rls.sql ----------
-- ===== helper functions (security definer so policies don't recurse into RLS) =====
create or replace function current_mess_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select mess_id from admins   where id = auth.uid() and is_active),
    (select mess_id from students where id = auth.uid() and is_active)
  );
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where id = auth.uid() and is_active);
$$;

create or replace function is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where id = auth.uid() and is_active and role = 'super_admin');
$$;

revoke execute on function current_mess_id(), is_admin(), is_super_admin() from public, anon;
grant  execute on function current_mess_id(), is_admin(), is_super_admin() to authenticated;

-- ===== lock everything down, then grant minimal read access =====
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table messes         enable row level security;
alter table mess_settings  enable row level security;
alter table admins         enable row level security;
alter table students       enable row level security;
alter table payments       enable row level security;
alter table subscriptions  enable row level security;
alter table qr_codes       enable row level security;
alter table payment_accounts enable row level security;
alter table attendance     enable row level security;
alter table notifications  enable row level security;
alter table push_tokens    enable row level security;   -- no policy => no client access
alter table audit_logs     enable row level security;

grant select on messes, mess_settings, payment_accounts, admins, students, payments, subscriptions,
                qr_codes, attendance, notifications, audit_logs to authenticated;

-- messes / settings: anyone in the mess may read (students need fee, windows, payment accounts)
create policy messes_select on messes for select to authenticated
  using (id = (select current_mess_id()));
create policy mess_settings_select on mess_settings for select to authenticated
  using (mess_id = (select current_mess_id()));

-- payment accounts: everyone in the mess may read the active ones (students need them to pay)
create policy payment_accounts_select on payment_accounts for select to authenticated
  using (mess_id = (select current_mess_id()) and (is_active or (select is_admin())));

-- admins: self, or super admin within mess
create policy admins_select_self on admins for select to authenticated
  using (id = (select auth.uid()));
create policy admins_select_super on admins for select to authenticated
  using ((select is_super_admin()) and mess_id = (select current_mess_id()));

-- students: self, or any admin within mess
create policy students_select_self on students for select to authenticated
  using (id = (select auth.uid()));
create policy students_select_admin on students for select to authenticated
  using ((select is_admin()) and mess_id = (select current_mess_id()));

-- payments / subscriptions / attendance: owner, or any admin within mess
create policy payments_select_own on payments for select to authenticated
  using (student_id = (select auth.uid()));
create policy payments_select_admin on payments for select to authenticated
  using ((select is_admin()) and mess_id = (select current_mess_id()));

create policy subscriptions_select_own on subscriptions for select to authenticated
  using (student_id = (select auth.uid()));
create policy subscriptions_select_admin on subscriptions for select to authenticated
  using ((select is_admin()) and mess_id = (select current_mess_id()));

create policy attendance_select_own on attendance for select to authenticated
  using (student_id = (select auth.uid()));
create policy attendance_select_admin on attendance for select to authenticated
  using ((select is_admin()) and mess_id = (select current_mess_id()));

-- qr_codes: admins only
create policy qr_codes_select_admin on qr_codes for select to authenticated
  using ((select is_admin()) and mess_id = (select current_mess_id()));

-- notifications: owner only
create policy notifications_select_own on notifications for select to authenticated
  using (student_id = (select auth.uid()));

-- audit_logs: super admin only
create policy audit_logs_select_super on audit_logs for select to authenticated
  using ((select is_super_admin()) and mess_id = (select current_mess_id()));

-- NOTE: there are intentionally NO insert/update/delete policies and NO table grants for writes.
-- All writes go through the backend using the service_role key (which bypasses RLS).

-- ---------- 0006_report_functions.sql ----------
-- Monthly per-student attendance totals. Includes students with any attendance in the month
-- or a non-cancelled subscription overlapping the month (so absentees appear with zeros).
create or replace function report_monthly_attendance(p_mess_id uuid, p_month date)
returns table (
  student_id    uuid,
  student_code  text,
  full_name     text,
  lunch_count   integer,
  dinner_count  integer,
  total_count   integer
)
language sql stable
as $$
  with b as (
    select date_trunc('month', p_month)::date                         as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date - 1 as m_end
  )
  select s.id, s.student_code, s.full_name,
         (count(a.id) filter (where a.meal_type = 'lunch'))::integer,
         (count(a.id) filter (where a.meal_type = 'dinner'))::integer,
         count(a.id)::integer
    from students s
   cross join b
    left join attendance a
           on a.student_id = s.id
          and a.attendance_date between b.m_start and b.m_end
   where s.mess_id = p_mess_id
     and (
       a.id is not null
       or exists (
         select 1 from subscriptions sub
          where sub.student_id = s.id
            and sub.status <> 'cancelled'
            and sub.start_date <= b.m_end
            and sub.end_date   >= b.m_start)
     )
   group by s.id, s.student_code, s.full_name
   order by s.full_name;
$$;

-- Month overview for the Reports screen.
create or replace function report_overview(p_mess_id uuid, p_month date)
returns jsonb
language sql stable
as $$
  with m as (select timezone as tz from messes where id = p_mess_id),
       b as (select date_trunc('month', p_month)::date                      as m_start,
                    (date_trunc('month', p_month) + interval '1 month')::date as m_next)
  select jsonb_build_object(
    'month', to_char(b.m_start, 'YYYY-MM'),
    'revenue', (
      select coalesce(sum(p.amount), 0) from payments p, m
       where p.mess_id = p_mess_id and p.status = 'approved'
         and (p.reviewed_at at time zone m.tz)::date >= b.m_start
         and (p.reviewed_at at time zone m.tz)::date <  b.m_next),
    'payments_approved', (
      select count(*) from payments p, m
       where p.mess_id = p_mess_id and p.status = 'approved'
         and (p.reviewed_at at time zone m.tz)::date >= b.m_start
         and (p.reviewed_at at time zone m.tz)::date <  b.m_next),
    'payments_rejected', (
      select count(*) from payments p, m
       where p.mess_id = p_mess_id and p.status = 'rejected'
         and (p.reviewed_at at time zone m.tz)::date >= b.m_start
         and (p.reviewed_at at time zone m.tz)::date <  b.m_next),
    'lunch_total', (
      select count(*) from attendance a
       where a.mess_id = p_mess_id and a.meal_type = 'lunch'
         and a.attendance_date >= b.m_start and a.attendance_date < b.m_next),
    'dinner_total', (
      select count(*) from attendance a
       where a.mess_id = p_mess_id and a.meal_type = 'dinner'
         and a.attendance_date >= b.m_start and a.attendance_date < b.m_next),
    'students_with_coverage', (
      select count(distinct s.student_id) from subscriptions s
       where s.mess_id = p_mess_id and s.status <> 'cancelled'
         and s.start_date < b.m_next and s.end_date >= b.m_start),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'lunch', d.lunch, 'dinner', d.dinner)
                                order by d.day), '[]'::jsonb)
        from (
          select a.attendance_date as day,
                 count(*) filter (where a.meal_type = 'lunch')  as lunch,
                 count(*) filter (where a.meal_type = 'dinner') as dinner
            from attendance a
           where a.mess_id = p_mess_id
             and a.attendance_date >= b.m_start and a.attendance_date < b.m_next
           group by a.attendance_date) d)
  )
  from b;
$$;

revoke execute on function report_monthly_attendance(uuid, date), report_overview(uuid, date) from public, anon, authenticated;
grant  execute on function report_monthly_attendance(uuid, date), report_overview(uuid, date) to service_role;

-- ---------- 0008_attendance_functions.sql ----------
-- 0008: read-side helpers for attendance and QR codes (called by the backend with the service role).

-- ---------------------------------------------------------------------------------------------
-- Eligible students for a date (active student + a non-cancelled subscription covering the date)
-- and whether each has marked the given meal. Powers the admin daily screen:
--   present/eligible/not_marked counts and the "not yet marked" list.
-- ---------------------------------------------------------------------------------------------
create or replace function eligible_attendance_status(p_mess_id uuid, p_date date, p_meal text)
returns table (
  student_id    uuid,
  student_code  text,
  full_name     text,
  marked        boolean
)
language sql stable
as $$
  select s.id,
         s.student_code,
         s.full_name,
         exists (
           select 1 from attendance a
            where a.student_id = s.id
              and a.attendance_date = p_date
              and a.meal_type = p_meal
         ) as marked
    from students s
   where s.mess_id = p_mess_id
     and s.is_active
     and exists (
       select 1 from subscriptions sub
        where sub.student_id = s.id
          and sub.status in ('active', 'scheduled')
          and sub.start_date <= p_date
          and sub.end_date   >= p_date
     )
   order by s.full_name;
$$;

-- ---------------------------------------------------------------------------------------------
-- Monthly per-student totals with the day-by-day marks ({"01":"LD","02":"L"}).
-- Includes students with attendance in the month, or a non-cancelled subscription overlapping it.
-- ---------------------------------------------------------------------------------------------
create or replace function monthly_attendance_marks(p_mess_id uuid, p_month date)
returns table (
  student_id    uuid,
  student_code  text,
  full_name     text,
  lunch_count   integer,
  dinner_count  integer,
  total_count   integer,
  marks         jsonb
)
language sql stable
as $$
  with b as (
    select date_trunc('month', p_month)::date                        as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date as m_next
  ),
  month_rows as (
    select a.student_id, a.attendance_date, a.meal_type
      from attendance a, b
     where a.mess_id = p_mess_id
       and a.attendance_date >= b.m_start
       and a.attendance_date <  b.m_next
  ),
  totals as (
    select student_id,
           count(*) filter (where meal_type = 'lunch')  as l,
           count(*) filter (where meal_type = 'dinner') as d
      from month_rows
     group by student_id
  ),
  per_day as (
    select student_id,
           extract(day from attendance_date)::int as dom,
           -- 'lunch' > 'dinner' alphabetically, so DESC puts L before D -> 'LD'
           string_agg(case meal_type when 'lunch' then 'L' else 'D' end, '' order by meal_type desc) as m
      from month_rows
     group by student_id, extract(day from attendance_date)
  ),
  marks_by_student as (
    select student_id, jsonb_object_agg(lpad(dom::text, 2, '0'), m) as marks
      from per_day
     group by student_id
  )
  select s.id,
         s.student_code,
         s.full_name,
         coalesce(t.l, 0)::integer,
         coalesce(t.d, 0)::integer,
         (coalesce(t.l, 0) + coalesce(t.d, 0))::integer,
         coalesce(m.marks, '{}'::jsonb)
    from students s
    cross join b
    left join totals t           on t.student_id = s.id
    left join marks_by_student m on m.student_id = s.id
   where s.mess_id = p_mess_id
     and (
       t.student_id is not null
       or exists (
         select 1 from subscriptions sub
          where sub.student_id = s.id
            and sub.status <> 'cancelled'
            and sub.start_date <  b.m_next
            and sub.end_date   >= b.m_start)
     )
   order by s.full_name;
$$;

-- ---------------------------------------------------------------------------------------------
-- Scan statistics per QR code (admin QR list): scans on a date, total scans, last scan time.
-- ---------------------------------------------------------------------------------------------
create or replace function qr_scan_stats(p_mess_id uuid, p_date date)
returns table (
  qr_code_id    uuid,
  scans_today   integer,
  scans_total   integer,
  last_scan_at  timestamptz
)
language sql stable
as $$
  select q.id,
         (count(a.id) filter (where a.attendance_date = p_date))::integer,
         count(a.id)::integer,
         max(a.marked_at)
    from qr_codes q
    left join attendance a on a.qr_code_id = q.id
   where q.mess_id = p_mess_id
   group by q.id;
$$;

revoke execute on function
  eligible_attendance_status(uuid, date, text),
  monthly_attendance_marks(uuid, date),
  qr_scan_stats(uuid, date)
  from public, anon, authenticated;
grant execute on function
  eligible_attendance_status(uuid, date, text),
  monthly_attendance_marks(uuid, date),
  qr_scan_stats(uuid, date)
  to service_role;

-- ---------- 0009_dashboard_and_student_list.sql ----------
-- 0009: aggregate reads for the admin dashboard and the admin student list (service_role only).

-- ---------------------------------------------------------------------------------------------
-- Admin dashboard numbers in ONE round trip.
--  expiring_soon = students whose current period ends on/before p_expiring_by and who have NOT
--  renewed (no later non-cancelled period). revenue_month = approved payments decided in the month
--  (mess-local dates).
-- ---------------------------------------------------------------------------------------------
create or replace function admin_dashboard_counts(
  p_mess_id      uuid,
  p_date         date,
  p_month_start  date,
  p_month_next   date,
  p_expiring_by  date
)
returns table (
  lunch_today                         integer,
  dinner_today                        integer,
  active_students                     integer,
  students_with_active_subscription   integer,
  pending_payments                    integer,
  expiring_soon                       integer,
  revenue_month                       numeric,
  active_qr_codes                     integer
)
language sql stable
as $$
  select
    (select count(*) from attendance a
      where a.mess_id = p_mess_id and a.attendance_date = p_date and a.meal_type = 'lunch')::integer,
    (select count(*) from attendance a
      where a.mess_id = p_mess_id and a.attendance_date = p_date and a.meal_type = 'dinner')::integer,
    (select count(*) from students s
      where s.mess_id = p_mess_id and s.is_active)::integer,
    (select count(distinct sub.student_id) from subscriptions sub
       join students s on s.id = sub.student_id
      where sub.mess_id = p_mess_id and s.is_active
        and sub.status in ('active', 'scheduled')
        and sub.start_date <= p_date and sub.end_date >= p_date)::integer,
    (select count(*) from payments p
      where p.mess_id = p_mess_id and p.status = 'pending')::integer,
    (select count(distinct sub.student_id) from subscriptions sub
       join students s on s.id = sub.student_id
      where sub.mess_id = p_mess_id and s.is_active
        and sub.status in ('active', 'scheduled')
        and sub.start_date <= p_date and sub.end_date >= p_date
        and sub.end_date <= p_expiring_by
        and not exists (
          select 1 from subscriptions nxt
           where nxt.student_id = sub.student_id
             and nxt.status in ('active', 'scheduled')
             and nxt.start_date > sub.end_date))::integer,
    (select coalesce(sum(p.amount), 0) from payments p
       join messes m on m.id = p.mess_id
      where p.mess_id = p_mess_id and p.status = 'approved'
        and (p.reviewed_at at time zone m.timezone)::date >= p_month_start
        and (p.reviewed_at at time zone m.timezone)::date <  p_month_next),
    (select count(*) from qr_codes q
      where q.mess_id = p_mess_id and q.status = 'active')::integer;
$$;

-- ---------------------------------------------------------------------------------------------
-- Admin student list: search + filters + each student's subscription state, paged, with the total.
--   p_active   null | true | false         (student account enabled?)
--   p_sub      null | active | expiring | expired | scheduled | none   (state judged by DATES at p_today)
--   p_sort     name | code | created_at
-- A student's "state" comes from the period covering p_today, otherwise the one that ends last.
-- ---------------------------------------------------------------------------------------------
create or replace function admin_list_students(
  p_mess_id      uuid,
  p_today        date,
  p_q            text,
  p_active       boolean,
  p_sub          text,
  p_expiring_by  date,
  p_sort         text,
  p_limit        integer,
  p_offset       integer
)
returns table (
  id                     uuid,
  student_code           text,
  email                  text,
  full_name              text,
  phone                  text,
  roll_number            text,
  profile_image_url      text,
  is_active              boolean,
  created_at             timestamptz,
  subscription_status    text,
  subscription_end_date  date,
  total_count            bigint
)
language sql stable
as $$
  with best as (
    select distinct on (sub.student_id)
           sub.student_id, sub.start_date, sub.end_date
      from subscriptions sub
     where sub.mess_id = p_mess_id and sub.status <> 'cancelled'
     order by sub.student_id,
              (sub.start_date <= p_today and sub.end_date >= p_today) desc,
              sub.end_date desc
  ),
  joined as (
    select s.id, s.student_code, s.email::text as email, s.full_name, s.phone, s.roll_number,
           s.profile_image_url, s.is_active, s.created_at,
           case when b.student_id is null  then 'none'
                when b.end_date   < p_today then 'expired'
                when b.start_date > p_today then 'scheduled'
                else 'active' end as sub_status,
           b.end_date as sub_end
      from students s
      left join best b on b.student_id = s.id
     where s.mess_id = p_mess_id
       and (p_active is null or s.is_active = p_active)
       and (
         p_q is null or p_q = ''
         or position(lower(p_q) in lower(s.full_name))    > 0
         or position(lower(p_q) in lower(s.student_code)) > 0
         or position(lower(p_q) in lower(s.email::text))  > 0
         or position(lower(p_q) in coalesce(s.phone, '')) > 0
       )
  ),
  filtered as (
    select * from joined j
     where p_sub is null
        or (p_sub = 'active'   and j.sub_status = 'active')
        or (p_sub = 'expiring' and j.sub_status = 'active' and j.sub_end <= p_expiring_by)
        or (p_sub in ('expired', 'scheduled', 'none') and j.sub_status = p_sub)
  )
  select f.id, f.student_code, f.email, f.full_name, f.phone, f.roll_number, f.profile_image_url,
         f.is_active, f.created_at, f.sub_status, f.sub_end,
         count(*) over ()
    from filtered f
   order by case p_sort when 'name' then f.full_name    end asc,
            case p_sort when 'code' then f.student_code end asc,
            case p_sort when 'created_at' then f.created_at end desc,
            f.full_name asc
   limit p_limit offset p_offset;
$$;

revoke execute on function
  admin_dashboard_counts(uuid, date, date, date, date),
  admin_list_students(uuid, date, text, boolean, text, date, text, integer, integer)
  from public, anon, authenticated;
grant execute on function
  admin_dashboard_counts(uuid, date, date, date, date),
  admin_list_students(uuid, date, text, boolean, text, date, text, integer, integer)
  to service_role;

-- ---------- seed: the one mess ----------
with m as (
  insert into messes (name, code) values ('Main Mess', 'main') returning id
)
insert into mess_settings (mess_id) select id from m;   -- defaults: fee 8500, 30 days, Lunch 10:00-16:00, Dinner 16:45-20:45

-- ---------- RESULT: copy this id into DEFAULT_MESS_ID in your .env ----------
select id as "COPY_THIS_INTO_DEFAULT_MESS_ID" from messes where code = 'main';
