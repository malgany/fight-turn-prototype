create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.cleanup_expired_game_data()
returns table (
  deleted_private_rooms bigint,
  deleted_ranked_queue_rows bigint,
  deleted_matches bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_private_rooms bigint := 0;
  removed_ranked_queue_rows bigint := 0;
  removed_matches bigint := 0;
begin
  -- Avoid overlapping manual and scheduled cleanup runs.
  if not pg_try_advisory_xact_lock(hashtextextended('final-genesis-data-retention', 0)) then
    return query select 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  -- A private room expires after two hours. Keep it for one extra day so a
  -- delayed client can still show a useful expired/finished state.
  with removed as (
    delete from public.private_rooms room
    where room.expires_at < now() - interval '24 hours'
      and (
        room.match_id is null
        or exists (
          select 1
          from public.matches match
          where match.id = room.match_id
            and match.status in ('finished', 'forfeited')
        )
      )
    returning 1
  )
  select count(*) into removed_private_rooms from removed;

  -- Queue rows are operational state, not player history. Preserve waiting
  -- rows and recent transitions so reconnecting clients continue to work.
  with removed as (
    delete from public.ranked_queue queue
    where queue.status in ('matched', 'cancelled')
      and queue.updated_at < now() - interval '24 hours'
      and (
        queue.match_id is null
        or exists (
          select 1
          from public.matches match
          where match.id = queue.match_id
            and match.status in ('finished', 'forfeited')
        )
      )
    returning 1
  )
  select count(*) into removed_ranked_queue_rows from removed;

  -- Finished match rows are retained for a full year. Cascading foreign keys
  -- remove their actions, resolved turns, and per-player history together.
  -- Live/selecting/loading/resolving matches are never eligible.
  with removed as (
    delete from public.matches match
    where match.status in ('finished', 'forfeited')
      and coalesce(match.finished_at, match.updated_at, match.created_at)
        < now() - interval '365 days'
    returning 1
  )
  select count(*) into removed_matches from removed;

  return query
  select removed_private_rooms, removed_ranked_queue_rows, removed_matches;
end;
$$;

revoke all on function public.cleanup_expired_game_data() from public, anon, authenticated;
grant execute on function public.cleanup_expired_game_data() to service_role;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'final-genesis-data-retention';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'final-genesis-data-retention',
    '17 7 * * *',
    'select public.cleanup_expired_game_data();'
  );
end;
$$;
