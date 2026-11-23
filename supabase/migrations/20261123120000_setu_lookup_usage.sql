-- Usage counter for the GSTIN lookup proxy (setu-gstin-proxy).
-- Protects the API Setu bill: each install has a daily cap, and the whole service has a daily cap.
-- Only the service role can touch this table or the function; no client can read or write it.

create table if not exists public.setu_lookup_usage (
  day date not null,
  install_id text not null,      -- '*' is the global row for the whole service
  count integer not null default 0 check (count >= 0),
  primary key (day, install_id)
);

alter table public.setu_lookup_usage enable row level security;
-- No policies: anon and authenticated roles get nothing.

-- Atomically takes one lookup from the install's and the service's daily allowance.
-- Returns false, and takes nothing, when either cap is reached.
create or replace function public.setu_consume_lookup(
  p_install text,
  p_per_install integer,
  p_global integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  insert into public.setu_lookup_usage (day, install_id, count)
  values (today, '*', 0)
  on conflict (day, install_id) do nothing;

  update public.setu_lookup_usage
  set count = count + 1
  where day = today and install_id = '*' and count < p_global;
  if not found then
    return false;
  end if;

  insert into public.setu_lookup_usage (day, install_id, count)
  values (today, p_install, 1)
  on conflict (day, install_id)
    do update set count = public.setu_lookup_usage.count + 1
    where public.setu_lookup_usage.count < p_per_install;
  if not found then
    update public.setu_lookup_usage
    set count = count - 1
    where day = today and install_id = '*';
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.setu_consume_lookup(text, integer, integer) from public, anon, authenticated;
grant execute on function public.setu_consume_lookup(text, integer, integer) to service_role;
