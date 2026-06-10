do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ranked_queue'
  ) then
    alter publication supabase_realtime add table public.ranked_queue;
  end if;
end $$;
