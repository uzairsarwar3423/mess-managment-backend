-- Run AFTER you created your login in Supabase: Authentication > Users > Add user.
-- 1) Change the email below to the SAME email you used there. 2) Run in SQL Editor.
insert into admins (id, mess_id, email, full_name, role)
select u.id,
       (select id from messes where code = 'main'),
       u.email,
       'Mess Owner',            -- <- change to your name
       'super_admin'
from auth.users u
where u.email = 'owner@example.com';   -- <- change to your email

select id, email, role from admins;    -- you should see 1 row
