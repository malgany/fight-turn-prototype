update public.matches
set
  status = 'active',
  turn_deadline_at = now() + interval '15 seconds',
  updated_at = now()
where status in ('active', 'resolving');
