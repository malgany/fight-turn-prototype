create or replace function public.server_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

grant execute on function public.server_now() to anon;
grant execute on function public.server_now() to authenticated;
