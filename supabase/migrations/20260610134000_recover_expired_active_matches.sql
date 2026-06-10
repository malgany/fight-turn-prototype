update public.matches
set
  turn_deadline_at = now() + interval '15 seconds',
  updated_at = now()
where status = 'active'
  and turn_deadline_at <= now();
