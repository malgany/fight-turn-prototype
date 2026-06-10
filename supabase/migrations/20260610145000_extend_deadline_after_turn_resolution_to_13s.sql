create or replace function public.extend_match_deadline_after_turn_resolution()
returns trigger
language plpgsql
as $$
begin
  if
    new.status = 'active'
    and old.current_turn is not null
    and new.current_turn > old.current_turn
    and new.last_turn is not null
  then
    new.turn_deadline_at = greatest(new.turn_deadline_at, now() + interval '13 seconds');
  end if;

  return new;
end;
$$;

update public.matches
set turn_deadline_at = now() + interval '13 seconds'
where status = 'active'
  and turn_deadline_at < now() + interval '5 seconds';
