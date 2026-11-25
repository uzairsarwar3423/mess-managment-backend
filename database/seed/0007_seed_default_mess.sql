-- 0007_seed_default_mess.sql (run once per environment)
with m as (
  insert into messes (name, code) values ('Main Mess', 'main') returning id
)
insert into mess_settings (mess_id) select id from m;   -- defaults: fee 8500, 30 days, Lunch 10:00-16:00, Dinner 16:45-20:45
-- Copy the generated messes.id into the backend env var DEFAULT_MESS_ID.
