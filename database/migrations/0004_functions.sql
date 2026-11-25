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
