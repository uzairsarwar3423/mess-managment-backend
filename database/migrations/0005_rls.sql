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
