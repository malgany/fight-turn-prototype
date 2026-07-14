insert into public.characters (id, name, portrait_url, enabled, is_default, sort_order)
values
  ('iop', 'Iop', '/assets/ui/character-select/fighter-iop.png', true, true, 50)
on conflict (id) do update set
  name = excluded.name,
  portrait_url = excluded.portrait_url,
  enabled = excluded.enabled,
  is_default = excluded.is_default,
  sort_order = excluded.sort_order;

insert into public.character_unlock_rules (character_id, required_division, required_points, description)
values
  ('iop', 'Autoprimata III', 0, 'Disponivel desde o inicio')
on conflict (character_id) do update set
  required_division = excluded.required_division,
  required_points = excluded.required_points,
  description = excluded.description;

insert into public.player_unlocked_characters (user_id, character_id, reason)
select id, 'iop', 'default'
from public.profiles
on conflict (user_id, character_id) do nothing;
