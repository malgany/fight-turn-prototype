update public.matches
set
  status = 'active',
  turn_deadline_at = now() + interval '5 seconds',
  updated_at = now()
where status = 'resolving';
