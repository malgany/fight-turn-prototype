alter table public.matches
drop constraint if exists matches_status_check;

alter table public.matches
add constraint matches_status_check
check (status in ('waiting', 'selecting', 'active', 'resolving', 'finished', 'forfeited'));

alter table public.matches
alter column player1_character_id drop not null,
alter column player2_character_id drop not null;
