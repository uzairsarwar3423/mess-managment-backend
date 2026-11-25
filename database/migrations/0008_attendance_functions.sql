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
