alter table public.player_rank
alter column division set default 'Autoprimata III';

update public.player_rank
set division = replace(division, 'Altoprimata', 'Autoprimata')
where division like 'Altoprimata%';

update public.character_unlock_rules
set required_division = replace(required_division, 'Altoprimata', 'Autoprimata')
where required_division like 'Altoprimata%';
