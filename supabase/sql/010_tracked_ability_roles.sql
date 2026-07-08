-- ProtoCarries · Filtro de roles para habilidades trackeadas.
--
-- Agrega soporte para que cada habilidad aplique solo a uno o varios roles
-- del roster: tank, healer, ranged, melee.
--
-- Las habilidades existentes quedan habilitadas para los 4 roles, asi no se
-- rompe nada al correr esta migracion.

alter table tracked_abilities
  add column if not exists role_filter text[] not null
  default array['tank','healer','ranged','melee']::text[];

update tracked_abilities
set role_filter = array['tank','healer','ranged','melee']::text[]
where role_filter is null or array_length(role_filter, 1) is null;

alter table tracked_abilities
  drop constraint if exists tracked_abilities_role_filter_valid;

alter table tracked_abilities
  add constraint tracked_abilities_role_filter_valid
  check (
    role_filter <@ array['tank','healer','ranged','melee']::text[]
    and coalesce(array_length(role_filter, 1), 0) >= 1
  );
