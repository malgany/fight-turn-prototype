alter table public.profiles
add column if not exists display_name_updated_at timestamptz;

drop policy if exists "profiles update own lightweight fields" on public.profiles;

create or replace function public.preserve_custom_profile_display_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.display_name_updated_at is not null
     and new.display_name_updated_at is not distinct from old.display_name_updated_at
     and new.display_name is distinct from old.display_name then
    new.display_name := old.display_name;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_preserve_custom_display_name on public.profiles;
create trigger profiles_preserve_custom_display_name
before update on public.profiles
for each row execute function public.preserve_custom_profile_display_name();

create or replace function public.update_profile_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_name text := btrim(coalesce(p_display_name, ''));
  last_changed_at timestamptz;
  current_name text;
begin
  if auth.uid() is null then
    raise exception 'Sessão ausente.';
  end if;

  if normalized_name !~ '^[A-Za-z0-9]{4,15}$' then
    raise exception 'Use de 4 a 15 caracteres, somente letras e números, sem espaços.';
  end if;

  select display_name, display_name_updated_at
    into current_name, last_changed_at
    from public.profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'Perfil não encontrado.';
  end if;

  if normalized_name = current_name then
    raise exception 'Digite um nome diferente do atual.';
  end if;

  if last_changed_at is not null and last_changed_at > now() - interval '24 hours' then
    raise exception 'O nome só pode ser alterado uma vez a cada 24 horas.';
  end if;

  update public.profiles
     set display_name = normalized_name,
         display_name_updated_at = now()
   where id = auth.uid();
end;
$$;

revoke all on function public.update_profile_display_name(text) from public;
grant execute on function public.update_profile_display_name(text) to authenticated;
