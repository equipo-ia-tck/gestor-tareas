-- =====================================================================================================
-- Gestor de tareas del equipo · base de datos en Supabase
--
-- Se pega una vez en Supabase → SQL Editor → New query → Run. Crea las tablas, las reglas de privacidad
-- (Row Level Security) y las funciones que usa la app. Las mismas reglas que tenía el servidor propio:
--   · todo es privado de quien lo crea;
--   · lo que está en un proyecto de un ESPACIO lo ven y editan todos sus miembros (los subproyectos heredan);
--   · una tarea o nota que MENCIONA una cuenta (nombre completo o email) se le comparte, con su proyecto;
--   · "Mi día" y recordatorios (overlays), fichas de persona, ajustes y registro son de cada persona;
--   · tipos/estados y colores de etiquetas son comunes y solo los cambian los administradores.
-- La app escribe solo a través de push_changes() y de las funciones de espacios y administración: nadie puede
-- escribir directamente en las tablas.
-- =====================================================================================================

-- ---------------------------------------------------------------- Tablas

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  login text not null unique,            -- email, en minúsculas
  name text not null,                    -- nombre completo (es el que se usa al mencionar)
  is_admin boolean not null default false,
  disabled boolean not null default false,
  access_version bigint not null default 0,  -- sube cuando cambia lo que puede ver: la app lo recarga todo
  created_at timestamptz not null default now()
);

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#6366f1',
  invite_code text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  primary key (space_id, user_id)
);

-- Ajustes del servidor (el código de administración). Solo los leen los administradores.
create table if not exists public.app_settings (k text primary key, v text not null);

create sequence if not exists public.record_version;

-- Todos los datos de la app (tareas, notas, proyectos…) como documentos JSON, igual que en el navegador.
create table if not exists public.records (
  tbl text not null check (tbl in ('tasks', 'notes', 'projects', 'releases', 'settings', 'people', 'activity', 'item_types', 'labels')),
  key text not null,
  scope text not null default '',        -- tablas personales: id del dueño; el resto: ''
  owner uuid,                            -- quien lo creó (null en las tablas comunes)
  data jsonb,                            -- null = borrado
  version bigint not null default 0,
  space_id uuid,                         -- espacio (calculado a partir del proyecto)
  mentions uuid[] not null default '{}', -- cuentas mencionadas (calculado a partir de "people")
  updated_at timestamptz not null default now(),
  primary key (tbl, key, scope)
);
create index if not exists records_version on public.records (version);
create index if not exists records_project on public.records ((data ->> 'project_id')) where tbl in ('tasks', 'notes', 'releases');
create index if not exists records_parent on public.records ((data ->> 'parent_id')) where tbl = 'projects';
create index if not exists records_space on public.records (space_id);

-- "Mi día" y recordatorio de cada persona en cada tarea (aunque la tarea esté compartida).
create table if not exists public.overlays (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tbl text not null,
  key text not null,
  data jsonb not null,
  version bigint not null default 0,
  primary key (user_id, tbl, key)
);

-- ---------------------------------------------------------------- Funciones auxiliares

-- Igual que nameKey() de la app: sin tildes ni mayúsculas, espacios y guiones iguales.
create or replace function public.name_key(s text) returns text
language sql immutable as $$
  select regexp_replace(lower(trim(translate(coalesce(s, ''),
    'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
    'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc'))), '[[:space:]_-]+', '-', 'g')
$$;

create or replace function public.new_code() returns text
language sql volatile as $$
  select upper(substr(md5(random()::text), 1, 4) || '-' || substr(md5(random()::text), 1, 4))
$$;

create or replace function public.me_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and not disabled)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_admin and not disabled)
$$;

create or replace function public.is_member(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from space_members where space_id = p_space and user_id = auth.uid())
$$;

create or replace function public.as_uuid(s text) returns uuid
language sql immutable as $$
  select case when s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then s::uuid end
$$;

-- Espacio de un proyecto: el suyo o el del primer antepasado que lo tenga.
create or replace function public.space_of_project(p_key text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  k text := p_key;
  d jsonb;
  i int := 0;
begin
  while k is not null and i < 10 loop
    select data into d from records where tbl = 'projects' and key = k and scope = '';
    if d is null then return null; end if;
    if as_uuid(d ->> 'space_id') is not null then return as_uuid(d ->> 'space_id'); end if;
    k := d ->> 'parent_id';
    i := i + 1;
  end loop;
  return null;
end $$;

-- Cuentas mencionadas en "people": por nombre completo o por usuario (email). No basta el nombre de pila.
create or replace function public.mentions_of(p_people jsonb) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}')
  from profiles p
  where exists (
    select 1 from jsonb_array_elements_text(case when jsonb_typeof(p_people) = 'array' then p_people else '[]'::jsonb end) e(v)
    where name_key(e.v) = name_key(p.name) or name_key(e.v) = name_key(p.login)
  )
$$;

-- ¿Puede la persona con sesión ver este registro?
create or replace function public.can_see(r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when r.scope <> '' then r.scope = auth.uid()::text
    when r.tbl in ('item_types', 'labels') then true
    else r.owner = auth.uid()
      or (r.space_id is not null and is_member(r.space_id))
      or auth.uid() = any (r.mentions)
      -- El proyecto y la release de lo que me han compartido por mención, para que se entienda.
      or (r.tbl = 'projects' and exists (
        select 1 from records t where t.scope = '' and t.tbl in ('tasks', 'notes') and t.data ->> 'project_id' = r.key and auth.uid() = any (t.mentions)))
      or (r.tbl = 'releases' and exists (
        select 1 from records t where t.scope = '' and t.tbl = 'tasks' and t.data ->> 'release_id' = r.key and auth.uid() = any (t.mentions)))
  end
$$;

-- ---------------------------------------------------------------- Triggers de records

create or replace function public.records_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.version := nextval('record_version');
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.owner := old.owner; end if;   -- el dueño no cambia nunca
  if new.scope <> '' then return new; end if;                -- personales
  if new.tbl in ('item_types', 'labels') then new.owner := null; return new; end if;
  if new.data is null then                                   -- borrado: lo siguen "viendo" quienes lo veían, para enterarse
    if tg_op = 'UPDATE' then new.space_id := old.space_id; new.mentions := old.mentions; end if;
    return new;
  end if;
  if new.tbl = 'projects' then
    new.space_id := coalesce(as_uuid(new.data ->> 'space_id'), space_of_project(new.data ->> 'parent_id'));
  else
    new.space_id := space_of_project(new.data ->> 'project_id');
  end if;
  new.mentions := case when new.tbl in ('tasks', 'notes') then mentions_of(new.data -> 'people') else '{}' end;
  return new;
end $$;

drop trigger if exists records_before on public.records;
create trigger records_before before insert or update on public.records
  for each row execute function public.records_before();

-- Si un proyecto cambia de espacio (o llega después que sus tareas), se recalcula lo que cuelga de él.
create or replace function public.records_after_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tbl <> 'projects' or new.scope <> '' then return null; end if;
  if tg_op = 'UPDATE' and new.space_id is not distinct from old.space_id then return null; end if;
  update records set data = data
   where scope = '' and data is not null
     and ((tbl = 'projects' and data ->> 'parent_id' = new.key)
       or (tbl in ('tasks', 'notes', 'releases') and data ->> 'project_id' = new.key));
  -- Quien estaba en el espacio de antes deja de verlo: su app lo recarga todo.
  if tg_op = 'UPDATE' and old.space_id is not null then
    update profiles set access_version = nextval('record_version')
     where id in (select user_id from space_members where space_id = old.space_id);
  end if;
  return null;
end $$;

drop trigger if exists records_after_project on public.records;
create trigger records_after_project after insert or update on public.records
  for each row execute function public.records_after_project();

-- ---------------------------------------------------------------- Escribir y leer datos

-- Sube cambios de la app. Devuelve las claves rechazadas (lo ajeno que no ves, la config común si no
-- administras, llevar un proyecto a un espacio que no es tuyo).
create or replace function public.push_changes(p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c record;
  ex records;
  uid uuid := auth.uid();
  d jsonb;
  rejected text[] := '{}';
begin
  if not me_active() then raise exception 'Tu cuenta no está activa.' using errcode = '42501'; end if;
  for c in select * from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as x(tbl text, key text, data jsonb) loop
    if c.key is null or c.key = '' or c.tbl not in ('tasks', 'notes', 'projects', 'releases', 'settings', 'people', 'activity', 'item_types', 'labels') then
      continue;
    end if;
    d := case when jsonb_typeof(c.data) = 'object' then c.data end;

    if c.tbl in ('settings', 'people', 'activity') then
      insert into records (tbl, key, scope, owner, data) values (c.tbl, c.key, uid::text, uid, d)
        on conflict (tbl, key, scope) do update set data = excluded.data;
      continue;
    end if;

    if c.tbl in ('item_types', 'labels') then
      if not is_admin() then rejected := rejected || (c.tbl || ':' || c.key); continue; end if;
      insert into records (tbl, key, scope, owner, data) values (c.tbl, c.key, '', null, d)
        on conflict (tbl, key, scope) do update set data = excluded.data;
      continue;
    end if;

    select * into ex from records where tbl = c.tbl and key = c.key and scope = '';
    if found and ex.data is not null and not can_see(ex) then rejected := rejected || (c.tbl || ':' || c.key); continue; end if;
    if c.tbl = 'projects' and as_uuid(d ->> 'space_id') is not null
       and as_uuid(d ->> 'space_id') is distinct from as_uuid(ex.data ->> 'space_id')
       and not is_member(as_uuid(d ->> 'space_id')) then
      rejected := rejected || (c.tbl || ':' || c.key);
      continue;
    end if;
    if c.tbl = 'tasks' and d is not null then
      -- Solo si hay algo personal que guardar (o que borrar de antes).
      if coalesce(d ->> 'my_day', d ->> 'remind_at') is not null
         or exists (select 1 from overlays where user_id = uid and tbl = 'tasks' and key = c.key) then
      insert into overlays (user_id, tbl, key, data, version)
        values (uid, 'tasks', c.key, jsonb_build_object('my_day', d -> 'my_day', 'remind_at', d -> 'remind_at'), nextval('record_version'))
        on conflict (user_id, tbl, key) do update set data = excluded.data, version = excluded.version;
      end if;
      d := d || '{"my_day": null, "remind_at": null}'::jsonb;
    end if;
    insert into records (tbl, key, scope, owner, data) values (c.tbl, c.key, '', uid, d)
      on conflict (tbl, key, scope) do update set data = excluded.data;
  end loop;
  return jsonb_build_object('rejected', to_jsonb(rejected));
end $$;

-- ---------------------------------------------------------------- Cuenta, espacios y administración

create or replace function public.spaces_json(p_only_mine boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'color', s.color,
    'inviteCode', case when is_member(s.id) then s.invite_code else '' end,
    'role', (select role from space_members where space_id = s.id and user_id = auth.uid()),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'role', m.role)), '[]') from space_members m where m.space_id = s.id)
  ) order by s.name), '[]')
  from spaces s
  where (p_only_mine and is_member(s.id)) or (not p_only_mine and is_admin())
$$;

-- Todo lo que la app necesita saber de la sesión de una vez.
create or replace function public.me() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'user', jsonb_build_object('id', p.id, 'login', p.login, 'name', p.name),
    'disabled', p.disabled,
    'isAdmin', p.is_admin and not p.disabled,
    'accessVersion', p.access_version,
    'team', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'login', u.login, 'name', u.name) order by u.name), '[]') from profiles u where not u.disabled),
    'spaces', spaces_json(true),
    'adminCode', case when p.is_admin and not p.disabled then (select v from app_settings where k = 'admin_code') end
  ) end
  from (select 1) one left join profiles p on p.id = auth.uid()
$$;

-- Completar el alta: con la invitación de un espacio (usuario) o con el código de administración. La
-- primera cuenta del servidor es administradora.
create or replace function public.register_profile(p_name text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_space uuid;
  v_admin boolean;
begin
  if uid is null then raise exception 'Inicia sesión.' using errcode = '42501'; end if;
  if exists (select 1 from profiles where id = uid) then return me(); end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Escribe tu nombre completo (es el que se usa al mencionarte).'; end if;
  v_admin := not exists (select 1 from profiles) or v_code = (select v from app_settings where k = 'admin_code');
  if not v_admin then
    select id into v_space from spaces where invite_code = v_code;
    if v_space is null then raise exception 'El código no es correcto. Pide la invitación de tu espacio.'; end if;
  end if;
  insert into profiles (id, login, name, is_admin) values (uid, lower(coalesce(auth.email(), uid::text)), trim(p_name), v_admin);
  if v_space is not null then insert into space_members values (v_space, uid, 'member'); end if;
  return me();
end $$;

create or replace function public.touch_access(p_users uuid[]) returns void
language sql security definer set search_path = public as $$
  update profiles set access_version = nextval('record_version') where id = any (p_users)
$$;

create or replace function public.require_space_admin(p_space uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() and not exists (select 1 from space_members where space_id = p_space and user_id = auth.uid() and role = 'admin') then
    raise exception 'Solo quien administra el espacio puede hacer esto.' using errcode = '42501';
  end if;
end $$;

create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo quien administra la herramienta puede hacer esto.' using errcode = '42501'; end if;
end $$;

create or replace function public.create_space(p_name text, p_color text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_admin();
  if trim(coalesce(p_name, '')) = '' then raise exception 'Ponle nombre al espacio.'; end if;
  insert into spaces (name, color, invite_code, created_by) values (left(trim(p_name), 60), coalesce(p_color, '#6366f1'), new_code(), auth.uid())
    returning id into v_id;
  insert into space_members values (v_id, auth.uid(), 'admin');
  return spaces_json(true);
end $$;

create or replace function public.join_space(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not me_active() then raise exception 'Tu cuenta no está activa.' using errcode = '42501'; end if;
  select id into v_id from spaces where invite_code = upper(trim(coalesce(p_code, '')));
  if v_id is null then raise exception 'Ese código de invitación no existe.'; end if;
  insert into space_members values (v_id, auth.uid(), 'member') on conflict do nothing;
  perform touch_access(array[auth.uid()]);
  return spaces_json(true);
end $$;

create or replace function public.update_space(p_space uuid, p_name text, p_color text, p_new_code boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_space_admin(p_space);
  update spaces set
    name = coalesce(nullif(left(trim(coalesce(p_name, '')), 60), ''), name),
    color = coalesce(nullif(p_color, ''), color),
    invite_code = case when coalesce(p_new_code, false) then new_code() else invite_code end
  where id = p_space;
  return spaces_json(true);
end $$;

-- Quitar a alguien (administradores) o salir una misma. Siempre queda una administradora del espacio.
create or replace function public.remove_member(p_space uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_target uuid := coalesce(p_user, auth.uid());
  v_members int;
  v_admins uuid[];
begin
  if v_target <> auth.uid() then perform require_space_admin(p_space);
  elsif not is_member(p_space) then raise exception 'No estás en ese espacio.'; end if;
  select count(*) into v_members from space_members where space_id = p_space;
  select array_agg(user_id) into v_admins from space_members where space_id = p_space and role = 'admin';
  if array_length(v_admins, 1) = 1 and v_admins[1] = v_target and v_members > 1 then
    raise exception 'Es la única persona que administra el espacio: nombra antes a otra.';
  end if;
  delete from space_members where space_id = p_space and user_id = v_target;
  if v_members = 1 then delete from spaces where id = p_space; end if;
  perform touch_access(array[v_target]);
  return spaces_json(true);
end $$;

create or replace function public.set_space_role(p_space uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_space_admin(p_space);
  update space_members set role = case when p_role = 'admin' then 'admin' else 'member' end
   where space_id = p_space and user_id = p_user;
  return spaces_json(true);
end $$;

create or replace function public.admin_join_space(p_space uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  insert into space_members values (p_space, auth.uid(), 'admin')
    on conflict (space_id, user_id) do update set role = 'admin';
  perform touch_access(array[auth.uid()]);
  return spaces_json(true);
end $$;

create or replace function public.admin_users() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'login', p.login, 'name', p.name, 'isAdmin', p.is_admin, 'disabled', p.disabled, 'createdAt', p.created_at,
    'spaces', (select coalesce(jsonb_agg(m.space_id), '[]') from space_members m where m.user_id = p.id)
  ) order by p.name), '[]') from profiles p);
end $$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return jsonb_build_object('users', admin_users(), 'spaces', spaces_json(false),
    'adminCode', (select v from app_settings where k = 'admin_code'));
end $$;

create or replace function public.set_admin(p_user uuid, p_value boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if not p_value and (select count(*) from profiles where is_admin and not disabled and id <> p_user) = 0 then
    raise exception 'Tiene que quedar al menos una persona administradora.';
  end if;
  update profiles set is_admin = p_value where id = p_user;
  return admin_users();
end $$;

-- Desactivar: la cuenta deja de ver y escribir nada (sus datos se conservan).
create or replace function public.set_disabled(p_user uuid, p_value boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if p_user = auth.uid() then raise exception 'No puedes desactivar tu propia cuenta.'; end if;
  if p_value and (select is_admin from profiles where id = p_user)
     and (select count(*) from profiles where is_admin and not disabled and id <> p_user) = 0 then
    raise exception 'Tiene que quedar al menos una persona administradora.';
  end if;
  update profiles set disabled = p_value where id = p_user;
  return admin_users();
end $$;

create or replace function public.regenerate_admin_code() returns text
language plpgsql security definer set search_path = public as $$
declare v text := new_code();
begin
  perform require_admin();
  insert into app_settings values ('admin_code', v) on conflict (k) do update set v = excluded.v;
  return v;
end $$;

-- ---------------------------------------------------------------- Seguridad (RLS) y permisos

alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.app_settings enable row level security;
alter table public.records enable row level security;
alter table public.overlays enable row level security;

drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated using (public.me_active() and public.can_see(records));
drop policy if exists overlays_select on public.overlays;
create policy overlays_select on public.overlays for select to authenticated using (user_id = auth.uid());
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (public.me_active() or id = auth.uid());
drop policy if exists spaces_select on public.spaces;
create policy spaces_select on public.spaces for select to authenticated using (public.is_member(id) or public.is_admin());
drop policy if exists members_select on public.space_members;
create policy members_select on public.space_members for select to authenticated using (public.is_member(space_id) or public.is_admin());
drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (public.is_admin());

-- Nadie escribe directamente: solo a través de las funciones de arriba.
revoke insert, update, delete, truncate on public.profiles, public.spaces, public.space_members, public.app_settings, public.records, public.overlays from anon, authenticated;
revoke all on public.profiles, public.spaces, public.space_members, public.app_settings, public.records, public.overlays from anon;
grant select on public.profiles, public.spaces, public.space_members, public.app_settings, public.records, public.overlays to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.name_key(text), public.me_active(), public.is_admin(), public.is_member(uuid), public.as_uuid(text),
  public.can_see(public.records), public.push_changes(jsonb), public.me(), public.register_profile(text, text),
  public.create_space(text, text), public.join_space(text), public.update_space(uuid, text, text, boolean),
  public.remove_member(uuid, uuid), public.set_space_role(uuid, uuid, text), public.admin_join_space(uuid),
  public.admin_overview(), public.set_admin(uuid, boolean), public.set_disabled(uuid, boolean), public.regenerate_admin_code()
to authenticated;

-- Código de administración inicial (se ve en la app, en Ajustes → Administración).
insert into public.app_settings values ('admin_code', public.new_code()) on conflict (k) do nothing;

-- Cambios en tiempo real (si existe la publicación de Supabase Realtime).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.records, public.overlays, public.profiles;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
