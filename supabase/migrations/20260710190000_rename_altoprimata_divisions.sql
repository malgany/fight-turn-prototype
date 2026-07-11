alter table public.player_rank
alter column division set default 'Altoprimata III';

update public.player_rank
set division = case
  when rank_points >= 200 then 'Altoprimata I'
  when rank_points >= 100 then 'Altoprimata II'
  else 'Altoprimata III'
end
where rank_points < 300;

update public.character_unlock_rules
set required_division = case
  when required_points >= 200 then 'Altoprimata I'
  when required_points >= 100 then 'Altoprimata II'
  else 'Altoprimata III'
end
where required_points < 300;
