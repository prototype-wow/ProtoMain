-- ProtoCarries · Lista de realms de WoW (para el autocompletado de "Servidor"
-- al agregar/editar un personaje). La llena la Edge Function sync-realms,
-- no hace falta tocarla a mano.
create table if not exists wow_realms (
  region  text not null,
  slug    text not null,
  name    text not null,
  primary key (region, slug)
);

alter table wow_realms enable row level security;

drop policy if exists "public read wow_realms" on wow_realms;
create policy "public read wow_realms"
  on wow_realms for select using (true);

-- Sin policies de insert/update/delete para el rol público: solo la Edge
-- Function (service_role) escribe acá.
