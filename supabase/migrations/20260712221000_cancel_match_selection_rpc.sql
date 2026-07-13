create or replace function public.cancel_match_selection(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.matches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sessão ausente.';
  end if;

  select *
    into match_row
    from public.matches
   where id = p_match_id
   for update;

  if not found or auth.uid() not in (match_row.player1_id, match_row.player2_id) then
    raise exception 'Partida não encontrada.';
  end if;

  if match_row.status not in ('finished', 'forfeited') then
    if match_row.status not in ('selecting', 'loading', 'active') then
      raise exception 'A seleção de personagem não pode mais ser cancelada.';
    end if;

    update public.matches
       set status = 'forfeited',
           winner_id = null,
           loser_id = null,
           rank_delta = '{}'::jsonb,
           private_score = null,
           finished_reason = 'selection_cancelled',
           finished_at = now(),
           turn_deadline_at = null,
           loading_deadline_at = null,
           battle_start_at = null
     where id = match_row.id;
  end if;

  update public.ranked_queue
     set status = 'cancelled', match_id = null
   where user_id in (match_row.player1_id, match_row.player2_id)
     and match_id = match_row.id;

  update public.private_rooms
     set status = 'closed'
   where match_id = match_row.id;

  update public.profiles
     set presence_status = 'online'
   where id in (match_row.player1_id, match_row.player2_id);

  insert into public.online_presence (user_id, status, match_id, last_seen_at)
  values
    (match_row.player1_id, 'online', null, now()),
    (match_row.player2_id, 'online', null, now())
  on conflict (user_id) do update
    set status = excluded.status,
        match_id = null,
        last_seen_at = excluded.last_seen_at;
end;
$$;

revoke all on function public.cancel_match_selection(uuid) from public, anon;
grant execute on function public.cancel_match_selection(uuid) to authenticated;
