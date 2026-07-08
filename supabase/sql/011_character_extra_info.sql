-- ProtoCarries · Datos extra para vista individual de personaje.
--
-- Agrega lugar para guardar la informacion que falta para una vista tipo
-- "Single Character View": perfil, profesiones, reputaciones/renown,
-- achievements, mounts y pets.
--
-- Esta migracion es segura para correr sobre la DB actual: solo agrega columnas
-- con defaults vacios. La Edge Function `sync-characters` se actualiza despues
-- para empezar a llenarlas.

alter table character_progress
  add column if not exists profile jsonb not null default '{}'::jsonb,
  add column if not exists professions jsonb not null default '{}'::jsonb,
  add column if not exists achievements jsonb not null default '{}'::jsonb,
  add column if not exists reputations jsonb not null default '{}'::jsonb,
  add column if not exists collections jsonb not null default '{}'::jsonb,
  add column if not exists race text,
  add column if not exists gender text,
  add column if not exists faction text,
  add column if not exists level integer,
  add column if not exists achievement_points integer,
  add column if not exists mounts_count integer,
  add column if not exists pets_count integer,
  add column if not exists exalted_reputations_count integer;

alter table character_progress
  drop constraint if exists character_progress_level_valid,
  drop constraint if exists character_progress_achievement_points_valid,
  drop constraint if exists character_progress_mounts_count_valid,
  drop constraint if exists character_progress_pets_count_valid,
  drop constraint if exists character_progress_exalted_reputations_count_valid;

alter table character_progress
  add constraint character_progress_level_valid
    check (level is null or level >= 1),
  add constraint character_progress_achievement_points_valid
    check (achievement_points is null or achievement_points >= 0),
  add constraint character_progress_mounts_count_valid
    check (mounts_count is null or mounts_count >= 0),
  add constraint character_progress_pets_count_valid
    check (pets_count is null or pets_count >= 0),
  add constraint character_progress_exalted_reputations_count_valid
    check (exalted_reputations_count is null or exalted_reputations_count >= 0);
