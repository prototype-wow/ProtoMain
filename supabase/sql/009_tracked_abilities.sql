-- ProtoCarries · Habilidades trackeadas para la vista Roster.
--
-- Permite configurar desde la pestaña Usuarios qué spells/importantes se
-- muestran agrupados en Roster (ej. Inmunes, Grips, Mass Dispel).
--
-- Mismo modelo de seguridad práctico que el resto de la app actual: la UI
-- decide quién puede editar; la policy pública permite cambios con la key
-- pública. Para seguridad dura hace falta Supabase Auth + RLS por usuario.

create table if not exists tracked_abilities (
  id text primary key,
  spell_id integer not null,
  name text not null,
  class text not null,
  group_name text not null default 'Utilidad',
  role_filter text[] not null default array['tank','healer','ranged','melee']::text[],
  icon_url text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (spell_id, class, group_name)
);

alter table tracked_abilities enable row level security;

drop policy if exists "public read tracked abilities" on tracked_abilities;
drop policy if exists "public insert tracked abilities" on tracked_abilities;
drop policy if exists "public update tracked abilities" on tracked_abilities;
drop policy if exists "public delete tracked abilities" on tracked_abilities;

create policy "public read tracked abilities"
  on tracked_abilities for select using (true);

create policy "public insert tracked abilities"
  on tracked_abilities for insert with check (true);

create policy "public update tracked abilities"
  on tracked_abilities for update using (true) with check (true);

create policy "public delete tracked abilities"
  on tracked_abilities for delete using (true);
