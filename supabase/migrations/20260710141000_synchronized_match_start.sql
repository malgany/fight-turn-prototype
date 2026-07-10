alter table public.matches
drop constraint if exists matches_status_check;

alter table public.matches
add constraint matches_status_check
check (status in ('waiting', 'selecting', 'loading', 'active', 'resolving', 'finished', 'forfeited'));

alter table public.matches
alter column turn_deadline_at drop not null,
add column if not exists player1_ready_at timestamptz,
add column if not exists player2_ready_at timestamptz,
add column if not exists loading_deadline_at timestamptz,
add column if not exists battle_start_at timestamptz;

create or replace function public.mark_match_ready(p_match_id uuid, p_user_id uuid)
returns setof public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  current_match public.matches%rowtype;
  ready_now timestamptz := clock_timestamp();
  scheduled_start timestamptz;
begin
  select *
  into current_match
  from public.matches
  where id = p_match_id
  for update;

  if not found
    or (p_user_id <> current_match.player1_id and p_user_id <> current_match.player2_id)
  then
    raise exception 'Partida nao encontrada.';
  end if;

  if current_match.status = 'loading'
    and current_match.loading_deadline_at is not null
    and current_match.loading_deadline_at <= ready_now
  then
    update public.matches
    set status = 'finished',
        winner_id = null,
        loser_id = null,
        rank_delta = '{}'::jsonb,
        private_score = null,
        finished_reason = 'load_timeout',
        finished_at = ready_now,
        turn_deadline_at = null,
        battle_start_at = null
    where id = p_match_id;

    update public.online_presence
    set status = 'online',
        match_id = null,
        last_seen_at = ready_now
    where user_id in (current_match.player1_id, current_match.player2_id);

    update public.profiles
    set presence_status = 'online'
    where id in (current_match.player1_id, current_match.player2_id);

    return query select matches.* from public.matches where id = p_match_id;
    return;
  end if;

  if current_match.status <> 'loading' then
    return query select matches.* from public.matches where id = p_match_id;
    return;
  end if;

  if p_user_id = current_match.player1_id then
    update public.matches
    set player1_ready_at = coalesce(player1_ready_at, ready_now)
    where id = p_match_id
    returning * into current_match;
  else
    update public.matches
    set player2_ready_at = coalesce(player2_ready_at, ready_now)
    where id = p_match_id
    returning * into current_match;
  end if;

  if current_match.player1_ready_at is not null
    and current_match.player2_ready_at is not null
  then
    scheduled_start := clock_timestamp() + interval '5 seconds';
    update public.matches
    set status = 'active',
        battle_start_at = scheduled_start,
        turn_deadline_at = scheduled_start + interval '5 seconds'
    where id = p_match_id
    returning * into current_match;
  end if;

  return query select matches.* from public.matches where id = p_match_id;
end;
$$;

revoke all on function public.mark_match_ready(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_match_ready(uuid, uuid) to service_role;
