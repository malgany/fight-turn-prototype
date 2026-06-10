create or replace function public.finish_match_after_three_inactive_turns()
returns trigger
language plpgsql
as $$
declare
  inactive_turns integer;
  inactivity_result jsonb;
begin
  if
    new.status = 'active'
    and new.current_turn > old.current_turn
    and new.last_turn is not null
    and new.last_turn->>'primary' = 'TEMPO ESGOTADO'
    and new.last_turn->>'p1Action' is null
    and new.last_turn->>'p2Action' is null
  then
    select count(*)
    into inactive_turns
    from public.match_turns recent
    where recent.match_id = new.id
      and recent.turn_number between new.current_turn - 3 and new.current_turn - 1
      and recent.p1_action is null
      and recent.p2_action is null;

    if inactive_turns = 3 then
      inactivity_result = jsonb_set(
        jsonb_set(new.last_turn, '{primary}', to_jsonb('PARTIDA ENCERRADA'::text), true),
        '{secondary}',
        to_jsonb('Tres turnos sem acao. Empate sem perda de pontos.'::text),
        true
      );

      new.status = 'finished';
      new.winner_id = null;
      new.loser_id = null;
      new.rank_delta = '{}'::jsonb;
      new.private_score = null;
      new.finished_reason = 'inactivity_draw';
      new.finished_at = now();
      new.turn_deadline_at = now();
      new.last_turn = inactivity_result;

      update public.online_presence
      set status = 'online',
          match_id = null,
          last_seen_at = now()
      where user_id in (new.player1_id, new.player2_id);

      insert into public.match_history (
        match_id,
        user_id,
        opponent_id,
        match_type,
        character_id,
        opponent_character_id,
        result,
        rank_delta
      )
      select
        new.id,
        player_id,
        opponent_id,
        new.match_type,
        character_id,
        opponent_character_id,
        'draw',
        0
      from (
        values
          (new.player1_id, new.player2_id, new.player1_character_id, new.player2_character_id),
          (new.player2_id, new.player1_id, new.player2_character_id, new.player1_character_id)
      ) as rows(player_id, opponent_id, character_id, opponent_character_id)
      where not exists (
        select 1
        from public.match_history mh
        where mh.match_id = new.id
          and mh.user_id = rows.player_id
      );
    end if;
  end if;

  return new;
end;
$$;
