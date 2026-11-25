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
