-- ProtoCarries · Permite gestionar el roster (agregar/editar/dar de baja
-- personajes) desde la pestaña "Progreso" del HTML, para usuarios con rol
-- Admin (control solo a nivel de la app, igual que ya pasa con `users`/`weeks`/`sales`).
--
-- Nota de seguridad (ya señalada en COLLAB.md): la key pública del HTML es la
-- misma para todos los visitantes, así que estas policies permiten INSERT/UPDATE
-- a cualquiera que tenga esa key, no solo a los admins reales — el gate de "solo
-- admin" es una convención de la UI (cap('manageUsers')), no algo forzado por la
-- base. Es el mismo nivel de seguridad que ya tiene el resto de la app. Para un
-- candado real hace falta Supabase Auth + policies basadas en el usuario logueado.
--
-- Deliberadamente NO se agrega policy de DELETE: dar de baja un personaje se
-- hace con UPDATE (columna `active`), para no perder el historial en
-- character_progress / raid_reset_baseline (que además tienen FK con cascade).

drop policy if exists "public insert characters" on characters;
drop policy if exists "public update characters" on characters;

create policy "public insert characters"
  on characters for insert with check (true);

create policy "public update characters"
  on characters for update using (true) with check (true);
