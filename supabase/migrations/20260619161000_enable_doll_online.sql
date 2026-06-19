insert into public.characters (id, name, portrait_url, enabled, is_default, sort_order)
values
  ('doll', 'Doll.exe', '/assets/ui/character-select/fighter-doll.png', true, true, 40),
  ('coming-soon', 'Em breve', '/assets/ui/character-select/fighter-coming-soon-face-question.webp', false, false, 90)
on conflict (id) do update set
  name = excluded.name,
  portrait_url = excluded.portrait_url,
  enabled = excluded.enabled,
  is_default = excluded.is_default,
  sort_order = excluded.sort_order;

insert into public.character_unlock_rules (character_id, required_division, required_points, description)
values
  ('doll', 'Bronze', 0, 'Disponivel desde o inicio'),
  ('coming-soon', 'Gold', 800, 'Personagem futuro por ranking')
on conflict (character_id) do update set
  required_division = excluded.required_division,
  required_points = excluded.required_points,
  description = excluded.description;

insert into public.player_unlocked_characters (user_id, character_id, reason)
select id, 'doll', 'default'
from public.profiles
on conflict (user_id, character_id) do nothing;
