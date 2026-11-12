-- =====================================================================================================
-- Darse de baja y contraseñas provisionales. Se pega en Supabase → SQL Editor → New query → Run, después de 001.
--
-- 1. Darse de baja (Ajustes → Mi cuenta):
--   · Se borra lo privado: tareas, notas, proyectos y releases que no están en un espacio, y las fichas, ajustes y
--     registro personales. Lo que se había compartido por mención desaparece también para quien lo veía.
--   · Lo que está en un espacio se queda para el equipo (sigue siendo del espacio).
--   · Si era la única administradora de un espacio con más gente, pasa a administrarlo otra persona del espacio.
--     Si era la única persona del espacio, el espacio se borra con su contenido.
--   · No se puede si es la única administradora de la herramienta y hay más cuentas.
--   · Al final se borra el usuario de Supabase Auth (y con él el perfil, "Mi día" y recordatorios).
-- =====================================================================================================

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s record;
begin
  if uid is null then raise exception 'Inicia sesión.' using errcode = '42501'; end if;

  if exists (select 1 from profiles where id = uid and is_admin)
     and not exists (select 1 from profiles where id <> uid and is_admin and not disabled)
     and exists (select 1 from profiles where id <> uid) then
    raise exception 'Eres la única persona administradora: antes nombra a otra (Ajustes → Administración).';
  end if;

  for s in select m.space_id, m.role,
                  (select count(*) from space_members x where x.space_id = m.space_id) as members,
                  (select count(*) from space_members x where x.space_id = m.space_id and x.role = 'admin') as admins
             from space_members m where m.user_id = uid loop
    if s.members = 1 then
      delete from records where space_id = s.space_id;
      delete from spaces where id = s.space_id;
    elsif s.role = 'admin' and s.admins = 1 then
      update space_members set role = 'admin'
       where space_id = s.space_id
         and user_id = (select user_id from space_members where space_id = s.space_id and user_id <> uid order by user_id limit 1);
    end if;
  end loop;

  -- Lo privado se marca como borrado (así quien lo tenía compartido por mención se entera) y lo personal se elimina.
  update records set data = null where scope = '' and owner = uid and space_id is null and data is not null;
  delete from records where scope = uid::text;

  delete from auth.users where id = uid;   -- en cascada: perfil, miembros de espacios y overlays
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- =====================================================================================================
-- 2. Contraseña provisional (Ajustes → Administración). No depende del email: el email gratuito de Supabase solo
--    llega a quien está en la organización de Supabase y permite muy pocos envíos por hora. La contraseña se genera
--    aquí, se devuelve una sola vez para pasársela a la persona y se cierran sus sesiones abiertas.
-- =====================================================================================================

create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_set_password(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_password text := new_code() || '-' || new_code();
begin
  perform require_admin();
  if not exists (select 1 from profiles where id = p_user) then raise exception 'Esa cuenta no existe.'; end if;
  update auth.users set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')) where id = p_user;
  if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using p_user; end if;
  return v_password;
end $$;

revoke execute on function public.admin_set_password(uuid) from public, anon;
grant execute on function public.admin_set_password(uuid) to authenticated;
