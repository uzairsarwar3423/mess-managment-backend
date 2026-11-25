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
