-- A resolved turn must not consume the next turn's choice time while clients
-- preload and play its animation. The deployed resolver still writes `active`;
-- this trigger converts that transition into a two-client readiness barrier.
create or replace function public.prepare_next_turn_readiness()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active'
    and old.status = 'resolving'
    and new.current_turn > old.current_turn
    and new.last_turn is distinct from old.last_turn
  then
    new.status = 'resolving';
    new.turn_deadline_at = null;
    new.player1_ready_at = null;
    new.player2_ready_at = null;
  end if;

  return new;
end;
$$;

drop trigger if exists zz_prepare_next_turn_readiness on public.matches;
create trigger zz_prepare_next_turn_readiness
before update on public.matches
for each row
execute function public.prepare_next_turn_readiness();

create or replace function public.mark_match_turn_ready(
  p_match_id uuid,
  p_turn_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_match public.matches%rowtype;
  ready_now timestamptz := clock_timestamp();
  turn_seconds integer;
  activated boolean := false;
begin
  select *
  into current_match
  from public.matches
  where id = p_match_id
  for update;

  if not found
    or auth.uid() is null
    or (auth.uid() <> current_match.player1_id and auth.uid() <> current_match.player2_id)
  then
    raise exception 'Partida nao encontrada.';
  end if;

  if current_match.status <> 'resolving'
    or current_match.current_turn <> p_turn_number
  then
    return jsonb_build_object('accepted', false, 'activated', false);
  end if;

  if auth.uid() = current_match.player1_id then
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
    turn_seconds := case
      when current_match.state->>'activeGuaranteedTurn' is not null then 3
      else 5
    end;

    update public.matches
    set status = 'active',
        turn_deadline_at = ready_now + make_interval(secs => turn_seconds)
    where id = p_match_id
      and status = 'resolving'
      and current_turn = p_turn_number;
    activated := found;
  end if;

  return jsonb_build_object('accepted', true, 'activated', activated);
end;
$$;

revoke all on function public.mark_match_turn_ready(uuid, integer) from public, anon;
grant execute on function public.mark_match_turn_ready(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
