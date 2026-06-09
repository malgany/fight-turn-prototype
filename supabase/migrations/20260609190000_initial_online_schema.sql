create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.characters (
  id text primary key,
  name text not null,
  portrait_url text not null,
  enabled boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.character_unlock_rules (
  character_id text primary key references public.characters(id) on delete cascade,
  required_division text not null default 'Bronze',
  required_points integer not null default 0,
  description text not null default ''
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  account_type text not null default 'guest' check (account_type in ('guest', 'google')),
  selected_character_id text not null references public.characters(id),
  presence_status text not null default 'online' check (presence_status in ('online', 'in_queue', 'in_match', 'offline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table public.player_rank (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  rank_points integer not null default 0 check (rank_points >= 0),
  division text not null default 'Bronze',
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  streak integer not null default 0 check (streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  updated_at timestamptz not null default now()
);

create trigger player_rank_set_updated_at
before update on public.player_rank
for each row execute function public.set_updated_at();

create table public.player_unlocked_characters (
  user_id uuid not null references public.profiles(id) on delete cascade,
  character_id text not null references public.characters(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  reason text not null default 'default',
  primary key (user_id, character_id)
);

create table public.ranked_queue (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  selected_character_id text not null references public.characters(id),
  rank_points_snapshot integer not null default 0,
  status text not null default 'waiting' check (status in ('waiting', 'matched', 'cancelled')),
  match_id uuid,
  queued_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ranked_queue_set_updated_at
before update on public.ranked_queue
for each row execute function public.set_updated_at();

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  match_type text not null check (match_type in ('ranked', 'private', 'casual')),
  status text not null default 'active' check (status in ('waiting', 'active', 'resolving', 'finished', 'forfeited')),
  player1_id uuid not null references public.profiles(id),
  player2_id uuid not null references public.profiles(id),
  player1_character_id text not null references public.characters(id),
  player2_character_id text not null references public.characters(id),
  current_turn integer not null default 1 check (current_turn >= 1),
  turn_deadline_at timestamptz not null,
  state jsonb not null,
  last_turn jsonb,
  winner_id uuid references public.profiles(id),
  loser_id uuid references public.profiles(id),
  rank_delta jsonb not null default '{}'::jsonb,
  private_score jsonb,
  room_code text,
  finished_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index matches_player1_id_idx on public.matches(player1_id);
create index matches_player2_id_idx on public.matches(player2_id);
create index matches_status_idx on public.matches(status);
create index matches_room_code_idx on public.matches(room_code);

create trigger matches_set_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

alter table public.ranked_queue
add constraint ranked_queue_match_id_fkey
foreign key (match_id) references public.matches(id) on delete set null;

create table public.match_actions (
  match_id uuid not null references public.matches(id) on delete cascade,
  turn_number integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('Poke', 'Combo', 'Grab', 'Special', 'Super', 'Block', 'Crouch', 'Jump')),
  submitted_at timestamptz not null default now(),
  primary key (match_id, turn_number, user_id)
);

create table public.match_turns (
  match_id uuid not null references public.matches(id) on delete cascade,
  turn_number integer not null,
  p1_action text,
  p2_action text,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, turn_number)
);

create table public.private_rooms (
  code text primary key,
  host_id uuid not null references public.profiles(id) on delete cascade,
  guest_id uuid references public.profiles(id) on delete set null,
  match_id uuid references public.matches(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'expired', 'closed')),
  expires_at timestamptz not null default now() + interval '2 hours',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger private_rooms_set_updated_at
before update on public.private_rooms
for each row execute function public.set_updated_at();

create table public.private_match_scores (
  player_low_id uuid not null references public.profiles(id) on delete cascade,
  player_high_id uuid not null references public.profiles(id) on delete cascade,
  player_low_wins integer not null default 0,
  player_high_wins integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_low_id, player_high_id),
  check (player_low_id < player_high_id)
);

create trigger private_match_scores_set_updated_at
before update on public.private_match_scores
for each row execute function public.set_updated_at();

create table public.match_history (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id uuid not null references public.profiles(id) on delete cascade,
  match_type text not null check (match_type in ('ranked', 'private', 'casual')),
  character_id text not null references public.characters(id),
  opponent_character_id text not null references public.characters(id),
  result text not null check (result in ('win', 'loss', 'draw')),
  rank_delta integer not null default 0,
  rank_points_after integer,
  created_at timestamptz not null default now()
);

create table public.online_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'online' check (status in ('online', 'in_queue', 'in_match', 'offline')),
  match_id uuid references public.matches(id) on delete set null,
  last_seen_at timestamptz not null default now()
);

insert into public.characters (id, name, portrait_url, enabled, is_default, sort_order)
values
  ('ninja', 'Ninja', '/assets/ui/character-select/fighter-ninja.webp', true, true, 10),
  ('itzcoatl', 'Itzcoatl', '/assets/ui/character-select/fighter-shaman.webp', true, true, 20),
  ('aton', 'Aton', '/assets/ui/character-select/fighter-urban.webp', true, true, 30),
  ('coming-soon', 'Em breve', '/assets/ui/character-select/fighter-coming-soon-face-question.webp', false, false, 90)
on conflict (id) do update set
  name = excluded.name,
  portrait_url = excluded.portrait_url,
  enabled = excluded.enabled,
  is_default = excluded.is_default,
  sort_order = excluded.sort_order;

insert into public.character_unlock_rules (character_id, required_division, required_points, description)
values
  ('ninja', 'Bronze', 0, 'Disponivel desde o inicio'),
  ('itzcoatl', 'Bronze', 0, 'Disponivel desde o inicio'),
  ('aton', 'Bronze', 0, 'Disponivel desde o inicio'),
  ('coming-soon', 'Gold', 800, 'Personagem futuro por ranking')
on conflict (character_id) do update set
  required_division = excluded.required_division,
  required_points = excluded.required_points,
  description = excluded.description;

create or replace view public.leaderboard
with (security_invoker = true)
as
select
  row_number() over (order by pr.rank_points desc, pr.wins desc, pr.best_streak desc, p.created_at asc)::integer as position,
  p.id as user_id,
  p.display_name,
  p.avatar_url,
  pr.rank_points,
  pr.division,
  pr.wins,
  pr.losses,
  pr.streak
from public.player_rank pr
join public.profiles p on p.id = pr.user_id
order by pr.rank_points desc, pr.wins desc, pr.best_streak desc, p.created_at asc;

create or replace view public.match_history_view
with (security_invoker = true)
as
select
  mh.id,
  mh.match_id,
  mh.user_id,
  opponent.display_name as opponent_name,
  mh.match_type,
  mh.character_id,
  mh.opponent_character_id,
  mh.result,
  mh.rank_delta,
  mh.rank_points_after,
  mh.created_at
from public.match_history mh
join public.profiles opponent on opponent.id = mh.opponent_id
where mh.user_id = auth.uid();

alter table public.characters enable row level security;
alter table public.character_unlock_rules enable row level security;
alter table public.profiles enable row level security;
alter table public.player_rank enable row level security;
alter table public.player_unlocked_characters enable row level security;
alter table public.ranked_queue enable row level security;
alter table public.matches enable row level security;
alter table public.match_actions enable row level security;
alter table public.match_turns enable row level security;
alter table public.private_rooms enable row level security;
alter table public.private_match_scores enable row level security;
alter table public.match_history enable row level security;
alter table public.online_presence enable row level security;

create policy "characters are readable" on public.characters for select to authenticated using (true);
create policy "unlock rules are readable" on public.character_unlock_rules for select to authenticated using (true);

create policy "profiles readable to authenticated users" on public.profiles for select to authenticated using (true);
create policy "profiles update own lightweight fields" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "rank readable to authenticated users" on public.player_rank for select to authenticated using (true);

create policy "unlocks readable to owner" on public.player_unlocked_characters for select to authenticated using (user_id = auth.uid());

create policy "queue readable to owner" on public.ranked_queue for select to authenticated using (user_id = auth.uid());

create policy "matches readable to participants" on public.matches
for select to authenticated
using (auth.uid() in (player1_id, player2_id));

create policy "own actions readable before reveal" on public.match_actions
for select to authenticated
using (user_id = auth.uid());

create policy "turns readable to participants" on public.match_turns
for select to authenticated
using (
  exists (
    select 1 from public.matches m
    where m.id = match_id
      and auth.uid() in (m.player1_id, m.player2_id)
  )
);

create policy "private rooms readable to participants" on public.private_rooms
for select to authenticated
using (auth.uid() in (host_id, guest_id));

create policy "private scores readable to participants" on public.private_match_scores
for select to authenticated
using (auth.uid() in (player_low_id, player_high_id));

create policy "history readable to owner" on public.match_history
for select to authenticated
using (user_id = auth.uid());

create policy "presence readable to authenticated users" on public.online_presence
for select to authenticated
using (true);
