create or replace function public.submit_match_action(
  p_match_id uuid,
  p_action text,
  p_turn_number integer default null
)
returns table(match_id uuid, turn_number integer, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_match public.matches%rowtype;
  player_side text;
  guaranteed_turn jsonb;
  super_charge integer;
begin
  if current_user_id is null then
    raise exception 'Sessao ausente.';
  end if;

  select *
  into current_match
  from public.matches
  where id = p_match_id;

  if not found
    or current_user_id not in (current_match.player1_id, current_match.player2_id)
  then
    raise exception 'Partida nao encontrada.';
  end if;

  if not (p_action = any (array['Poke', 'Combo', 'Grab', 'Special', 'Super', 'Block', 'Crouch', 'Jump'])) then
    raise exception 'Acao invalida.';
  end if;

  if current_match.status <> 'active'
    or (current_match.battle_start_at is not null and current_match.battle_start_at > clock_timestamp())
    or (p_turn_number is not null and p_turn_number <> current_match.current_turn)
    or current_match.turn_deadline_at is null
    or current_match.turn_deadline_at + interval '1200 milliseconds' < clock_timestamp()
  then
    return;
  end if;

  player_side := case when current_user_id = current_match.player1_id then 'p1' else 'p2' end;
  guaranteed_turn := current_match.state -> 'activeGuaranteedTurn';

  if guaranteed_turn is not null and guaranteed_turn <> 'null'::jsonb then
    if guaranteed_turn ->> 'side' <> player_side
      or not exists (
        select 1
        from jsonb_array_elements_text(coalesce(guaranteed_turn -> 'allowedActions', '[]'::jsonb)) allowed(value)
        where allowed.value = p_action
      )
    then
      raise exception 'Acao nao permitida neste turno.';
    end if;
  end if;

  if p_action = 'Super' then
    super_charge := coalesce((current_match.state -> player_side ->> 'super')::integer, 0);
    if super_charge < 3 then
      raise exception 'Acao nao permitida neste turno.';
    end if;
  end if;

  insert into public.match_actions (match_id, turn_number, user_id, action, submitted_at)
  values (current_match.id, current_match.current_turn, current_user_id, p_action, clock_timestamp())
  on conflict on constraint match_actions_pkey
  do update set action = excluded.action, submitted_at = excluded.submitted_at;

  return query
  select current_match.id, current_match.current_turn, p_action;
end;
$$;

revoke all on function public.submit_match_action(uuid, text, integer) from public, anon;
grant execute on function public.submit_match_action(uuid, text, integer) to authenticated;
