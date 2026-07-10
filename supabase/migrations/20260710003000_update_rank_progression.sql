alter table public.player_rank
alter column division set default 'Alto Primata III';

update public.player_rank
set division = case
  when rank_points >= 3150 then 'Primordial'
  when rank_points >= 2650 then 'Arcanjo'
  when rank_points >= 2250 then 'Desperto'
  when rank_points >= 1950 then 'Ouro I'
  when rank_points >= 1650 then 'Ouro II'
  when rank_points >= 1350 then 'Ouro III'
  when rank_points >= 1150 then 'Prata I'
  when rank_points >= 950 then 'Prata II'
  when rank_points >= 750 then 'Prata III'
  when rank_points >= 600 then 'Bronze I'
  when rank_points >= 450 then 'Bronze II'
  when rank_points >= 300 then 'Bronze III'
  when rank_points >= 200 then 'Alto Primata I'
  when rank_points >= 100 then 'Alto Primata II'
  else 'Alto Primata III'
end;

update public.character_unlock_rules
set required_division = case
  when required_points >= 3150 then 'Primordial'
  when required_points >= 2650 then 'Arcanjo'
  when required_points >= 2250 then 'Desperto'
  when required_points >= 1950 then 'Ouro I'
  when required_points >= 1650 then 'Ouro II'
  when required_points >= 1350 then 'Ouro III'
  when required_points >= 1150 then 'Prata I'
  when required_points >= 950 then 'Prata II'
  when required_points >= 750 then 'Prata III'
  when required_points >= 600 then 'Bronze I'
  when required_points >= 450 then 'Bronze II'
  when required_points >= 300 then 'Bronze III'
  when required_points >= 200 then 'Alto Primata I'
  when required_points >= 100 then 'Alto Primata II'
  else 'Alto Primata III'
end;
