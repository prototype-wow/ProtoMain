-- ProtoCarries · Pipeline propio de datos WoW (reemplazo de wowaudit)
-- Corré esto una sola vez en el SQL editor de Supabase (Project > SQL Editor > New query).

-- ============================================================
-- 1) ROSTER
-- ============================================================
create table if not exists characters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  realm_slug  text not null default 'quelthalas',
  region      text not null default 'us',
  class       text not null,
  role        text not null check (role in ('tank','healer','ranged','melee')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (name, realm_slug, region)
);

-- ============================================================
-- 2) SNAPSHOT ACTUAL (se sobreescribe en cada sync de la Edge Function)
-- ============================================================
create table if not exists character_progress (
  character_id     uuid primary key references characters(id) on delete cascade,
  equipped_ilvl    numeric,
  gear             jsonb,           -- equipped_items[] tal cual devuelve /equipment
  mythic_rating    numeric,         -- current_mythic_rating.rating
  mythic_best_runs jsonb,           -- current_period.best_runs[] (ya es "esta semana")
  raid_progress    jsonb,           -- { [raidName]: { [difficulty]: { bossName: completed_count } } }
  profile          jsonb not null default '{}'::jsonb, -- resumen crudo de /profile
  professions      jsonb not null default '{}'::jsonb, -- /professions
  achievements     jsonb not null default '{}'::jsonb, -- /achievements
  reputations      jsonb not null default '{}'::jsonb, -- /reputations / renown
  collections      jsonb not null default '{}'::jsonb, -- mounts / pets / colecciones
  race             text,
  gender           text,
  faction          text,
  level            integer,
  achievement_points integer,
  mounts_count     integer,
  pets_count       integer,
  exalted_reputations_count integer,
  synced_ok        boolean not null default true,
  last_error       text,
  updated_at       timestamptz not null default now()
);

-- ============================================================
-- 3) BASELINE DE RESET SEMANAL (para calcular "jefes matados esta semana")
-- ============================================================
create table if not exists raid_reset_baseline (
  character_id   uuid primary key references characters(id) on delete cascade,
  week_start     date not null,     -- martes de la semana vigente (US reset)
  raid_progress  jsonb,             -- copia de character_progress.raid_progress ANTES del sync post-reset
  updated_at     timestamptz not null default now()
);

-- ============================================================
-- RLS: lectura pública (misma key publishable que ya usa index.html),
-- sin escritura pública. Solo la Edge Function (service_role) escribe.
-- ============================================================
alter table characters           enable row level security;
alter table character_progress   enable row level security;
alter table raid_reset_baseline  enable row level security;

drop policy if exists "public read characters"          on characters;
drop policy if exists "public read character_progress"   on character_progress;
drop policy if exists "public read raid_reset_baseline"  on raid_reset_baseline;

create policy "public read characters"
  on characters for select using (true);
create policy "public read character_progress"
  on character_progress for select using (true);
create policy "public read raid_reset_baseline"
  on raid_reset_baseline for select using (true);

-- Nota: no se crean policies de insert/update/delete para anon/authenticated,
-- así que con la key pública esas operaciones quedan bloqueadas por RLS.
-- La Edge Function usa la service_role key, que ignora RLS.

-- ============================================================
-- SEED: roster inicial (23 personajes), extraído del Google Sheet de wowaudit
-- ============================================================
-- Nota: la guild tiene miembros de varios realms (no todos están en quelthalas,
-- WoW permite guilds cross-realm). El realm_slug de cada uno se sacó del
-- raw_data de wowaudit, no asumas que todos están en el realm de la guild.
insert into characters (name, class, role, realm_slug) values
  ('Exxé',          'Mage',         'ranged', 'sargeras'),
  ('Viriviri',      'Warrior',      'melee',  'ragnaros'),
  ('Merengw',       'Priest',       'healer', 'sargeras'),
  ('Jarvo',         'Warrior',      'melee',  'quelthalas'),
  ('Jîm',           'Hunter',       'ranged', 'ragnaros'),
  ('Nëitiri',       'Evoker',       'healer', 'quelthalas'),
  ('Sukidruid',     'Druid',        'tank',   'sargeras'),
  ('Tidecaller',    'Mage',         'ranged', 'ragnaros'),
  ('Tokkï',         'Paladin',      'melee',  'quelthalas'),
  ('Denisse',       'Demon Hunter', 'melee',  'stormrage'),
  ('Foxwmulder',    'Hunter',       'ranged', 'quelthalas'),
  ('Montréfe',      'Rogue',        'melee',  'ragnaros'),
  ('Mecrö',         'Shaman',       'ranged', 'ragnaros'),
  ('Melox',         'Warlock',      'ranged', 'quelthalas'),
  ('Xduri',         'Monk',         'healer', 'quelthalas'),
  ('Deideideidei',  'Shaman',       'healer', 'quelthalas'),
  ('Khansos',       'Monk',         'tank',   'quelthalas'),
  ('Cïskul',        'Demon Hunter', 'melee',  'ragnaros'),
  ('Koisand',       'Warlock',      'ranged', 'ragnaros'),
  ('Doñatotá',      'Evoker',       'ranged', 'quelthalas'),
  ('Alainx',        'Death Knight', 'melee',  'quelthalas'),
  ('Akanthør',      'Death Knight', 'melee',  'quelthalas'),
  ('Gambihitz',     'Death Knight', 'melee',  'ragnaros')
on conflict (name, realm_slug, region) do nothing;
