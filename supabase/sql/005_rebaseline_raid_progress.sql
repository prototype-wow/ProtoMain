-- Corrige el baseline de raid corrompido por el bug de la primera sincronización
-- (contaba toda la historia de raideo del personaje como "esta semana").
-- Iguala raid_reset_baseline al character_progress actual, para arrancar
-- el conteo de "esta semana" en cero a partir de ahora.
update raid_reset_baseline b
set raid_progress = cp.raid_progress,
    updated_at = now()
from character_progress cp
where cp.character_id = b.character_id;
