# Handoff para Codex — ProtoCarries

**A Codex**: este documento es un resumen técnico de todo lo que se desarrolló en esta app durante varias sesiones de trabajo con Claude. **En [`COLLAB.md`](./COLLAB.md) está el detalle cronológico completo, sesión por sesión**, con decisiones, bugs encontrados/corregidos, y el razonamiento detrás de cada cambio — leelo si necesitás el "por qué" de algo puntual. Este documento es la foto general del sistema tal como quedó, para que puedas revisar sin tener que reconstruir el contexto desde cero.

---

## 1. Qué es esta app

**ProtoCarries** es una herramienta interna para la guild "Prototype" (WoW, US-Quel'Thalas) con dos funciones distintas:

1. **Registro de ventas de carries** (el propósito original de la app): trackea ventas de runs pagas por semana, por raid/boss, con roles de usuario (básico/cargador/officer/admin), auditoría, y gestión de vacantes.
2. **Auditoría de progreso del roster** (lo que se construyó en estas sesiones): reemplaza a un spreadsheet de terceros (wowaudit.com) por un pipeline propio que trae datos reales de personajes directo de la Battle.net API — equipo, ilvl, Mythic+, progreso de raid, bóveda semanal, etc.

Es un **único archivo HTML** (`index.html`, ~1100 líneas), vanilla JS sin build step ni framework, que se sube directo a GitHub Pages (o similar) y habla con Supabase como backend.

## 2. Arquitectura

```
┌─────────────────┐        lee/escribe         ┌──────────────────────┐
│   index.html     │ ────────(REST/PostgREST)──▶│  Supabase Postgres    │
│  (público, sin    │◀──────────────────────────│  + RLS                │
│   secrets)         │                            └──────────────────────┘
└─────────────────┘                                       ▲
                                                            │ service_role (bypassa RLS)
                                                            │
                                              ┌──────────────────────────┐
                                              │  Supabase Edge Functions  │
                                              │  (Deno, corren server-side)│
                                              │  - sync-characters         │
                                              │  - sync-realms             │
                                              └──────────────────────────┘
                                                            │
                                                     OAuth client_credentials
                                                            ▼
                                              ┌──────────────────────────┐
                                              │   Battle.net Game Data API │
                                              │   (Blizzard)                │
                                              └──────────────────────────┘
```

**Principio de seguridad que se sostuvo en todo el desarrollo**: el `index.html` es público (va a GitHub) y solo tiene la key `SUPABASE_KEY` **publishable** (`sb_publishable_...`), de solo lectura vía RLS. Las credenciales de Battle.net (`BATTLENET_CLIENT_ID`/`SECRET`) viven **exclusivamente** como Supabase Secrets, leídas solo dentro de las Edge Functions (`Deno.env.get(...)`), nunca en el HTML ni en el repo. Verificado explícitamente (`grep` sobre `index.html` sin matches de esas credenciales).

### Proyecto Supabase
- Ref: `hjatxlvqytgkizcaopce`
- URL: `https://hjatxlvqytgkizcaopce.supabase.co`

## 3. Esquema de base de datos

### Tablas pre-existentes (del sistema de carries original, no tocadas en estas sesiones salvo lo indicado)
- `weeks`, `sales`, `users`, `app_settings`, `audit_log`

⚠️ **Nota de seguridad heredada, sin resolver**: estas tablas usan el mismo patrón de "RLS abierto + gate solo en la UI" — cualquiera con la key pública (que está en el HTML público) puede, en teoría, hacer INSERT/UPDATE/DELETE directo contra la API REST de Supabase sin pasar por los checks de rol de la app. No se tocó porque no era el foco de estas sesiones, pero **queda como deuda técnica conocida**. Recomendación: migrar a Supabase Auth + políticas RLS reales basadas en `auth.uid()`.

### Tablas nuevas (creadas en estas sesiones)

**`characters`** — roster de personajes trackeados.
```sql
id uuid pk, name text, realm_slug text, region text, class text (nullable),
role text check in ('tank','healer','ranged','melee'), active boolean default true,
unique(name, realm_slug, region)
```
- `class` es **nullable**: no se elige a mano, la completa la sincronización con Battle.net.
- `role` (tank/healer/ranged/melee) sí es manual — es una decisión organizativa de la guild, no algo que la API de Blizzard sepa.
- Seed inicial: 23 personajes reales del roster, extraídos originalmente de un Google Sheet de wowaudit (ver §7).

**`character_progress`** — snapshot actual por personaje, se sobreescribe en cada sync.
```sql
character_id uuid pk/fk, equipped_ilvl numeric, gear jsonb (equipped_items crudo de Battle.net),
mythic_rating numeric, mythic_best_runs jsonb, raid_progress jsonb,
synced_ok boolean, last_error text, updated_at timestamptz
```
- `gear` es el array `equipped_items` **crudo** tal cual lo devuelve `/profile/wow/character/{realm}/{name}/equipment` de Blizzard — decisión deliberada de guardar el dato crudo en vez de pre-procesarlo, porque de ahí se derivan casi todas las vistas del frontend (ver §5) sin tener que volver a pegarle a la API.
- `raid_progress` tiene una clave especial `_killed_this_week` con los jefes matados esta semana (ver lógica de baseline en §4).

**`raid_reset_baseline`** — snapshot de `raid_progress` tomado en cada reset semanal (martes), para poder calcular diffs ("qué mató esta semana" vs. "toda su historia").

**`wow_realms`** — lista de realms de WoW (region, slug, name), poblada por `sync-realms`. Usada para el autocompletado de servidor en el form de personajes. Tiene **797 filas** (US/EU/KR/TW).

**`app_settings`** (columna agregada): `auto_sync boolean default true` — toggle para prender/apagar el auto-refresh cada 5 min.

Todas las tablas nuevas tienen RLS con policy de `SELECT` abierta (lectura pública, misma key que ya usa el resto de la app) y **sin policies de INSERT/UPDATE/DELETE para el rol público** — solo la Edge Function con `service_role` puede escribir. Excepción: `characters` sí tiene policies de INSERT/UPDATE públicas (`003_characters_write.sql`) para que el admin pueda gestionar el roster desde la UI — mismo modelo de "gate solo en la app" que las tablas viejas, documentado como tal.

## 4. Edge Functions

### `sync-characters` (el corazón del sistema)

Se invoca de 3 formas: (a) cron cada 5 min con `body: {"source":"cron"}`, (b) botón manual en la UI con `body: {"source":"manual"}`, (c) invocación manual por SQL para debug.

Flujo por cada personaje activo:
1. OAuth `client_credentials` contra `oauth.battle.net` (token cacheado por invocación, no persistido).
2. Llama en paralelo a Battle.net (`namespace=profile-{region}`):
   - `/profile/wow/character/{realm}/{name}` → ilvl, clase
   - `.../equipment` → gear completo
   - `.../mythic-keystone-profile` → M+ rating y runs de la semana
   - `.../encounters/raids` → historial completo de kills de raid (todas las expansiones, no solo la actual)
3. Actualiza `characters.class` si difiere de lo que había (la clase "se auto-completa").
4. Calcula `raid_progress` agregando el historial por instancia/dificultad/boss.
5. **Lógica de baseline semanal** (para saber "qué mató esta semana", ya que Blizzard solo da contadores acumulados de toda la vida del personaje, nunca "esta semana"):
   - Si es la primerísima sync del personaje: el baseline arranca **igual al progreso actual** (no en `{}`), para no contar toda la historia de raideo como "esta semana". *(Bug real encontrado y corregido en sesión — el primer intento usaba `{}` y mostraba números como "1190 jefes esta semana".)*
   - Si cambió la semana (reset de martes) desde el último baseline: el baseline pasa a ser el `raid_progress` de **antes** de este sync.
   - `killedThisWeek` = diff entre el progreso actual y el baseline.
6. Throttle: si el último `updated_at` en `character_progress` es de hace menos de 60 segundos, no hace nada (evita spam si alguien clickea el botón repetidamente).
7. Maneja errores por personaje individualmente (`Promise.allSettled`) — un personaje con nombre mal escrito o realm incorrecto no tumba el batch entero.
8. CORS habilitado (`Access-Control-Allow-Origin: *`) — necesario para que el botón manual desde el navegador pueda invocarla (el `curl` sin CORS funcionaba, el `fetch` del browser no, hasta que se agregó).

**Descubrimiento clave de seguridad**: la `SUPABASE_KEY` publishable (la misma que ya está en `index.html`, de solo lectura sobre las tablas) **alcanza para invocar la Edge Function** — el gateway de Supabase la acepta como token de autorización para funciones, aunque no tenga permisos de escritura en la base. Esto permitió agregar el botón "Refrescar API" **sin** tener que deployar con `--no-verify-jwt` (que habría dejado la función invocable por cualquiera sin ningún control) y **sin** agregar ninguna key nueva al HTML.

### `sync-realms`

Función chica, standalone. Trae `/data/wow/realm/index` de Battle.net para 4 regiones (us/eu/kr/tw) y hace upsert en `wow_realms`. No está en el cron (los realms casi no cambian) — se invoca manualmente cuando hace falta.

## 5. Frontend (`index.html`) — qué se agregó

### Pestañas nuevas
Visibles solo para roles `officer` y `admin` (los roles `basico`/`cargador` no las ven — restricción agregada explícitamente a pedido del usuario):

- **Progreso**: tabla del roster completo con 8 sub-vistas navegables por un `<select>` (para no tener una tabla gigante scrolleando hacia la derecha):
  - **General**: ilvl, M+ rating, M+ esta semana, slots de bóveda M+/Raid, encantamientos/gemas faltantes.
  - **Equipo por slot**: ilvl de cada una de las 16 piezas equipadas.
  - **Piezas de tier**: cuántas piezas de tier tiene (X/5) y la **letra de dificultad por slot** (M/H/N/V, coloreada — ver detalle abajo).
  - **Encantamientos**: grilla ✓/✕ por slot encantable.
  - **Gemas**: gemas puestas vs. sockets vacíos.
  - **Distribución de stats**: % de Crit/Haste/Mastery/Versatility sumando todo el equipo.
  - **Bóveda**: 9 slots en 3 categorías (Mazmorra/Raid/Mundo) — ver detalle abajo.
  - Barra superior con: buscador con filtrado en vivo (nombre/clase/rol), filtro por clase, filtro por rol, columnas ordenables (click en header), botón "↻ Refrescar API".
- **Resumen**: dashboard con 4 stat boxes (miembros, mazmorras M+ de la semana, encantamientos/gemas faltantes, opciones de bóveda faltantes) + 5 tablas rankeadas lado a lado (ilvl, piezas de tier, mazmorras hechas, opciones de bóveda, M+ rating) — clon funcional del "Audit Summary" de wowaudit.
- **Roster**: composición de la guild — columnas por rol (Tanks/Healers/Ranged/Melee) con lista de personajes, y paneles de conteo por clase y por tipo de armadura (Cloth/Leather/Mail/Plate).

### Sistema de íconos de clase y rol
- **Clase**: `<img>` que apunta (hotlink, no assets propios en el repo) a `https://warcraft.wiki.gg/images/ClassIcon_{slug}.png` — el ícono real de cada clase, mismo patrón que usa cualquier sitio de WoW (Wowhead, Raider.io, etc.). Con anillo de color de clase (paleta canónica: Warrior `#C79C6E`, Paladin `#F58CBA`, etc.) integrado al motivo visual de diamante que ya usaba la app.
- **Rol**: 4 glifos SVG originales dibujados a mano (escudo=tank, cruz=healer, espadas cruzadas=melee, arco=ranged), coloreados igual que el Group Finder de Blizzard (azul/verde/rojo).
- *Nota de proceso*: hubo una iteración larga acá (se probaron íconos SVG originales inspirados en la fantasía de cada clase, después un intento de imitar un pack de íconos pintados que el usuario mostró por captura — descartado por tema de copyright, era arte pago con marca de agua — hasta llegar a la solución final de usar el ícono real vía hotlink). Detalle completo en `COLLAB.md`.

### Letras de dificultad de tier (M/H/N/V)
Esto tuvo una vuelta importante: la primera implementación derivaba la letra del **ilvl** de la pieza, pero eso está mal — dos piezas del mismo ilvl pueden ser de dificultad distinta (una Heroica subida de nivel puede llegar al mismo ilvl que una Mítica sin subir). La letra correcta sale del **origen/track** de la pieza, que Blizzard expone en `item.name_description.display_string` (ej. `"Mythic Sporefused: Myth"`, o simplemente `"Mythic"` / `"Mythic+"`). Se corrigió para parsear esa primera palabra (`/^mythic/i`→M, `/^heroic/i`→H, `/^normal/i`→N, resto→V), con el ilvl como respaldo solo si la pieza no trae esa descripción. Colores: M naranja `#f0821e`, H violeta oscuro `#7c4dbf`, N azul `#2f8fe0`, V verde `#2fbf71` (pedidos explícitamente por el usuario). Fuente: la misma que los nombres (`Inter`/font-body), 14.5px.

### Bóveda semanal (Great Vault) — 9 slots, 3 categorías
Confirmado por búsqueda web (Method.gg, Icy Veins) los umbrales reales de Midnight Season 1:
- **Mazmorra** (M+): 1/4/8 corridas → nivel de key de la 1ª/4ª/8ª más alta.
- **Raid**: 2/4/6 jefes matados (contando la dificultad más alta si se repitió un boss) → dificultad del 2º/4º/6º kill.
- **Mundo** (Delves/actividades): 2/4/8 — **esta categoría NO se pudo implementar con datos reales**. Blizzard no expone delves/actividades de mundo en los endpoints de la Game Data API que se están usando (equipment, mythic-keystone-profile, encounters/raids). wowaudit lo saca de su propio backend privado, no de un endpoint público documentado. Queda mostrada como "—" en la UI, con una nota explicando por qué.

### Botón de refrescar + auto-sync toggle
- Botón "↻ Refrescar API" en la pestaña Progreso: dispara `sync-characters` con `source:"manual"`, muestra toast con el resultado, respeta el throttle de 60s del lado del servidor.
- Toggle "Auto-sincronizar con Battle.net" en la pestaña Usuarios (solo admin): escribe `app_settings.auto_sync`. El cron respeta este flag (si está apagado, el sync automático no corre; el botón manual sí funciona siempre).
- ✅ `supabase/sql/008_autosync_5min.sql` fue corrido por el usuario el 2026-07-08. Con eso, la columna `app_settings.auto_sync` debería existir y el cron debería estar reprogramado a 5 min. Estado confirmado por Nicolás; no verificado desde esta sesión contra Supabase.

### Gestión de roster desde la UI (solo admin)
En la pestaña Progreso, un admin puede agregar/editar/dar de baja personajes sin tocar SQL:
- **Nombre**: texto libre.
- **Servidor**: buscador con autocompletado contra `wow_realms` (formato `US-Quel'Thalas`), **solo permite elegir de la lista** (no texto libre) — si no se selecciona nada válido, el guardado se rechaza.
- **Clase**: no se pide, se auto-completa en la próxima sincronización.
- **Rol**: select manual (tank/healer/ranged/melee).
- "Dar de baja" es soft-delete (`active=false`), no borra el historial — y la Edge Function ya filtra por `active=true`, así que un personaje dado de baja deja de sincronizarse solo.

### Layout / responsive
El contenedor pasó de `max-width:1200px` a `1680px` con padding responsive (`clamp`). Se corrigió un bug real donde los valores numéricos de las tablas rankeadas del Resumen se cortaban visualmente (ej. `"293.00"` se veía como `"29"`) — la causa era que las filas usaban `<table>` con `table-layout:fixed`, que no dejaba que la celda del valor se ajustara al contenido; se resolvió reescribiendo esas filas a flexbox (nombre trunca con "…", número siempre entero). Se agregaron media queries para 860px y 560px. Verificado sin scroll horizontal ni overflow en 375px/1440px/1900px.

## 6. Archivos del repo

```
index.html                                  ← toda la app (frontend)
COLLAB.md                                    ← log cronológico detallado de todas las sesiones
HANDOFF_CODEX.md                             ← este documento
supabase/
  README.md                                  ← guía de deploy paso a paso
  sql/
    001_schema.sql                           ← characters, character_progress, raid_reset_baseline + RLS + seed
    002_cron.sql                             ← cron original (30 min, ya reemplazado por 008)
    003_characters_write.sql                 ← policies de INSERT/UPDATE en characters (gestión desde UI)
    004_fix_realms.sql                       ← fix puntual: realm_slug real por personaje (guild cross-realm)
    005_rebaseline_raid_progress.sql         ← fix puntual: reparar baseline corrompido por el bug de "toda la historia como esta semana"
    006_wow_realms.sql                       ← tabla wow_realms + RLS
    007_class_from_api.sql                   ← alter: characters.class pasa a nullable
    008_autosync_5min.sql                    ← corrido 2026-07-08: columna auto_sync + cron a 5 min
  functions/
    sync-characters/index.ts                 ← función principal (ver §4)
    sync-realms/index.ts                     ← función de realms (ver §4)
```

## 7. Contexto de origen (por qué existe el pipeline de Battle.net)

La guild usaba un Google Sheet generado por **wowaudit.com** (un servicio de terceros) para trackear el roster. El usuario pidió primero "clonar" ese Sheet dentro de la misma app, y después directamente reemplazarlo por un pipeline propio contra la Battle.net API (sin depender de wowaudit), para tener control total y no depender de un servicio pago externo. El roster inicial de 23 personajes y sus clases/roles se extrajeron de ese Sheet original (parseando su CSV exportado) como punto de partida.

## 8. Riesgos de seguridad conocidos, sin resolver

Documentados explícitamente en `COLLAB.md`, ninguno bloqueante pero todos pendientes:

1. **Tablas viejas (`sales`/`weeks`/`users`) sin RLS real** — control de rol solo en la UI, no en la base. Mismo patrón se extendió (conscientemente) a `characters` para la gestión de roster.
2. **Credenciales que aparecieron en el chat durante debugging**: el Client Secret de Battle.net y algunas keys de Supabase (`service_role` legacy, `sb_secret_...`) se pegaron en la conversación en algún momento (nunca se ejecutaron directamente en comandos gracias a un bloqueo automático del entorno, pero quedaron visibles en texto). **Recomendado rotarlas.**
3. **API key de wowaudit expuesta** en el Google Sheet original, que está compartido públicamente (no es parte del código de esta app, pero es parte del contexto).

## 9. Pendientes / no implementado (a propósito, con la razón)

- ~~**SQL 008 sin correr**~~ **Resuelto 2026-07-08**: Nicolás confirmó que ya corrió `supabase/sql/008_autosync_5min.sql` (auto-sync a 5 min + toggle).
- **Categoría "Mundo" de la bóveda** — sin datos, Blizzard no lo expone (ver §5).
- **Void-forged, Spark Items, Omnium Folio, Embellishments, Upgrade Tracks Missing** — columnas que tenía el Sheet de wowaudit original, sistemas de crafteo/upgrade específicos de la temporada actual (Midnight) que no se investigaron a fondo todavía; podrían salir del `gear` crudo si se identifican los bonus IDs correspondientes, pero no se hizo.
- **Rotación de secrets** (§8, punto 2).

---

**Para Codex**: si vas a tocar algo de esto, `COLLAB.md` tiene el detalle turno-por-turno de qué se probó, qué falló y por qué se tomó cada decisión — especialmente útil antes de tocar la lógica de `sync-characters` (el baseline semanal y el cálculo de tier tienen gotchas no obvios ya documentados ahí) o el manejo de CORS/auth de las Edge Functions.
