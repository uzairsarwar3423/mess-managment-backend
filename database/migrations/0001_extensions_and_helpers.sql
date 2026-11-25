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
