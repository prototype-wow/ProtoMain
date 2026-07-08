-- ProtoCarries · La clase del personaje ahora la completa la sincronización
-- con Battle.net (no se elige a mano al crear el personaje), así que la
-- columna tiene que poder quedar en null hasta el primer sync.
alter table characters alter column class drop not null;
