# Pipeline propio de datos WoW (Battle.net) — deploy

Reemplaza al Google Sheet de wowaudit. Trae equipo/ilvl, Mythic+ y progreso de
raid directo de la Battle.net API y los guarda en tu propio Supabase (el mismo
proyecto que ya usa `index.html`). Ver el plan completo en
`C:\Users\Ortiz\.claude\plans\curious-popping-crescent.md`.

## 1) Crear credenciales de Battle.net

1. Entrá a https://develop.battle.net/access/clients y logueate con tu cuenta de Battle.net.
2. "Create Client" → cualquier nombre (ej. `protocarries-sync`), redirect URL no importa (no se usa OAuth de usuario, solo client_credentials).
3. Guardá el **Client ID** y el **Client Secret** que te muestra — el secret no se vuelve a mostrar.

## 2) Instalar la Supabase CLI (si no la tenés)

```bash
npm install -g supabase
supabase login
```

## 3) Correr el SQL (schema + seed del roster)

En el dashboard de tu proyecto (`hjatxlvqytgkizcaopce`) → SQL Editor → pegar y correr, en este orden:

1. `supabase/sql/001_schema.sql` — crea `characters`, `character_progress`, `raid_reset_baseline`, RLS, y siembra los 23 personajes actuales.
2. `supabase/sql/002_cron.sql` — **antes de correrlo**, reemplazá `<PROJECT_REF>` y `<SERVICE_ROLE_KEY>` (Project Settings → API) por los tuyos. Este cron llama a la función cada 30 minutos.
3. `supabase/sql/003_characters_write.sql` — habilita agregar/editar/dar de baja personajes desde la pestaña "Progreso" del HTML (solo visible para rol Admin). Sin esto, el roster solo se puede tocar corriendo SQL a mano.

## 4) Configurar y deployar la Edge Function

```bash
cd "ProtoCarries"
supabase link --project-ref hjatxlvqytgkizcaopce

supabase secrets set BATTLENET_CLIENT_ID=tu_client_id BATTLENET_CLIENT_SECRET=tu_client_secret

supabase functions deploy sync-characters
```

### Funcion opcional: explorar spells/habilidades de Blizzard API

Para ver que habilidades se pueden descubrir desde clases/specs/talentos sin
exponer el secret de Battle.net en el frontend, deploya la funcion debug:

```bash
supabase functions deploy inspect-wow-spells
```

Ejemplos:

```bash
supabase functions invoke inspect-wow-spells --body '{"class":"Mage","maxSpells":40}'
supabase functions invoke inspect-wow-spells --body '{"class":"Priest","maxSpecs":3,"maxSpells":80}'
```

Tambien se puede llamar por URL:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/inspect-wow-spells?class=Mage&maxSpells=40
```

La respuesta es exploratoria: Battle.net expone referencias de spells desde
`playable-class`, `playable-specialization`, `talent-tree` y `spell/{id}`, pero
no una lista completa/curada de "todas las habilidades importantes de cada
clase". Para una vista final de roster/utilidades, esto sirve como dump inicial
para armar una tabla propia de spells relevantes.

## 5) Probar manualmente (antes de esperar el cron)

```bash
supabase functions invoke sync-characters
```

Debería devolver algo como `{"synced":23,"failed":[]}`. Si `failed` tiene entradas,
revisá el nombre del personaje (mayúsculas/tildes) — tienen que coincidir con el
nombre real en Battle.net, en el realm `Quel'Thalas` (US).

Confirmá en el SQL Editor:

```sql
select c.name, p.equipped_ilvl, p.mythic_rating, p.updated_at
from character_progress p join characters c on c.id = p.character_id
order by p.equipped_ilvl desc;
```

## 6) Ver la pestaña nueva

Abrí `index.html` → pestaña **Progreso** (visible para todos los roles). Si corriste
la función al menos una vez, vas a ver ilvl / M+ rating / M+ y jefes de raid de
esta semana por personaje.

Si entrás como **Admin**, además vas a ver un botón "+ Personaje" y, por fila,
"Editar" / "Dar de baja" — así el roster se actualiza solo (cuando entra o sale
alguien de la guild) sin tocar SQL. "Dar de baja" no borra el historial, solo
oculta al personaje para el resto de los roles y lo saca de la próxima sincronización
(la Edge Function solo trae personajes con `active = true`).

## Notas / limitaciones de esta primera versión

- "Jefes matados esta semana" se calcula comparando el snapshot actual contra un
  baseline guardado la primera vez que la función corre después de cada reset
  (martes). Puede haber un desfasaje de hasta el intervalo del cron (30 min)
  justo en el momento del reset.
- Si un personaje cambia de nombre/realm, hay que actualizar la fila en `characters`
  a mano (no hay UI para eso todavía, a diferencia de wowaudit).
- No se trae nada de Warcraft Logs (parses) — quedó fuera de esta primera versión,
  según lo hablado.
