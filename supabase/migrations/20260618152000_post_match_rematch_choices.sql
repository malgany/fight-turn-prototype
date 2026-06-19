alter table public.matches
add column if not exists rematch_choices jsonb not null default '{}'::jsonb,
add column if not exists rematch_next_match_id uuid references public.matches(id);

create index if not exists matches_rematch_next_match_id_idx
on public.matches(rematch_next_match_id);
