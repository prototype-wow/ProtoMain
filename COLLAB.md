# COLLAB.md — ProtoCarries

Log de colaboración entre sesiones (Claude Code / Codex / otras). Mantener conciso.

---

## 2026-07-06 — Revisión de seguridad + plan de pipeline WoW propio

**Pedido del usuario:**
1. Opinión sobre `index.html` (app de registro de carries) antes de subir a GitHub.
2. Clonar funcionalidades de un Google Sheet dentro del mismo HTML.
3. Luego: reemplazar ese Sheet (generado por wowaudit.com) por un pipeline propio contra la Battle.net API, priorizando equipo/ilvl, Mythic+ y progreso de raid (con detección de "hecho esta semana").

**Hallazgos / decisiones:**
- `index.html` es un tracker de ventas de carries (login por roles, Supabase como backend). Repo: `github.com/jokkidruida/ProtoCarries`.
- ⚠️ Riesgo de seguridad detectado: `SUPABASE_URL`, `SUPABASE_KEY` y la contraseña del admin inicial (`FIRST_ADMIN.pass = "4943"`) están hardcodeadas en el HTML (líneas ~333-336), que se sube a un repo público. La autenticación es 100% client-side: cualquiera con la key puede leer `users.pass_hash` completo o escribir directo en las tablas si no hay RLS configurado en Supabase. **Pendiente de arreglar** (no se tocó en esta sesión): activar RLS, rotar la key y la password del admin, idealmente migrar a Supabase Auth.
- El Google Sheet compartido (`1E_tcRKmM1i9d4OXeyL_7OzyTTbXAGd3SU9F02KSJyuk`) es un template de **wowaudit.com**, no una hoja armada a mano. Tiene 8 pestañas (Summary, Overview, Roster, Great Vault & Gear, Raids, Single View, Professions, Settings, raw_data) alimentadas por su propio backend (que a su vez usa Battle.net Armory + Warcraft Logs para las columnas WCL).
- ⚠️ Otro riesgo: en la pestaña "Settings" de ese Sheet hay una API key de wowaudit pegada en texto plano (`77f261c02f`), visible para cualquiera con el link (la hoja es pública, se pudo exportar como CSV sin login). **Pendiente**: rotar esa key o dejar de compartir la hoja abiertamente.
- Usuario decidió: reconstruir el pipeline de datos de personajes desde cero contra la Battle.net Game Data API (no Warcraft Logs, no todo wowaudit — foco en equipo/ilvl, M+, progreso de raid semanal), usando **Supabase Edge Function** (reutilizando el proyecto ya usado por ProtoCarries) para no exponer el client secret de Blizzard en el HTML.

**Plan detallado** (diseñado, no implementado todavía): ver `C:\Users\Ortiz\.claude\plans\curious-popping-crescent.md` en la máquina de esta sesión (Windows, usuario Ortiz). Resumen del plan:
- Roster inicial: 23 personajes de la guild "Prototype" (Quel'Thalas-US, realm slug `quelthalas`), ya extraídos del Sheet.
- Tablas Supabase nuevas: `characters` (roster), `character_progress` (snapshot actual: ilvl, gear, mythic_rating, mythic_best_runs, raid_progress), `raid_reset_baseline` (snapshot al reset semanal de martes, para poder calcular "jefes matados esta semana" por diff, ya que la Battle.net API no expone eso directo — sí expone M+ "esta semana" directo vía `current_period.best_runs`).
- Endpoints Battle.net a usar: OAuth `https://oauth.battle.net/token` (client_credentials); `profile/wow/character/{realm}/{name}` (ilvl), `.../equipment`, `.../mythic-keystone-profile`, `.../encounters/raids` — todos con `namespace=profile-us`.
- Edge Function `sync-characters` corre cada 30 min vía Cron Job de Supabase (pg_cron), escribe con `service_role` key; el HTML solo lee con la key pública (RLS: SELECT abierto, sin INSERT/UPDATE/DELETE para el rol público).
- Nueva pestaña "Progreso" en `index.html` (solo lectura, todos los roles).
- Fuera de mi alcance: crear la app en develop.battle.net y cargar el client id/secret como secrets de Supabase — acción manual del usuario.

**Estado:** Plan aprobado por el usuario e **implementado** en esta sesión (código escrito y verificado localmente; falta el deploy real por parte del usuario, que requiere sus propias credenciales).

**Archivos nuevos creados:**
- `supabase/sql/001_schema.sql` — tablas `characters` (roster, seed con los 23 personajes), `character_progress` (snapshot actual: ilvl, gear, mythic_rating, mythic_best_runs, raid_progress), `raid_reset_baseline` (baseline semanal); RLS con SELECT público y sin policies de escritura pública.
- `supabase/sql/002_cron.sql` — `pg_cron` + `pg_net` para invocar la Edge Function cada 30 min (el usuario debe reemplazar `<PROJECT_REF>` y `<SERVICE_ROLE_KEY>` antes de correrlo).
- `supabase/functions/sync-characters/index.ts` — Edge Function Deno: OAuth client_credentials contra `oauth.battle.net`, trae `equipment`/`mythic-keystone-profile`/`encounters/raids`/perfil por personaje desde `us.api.blizzard.com` (namespace `profile-us`, realm `quelthalas`), calcula "jefes matados esta semana" diffeando contra `raid_reset_baseline`, y hace upsert en `character_progress`. Maneja errores por personaje sin tumbar el batch entero (`Promise.allSettled`).
- `supabase/README.md` — pasos de deploy: crear client en develop.battle.net, `supabase secrets set BATTLENET_CLIENT_ID/SECRET`, correr el SQL, `supabase functions deploy sync-characters`, probar con `supabase functions invoke`.
- `index.html` — nueva pestaña **Progreso** (visible para todos los roles): `characters`/`characterProgress` como estado global, `fetchAll()` ahora trae esas dos tablas (con try/catch para no romper el resto de la app si todavía no corrieron el SQL), `dataSig()` incluye `character_progress.updated_at` para detectar cambios, `renderProgreso()` arma una tabla (personaje, clase, rol, ilvl, M+ rating, M+ esta semana, jefes de raid esta semana, estado de sync). Verificado que el `<script>` sigue siendo JS válido (`node --check`) después de los cambios.

**Pendiente (fuera de mi alcance, acción del usuario):**
1. Crear la app en https://develop.battle.net/access/clients y conseguir `BATTLENET_CLIENT_ID`/`BATTLENET_CLIENT_SECRET`. ✅ (el usuario ya la creó, 2026-07-06).
2. Correr `supabase/sql/001_schema.sql`, `002_cron.sql` y `003_characters_write.sql` (con los placeholders reemplazados) en el SQL Editor del proyecto. **Pendiente de confirmar que el usuario ya los corrió.**
3. `supabase secrets set` + `supabase functions deploy sync-characters`, y correr `supabase functions invoke sync-characters` una vez para probar.
4. Recordar arreglar los dos riesgos de seguridad detectados y **todavía no corregidos**: (a) `SUPABASE_KEY`/password del admin hardcodeadas en `index.html` línea ~333-336, sin RLS confirmado en `sales`/`weeks`/`users`; (b) API key de wowaudit expuesta en el Google Sheet compartido públicamente.

**Agregado 2026-07-06 (mismo día, follow-up):** el usuario preguntó qué pasa si cambia el roster (entra/sale gente de la guild) — no quería depender de editar SQL a mano cada vez. Se agregó gestión de roster **desde el propio `index.html`**, solo visible para rol Admin (`cap('manageUsers')`, mismo gate que ya usa la pestaña "Usuarios"):
- `supabase/sql/003_characters_write.sql` — agrega policies de INSERT/UPDATE (no DELETE) sobre `characters` para la key pública. Mismo modelo de seguridad que ya tienen `users`/`weeks`/`sales` (el control de "solo admin" es a nivel de la app, no de la base — ya señalado como riesgo pendiente arriba, esto no lo empeora, solo lo extiende de forma consistente).
- `index.html` — en la pestaña "Progreso", si sos Admin ves un botón "+ Personaje" y, por fila, "Editar" / "Dar de baja" (toggle de la columna `active`, no hard-delete — así no se pierde el historial en `character_progress`/`raid_reset_baseline`, y la Edge Function ya filtraba por `active=true` desde el día 1). Nuevas funciones: `openNewChar()`, `openEditChar(id)`, `toggleCharActive(id)`, `charFormFields()`, usando el modal genérico `openM2()` que ya existía para usuarios. Constantes nuevas: `WOW_CLASSES`, `CHAR_ROLE_LABEL`.
- Verificado `node --check` sobre el `<script>` después de este cambio también.

**Agregado 2026-07-06 (deploy real, mismo día):** se completó el deploy end-to-end con el usuario, en vivo. Estado final: **pipeline funcionando, verificado en el navegador con datos reales de Battle.net para los 23 personajes.**

- Instalada Supabase CLI (`npm install -g supabase`, v2.109.0). `supabase login` no funciona en esta sesión no-interactiva (falta TTY/browser) — el usuario lo corrió en su propia terminal, y como corre en su misma cuenta de Windows, las siguientes `supabase` commands desde esta sesión ya quedaron autenticadas sin que el token pasara por el chat.
- `supabase link --project-ref hjatxlvqytgkizcaopce`, `supabase secrets set BATTLENET_CLIENT_ID/SECRET`, `supabase functions deploy sync-characters` — todo corrido desde esta sesión.
- **Bugs encontrados y corregidos durante el debug en vivo:**
  1. `002_cron.sql` fallaba con `schema "net" does not exist` — la extensión `pg_net` hay que habilitarla desde el Dashboard (Database → Extensions), no alcanza con `create extension if not exists` por SQL. Ya resuelto por el usuario.
  2. Primeros intentos de `net.http_post` devolvían `401 UNAUTHORIZED_INVALID_JWT_FORMAT` — el usuario había dejado un `TU` pegado adelante del token real al reemplazar el placeholder `TU_SECRET_KEY`. Una vez corregido, la función respondió `200 {"synced":23,"failed":[]}`.
  3. **Bug real de datos**: los 23 personajes seedeados en `001_schema.sql` tenían `realm_slug='quelthalas'` para todos, pero la guild tiene miembros de **varios realms reales** (quelthalas, ragnaros, sargeras, stormrage — WoW permite guilds cross-realm). Esto causaba 404 silenciosos contra Battle.net para ~11 de los 23 (mi código trata 404 como "sin datos", no como error, así que `failed:[]` quedaba vacío pero los campos quedaban `null`). Se resolvió re-parseando el CSV de `raw_data` de wowaudit (que sí tiene el realm real por personaje en la columna 3 de cada fila-resumen — ojo, esa pestaña tiene *varias tablas apiladas* verticalmente con nombres de personaje repetidos con otro significado en columnas más abajo, hay que quedarse con la *primera* aparición de cada nombre). Se generó `supabase/sql/004_fix_realms.sql` (UPDATE puntual) y se corrigió el seed en `001_schema.sql` para instalaciones futuras.
  4. **Segundo bug real**: la columna "Raid esta semana" mostraba números gigantes (toda la historia de kills del personaje, no solo la semana actual). Causa: en la primerísima sincronización de un personaje no existía `raid_reset_baseline`, y el código comparaba contra `{}` (cero), así que cualquier boss matado *alguna vez* contaba como "esta semana". Corregido en `supabase/functions/sync-characters/index.ts`: si no hay baseline todavía, se inicializa el baseline IGUAL al progreso actual (arranca en 0, no con toda la historia). Se generó `supabase/sql/005_rebaseline_raid_progress.sql` para reparar los baselines ya corrompidos por el bug. Redeployado y verificado: los 23 quedaron en `0` "esta semana" tras el fix.
- Verificado en navegador real (preview server local con `http-server`, `.claude/launch.json` agregado en la raíz del workspace): login como Admin, pestaña "Progreso" muestra ilvl/M+ rating/M+ y raid de esta semana correctos para los 23, botones de gestión de roster visibles.

⚠️ **Seguridad — pendiente de acción del usuario, con más urgencia que antes:** durante el debug, el usuario pegó en el chat (vía captura o texto) tanto el **Client Secret de Battle.net** como la **legacy `service_role` JWT key de Supabase** completa. Los valores literales fueron redactados del log local y no deben subirse al repo. Recomendado (no ejecutado por mí): rotar el Client Secret en develop.battle.net y volver a `supabase secrets set`; regenerar el JWT secret legacy de Supabase (Project Settings → API) y actualizar `002_cron.sql` con el nuevo valor si se sigue usando esa key ahí (o migrar el cron a la key `sb_secret_...` nueva).

**Archivos SQL nuevos de esta ronda:** `supabase/sql/004_fix_realms.sql`, `supabase/sql/005_rebaseline_raid_progress.sql`. `001_schema.sql` y `supabase/functions/sync-characters/index.ts` quedaron editados in-place (ver git diff/historial para el detalle).

**Agregado 2026-07-06 (mismo día, vistas nuevas tipo wowaudit):** el usuario pasó capturas del spreadsheet original (Summary, Overview/gear detail, Roster) y pidió replicar esas vistas dentro de `index.html`. Se agregaron 2 pestañas nuevas y se ampliaron los datos calculados en "Progreso":

- **Great Vault**: confirmado por búsqueda web (Method.gg, Icy Veins) que en Midnight Season 1 los umbrales son **1/4/8 corridas de Mythic+** y **2/4/6 jefes de raid matados** (contando el mayor difficulty por boss si se repitió) para desbloquear los 3 slots de cada categoría. Implementado en `index.html` (`vaultMplusSlots()`, `vaultRaidSlots()`) — cálculo 100% client-side a partir de datos que ya sincroniza la Edge Function, sin tocarla.
- **Encantamientos/gemas faltantes**: calculado desde el `gear` (equipped_items crudo) que ya guarda `character_progress`, revisando `enchantments`/`sockets` por ítem. Es una aproximación (`ENCHANTABLE_SLOTS` es una lista fija de slots típicamente encantables — no confirmada específicamente para Midnight, puede necesitar ajuste si el patch cambió qué slots llevan encantamiento).
- **Pestaña "Resumen"**: cajas de stats (miembros, mazmorras M+ totales, slots de bóveda totales, encant./gemas faltantes totales) + 4 tablas rankeadas (ilvl, M+ rating, M+ esta semana, bóveda). Verificado en navegador: coincide con los números de la captura original que pasó el usuario (ej. Sukidruid #1 en M+ Rating con 3919/3918).
- **Pestaña "Roster"**: composición por rol (Tanks/Healers/Ranged/Melee) desde la tabla `characters` (sin llamar a Battle.net de nuevo), conteo por clase, y tipos de armadura vía mapeo estático `CLASS_ARMOR` (clase→Cloth/Leather/Mail/Plate). Verificado en navegador: coincide exacto con la captura (Tanks 2, Healers 4, Ranged 8, Melee 9, Cloth 5/Leather 6/Mail 6/Plate 6).
- **Explícitamente NO implementado todavía** (el usuario lo sabe, quedó pendiente para más adelante): "Tier Pieces Obtained" (necesita una lista de IDs de ítems del set de tier actual de Midnight, que no tengo — contenido posterior a mi conocimiento) y los sistemas "Void-forged", "Spark Items", "Omnium Folio", "Embellishments", "Upgrade Tracks Missing" (mecánicas de Midnight que el usuario todavía no explicó qué son).
- Verificado `node --check` sobre el `<script>` y probado en navegador real (preview + login Admin) para ambas pestañas nuevas.

⚠️ **Nuevo riesgo de seguridad, mismo patrón que ya existía**: el Client Secret de Battle.net apareció en el chat una vez más al recuperarlo para debug (nunca ejecutado en comandos gracias al bloqueo automático del harness, pero visible en texto). Refuerza la recomendación de rotarlo — ver el punto de arriba, sigue sin hacerse.

**Agregado 2026-07-06 (mismo día, pulido visual — íconos de clase/rol):** el usuario pidió sumar íconos clásicos de clase de WoW + íconos de rol (tanque/dps/healer) y "meterle peso" al apartado gráfico, usando la skill `frontend-design`.

- Diseño: en vez de inventar un sistema visual nuevo, los íconos se integraron al motivo de diamante rotado que la app ya usaba (`.pip`/`.dia`) — decisión deliberada para no competir con la identidad visual existente. Insignia = diamante con borde/glow del color de la clase, ícono adentro contra-rotado para que se vea derecho.
- **Primer intento (SUPERADO, ya no está en el código)**: 13 glifos SVG originales dibujados a mano, con paleta canónica de clase. El usuario pidió iterar sobre esto varias veces (mostró una imagen de un pack de íconos pintados con marca de agua "World of Warcraft Dragonflight" — claramente un asset pago de un artista, no algo con licencia para redistribuir) y finalmente pidió íconos REALES de clase, no reinterpretaciones mías.
- **Solución final (la que quedó)**: los íconos de clase son `<img>` que apuntan (hotlink) a `https://warcraft.wiki.gg/images/ClassIcon_{slug}.png` — la wiki comunitaria de WoW, mismo patrón que usan Wowhead/Raider.io/etc. (enlazar la imagen alojada en otro dominio, no copiar el archivo al repo). Se verificaron las 13 URLs con `curl` antes de usarlas (todas 200; nota: `warcraft.wiki.gg` tiene rate-limit si se pegan más de ~10 requests casi simultáneos, no es un problema real de la app ya que el navegador solo pide cada ícono una vez y lo cachea). **Importante, no repetir el error**: la primera vez usé `https://wow.zamimg.com/...` (funcionaba pero el usuario pidió específicamente warcraft.wiki.gg), y en el camino WebFetch alucinó un subdominio `images.warcraft.wiki.gg` que no existe — las rutas reales son relativas al dominio principal (`warcraft.wiki.gg/images/...`), confirmado bajando el HTML crudo con curl y grepeando los `<img src>` reales en vez de confiar en el resumen de WebFetch.
- Los `<symbol id="ci-*">` del sprite SVG (los 13 glifos dibujados a mano) se **eliminaron** del HTML — quedan solo los símbolos de rol (`ri-tank`, `ri-healer`, `ri-dps`, `ri-ranged`).
- **Íconos de rol**: se separó "ranged" de "melee" (antes compartían el mismo ícono de espadas cruzadas) — ahora ranged tiene un ícono de arco+flecha propio (`ri-ranged`), melee sigue con espadas cruzadas (`ri-dps`). Tank=escudo azul, healer=cruz verde — sin cambios, calcados de los colores de rol del Group Finder de Blizzard.
- CSS: `.classbadge` pasó de diamante (como `.rolebadge`) a **círculo** con `border-radius:50%` + `overflow:hidden` + `<img>` con `object-fit:cover` — tiene más sentido para una foto/ícono real que para un diamante rotado. `.rolebadge` sigue siendo diamante (glifo SVG vectorial, no tocado).
- Gotcha encontrado en el debug: el atributo `loading="lazy"` en las `<img>` de clase hacía que `naturalWidth` quedara en 0 en el entorno de preview automatizado (probablemente el intersection observer no dispara sin un scroll/viewport real) — se sacó el atributo, ahora cargan las 23 imágenes sin problema. Si en un navegador real algún día se quiere optimizar carga, tenerlo en cuenta.
- Verificado en navegador real (login Admin, pestaña Progreso): las 23 filas muestran el ícono de clase real con el anillo de color correspondiente, más "Ranged" con arco y "Melee" con espadas distinguibles a simple vista.

**Agregado 2026-07-07 (mismo día/madrugada, sigue): realm autocomplete + clase automática desde Battle.net.** El usuario pidió que al agregar/editar un personaje ya no se elija la clase a mano (que salga sola de la API) y que el "Servidor" sea un buscador con autocompletado (formato `US-Quel'Thalas`, `EU-Quel'Dorei`, etc.), restringido a elegir de una lista, no texto libre.

- `supabase/sql/006_wow_realms.sql` — tabla `wow_realms(region, slug, name)`, RLS de solo lectura pública (mismo patrón que el resto).
- `supabase/sql/007_class_from_api.sql` — saca el `not null` de `characters.class` (ahora puede quedar vacío hasta el primer sync).
- `supabase/functions/sync-realms/index.ts` — Edge Function nueva, trae `/data/wow/realm/index` de Battle.net para regiones us/eu/kr/tw y llena `wow_realms`. No va en el cron de 30 min (los realms casi no cambian) — se invoca manual, una vez, o de tanto en tanto. **Deployada, pero todavía no logró insertar ninguna fila** (la tabla sigue en 0 registros) — quedó pendiente de debuggear con `select * from net._http_response order by id desc limit 3;`, el usuario nunca llegó a pasar ese resultado porque la conversación se fue para el lado de los íconos. **Retomar esto en la próxima sesión.**
- `supabase/functions/sync-characters/index.ts` — ahora también actualiza `characters.class` con `summary.character_class.name` de Battle.net en cada sync (si difiere de lo que ya había guardado). Deployada y funcionando (ya se vio en el navegador que la clase de los 23 personajes está poblada correctamente).
- `index.html` — `charFormFields()` ya no tiene un `<select>` de Clase; en su lugar hay un buscador de Servidor (`#ch_realm_search` + inputs ocultos `#ch_realm_slug`/`#ch_realm_region`) que filtra contra el array `realms` (cargado en `fetchAll()` vía `sbSel('wow_realms')`) y solo permite click en una sugerencia de la lista (`wireRealmPicker()`), nunca texto libre — si no se elige nada de la lista, `openNewChar`/`openEditChar` rechazan el guardado. Constante `WOW_CLASSES` (ya no usada) se eliminó.
- **Esta función todavía no se puede probar de punta a punta** porque `wow_realms` está vacía (ver bug de `sync-realms` arriba) — el dropdown en el HTML no va a mostrar nada hasta que se resuelva eso.

**Handoff:** el plan de diseño original está en `C:\Users\Ortiz\.claude\plans\curious-popping-crescent.md`. El pipeline, las 3 vistas (Progreso/Resumen/Roster) y el sistema de íconos de clase/rol están **funcionando en producción**.

**Agregado 2026-07-07 (tarde): filtros/búsqueda en Progreso, sub-vistas, Resumen 5-col, restricción de acceso.** El usuario pidió un paquete grande de mejoras; casi todo se pudo hacer client-side derivando datos del `gear` JSON que ya guardábamos (gran hallazgo: el `equipped_items[].set` trae info de tier con `item_set` y `display_string "X/5"`, `enchantments` por slot, `sockets` para gemas, y `stats` por ítem — o sea la mayoría de las columnas "que van a la derecha" del wowaudit son derivables sin re-sincronizar).

- **Acceso**: `visibleTabs()` ahora esconde Progreso/Resumen/Roster/Auditoría salvo para `cap('viewAudit')` (officer + admin). Básico/cargador solo ven Semana/Calendario.
- **Progreso rehecho**: barra con (a) `<select>` de sub-vista, (b) buscador con filtrado en vivo por nombre/clase/rol (autocompletado tipo "conforme tipeás"), (c) filtro por clase, (d) filtro por rol, (e) contador "N de M". El buscador NO pierde foco al tipear porque solo se re-renderiza `#prog_table` (no toda la vista) vía `renderProgTable()`. Columnas numéricas ordenables (click en header, toggle asc/desc) vía `progSort` + `wireSort()`.
- **Sub-vistas de Progreso** (dropdown `PROG_VIEWS`): General, Equipo por slot (ilvl de cada una de las 16 piezas), Piezas de tier (count X/5 + ilvl por slot de tier), Encantamientos (grilla ✓/✕ por slot encantable), Gemas (puestas / sockets vacíos), Distribución de stats (Crit/Haste/Mast/Vers % sumando todo el equipo), Bóveda (nivel de key del 1º/4º/8º M+ y dificultad del 2º/4º/6º jefe de raid). Helpers nuevos: `gearBySlot`, `itemIlvl`, `tierInfo`, `statDist`, `enchantGrid`, `vaultMplusDetail`, `vaultRaidDetail`. Constantes: `TIER_SLOTS`, `GEAR_SLOT_ORDER`, `SECONDARY_STATS`, `DIFF_RANK/LETTER/COLOR`.
- **Bug corregido en el camino**: `vaultMplusDetail` usaba `r.mythic_level` pero el campo real de la API es `keystone_level` (verificado inspeccionando el JSON guardado — un run trae `keystone_level:12`). Ya arreglado, ahora la vista Bóveda muestra los niveles de key reales.
- **Resumen a 5 columnas** estilo "Audit Summary" de wowaudit: Item Level, Piezas de tier, Mazmorras M+ hechas (semana), Opciones de bóveda (M++raid de 6), Mythic+ Rating — cada una es una tabla rankeada con ícono+color de clase. Stat boxes arriba: Miembros, Mazmorras M+ semana, Encant./gemas faltantes, Opciones de bóveda faltantes. Verificado contra las capturas del usuario: Merengw/Tokkï 5/5 tier, Sukidruid #1 M+ rating, ilvl top Viriviri/Denisse/Exxé — todo cruza.
- Verificado en navegador real (login Admin): filtros, búsqueda en vivo (2 resultados para "mage", foco preservado), las 6 sub-vistas renderizan bien y cruzan con wowaudit, Resumen 5-col OK.

**NO implementado (charlado con el usuario, necesita más data o decisiones):**
- ~~**Autocompletado de servidor sigue sin andar**~~ **RESUELTO 2026-07-07**: el usuario invocó `sync-realms` correctamente (el problema anterior era que la tabla no existía todavía cuando invocó, o el invoke apuntó mal). Ahora `wow_realms` tiene **797 realms** (US/EU/KR/TW). Verificado en el HTML: el buscador de "Servidor" en Nuevo/Editar personaje autocompleta bien — escribir "quel" muestra `US-Quel'dorei`, `US-Quel'Thalas`, `EU-Quel'Thalas`, `TW-Quel'dorei`, y al elegir uno guarda slug+region correctos. Funcionalidad de realm + clase-automática 100% cerrada y andando.
- **Dificultad de tier por letra (M/H/N)**: se muestra el ilvl por slot de tier en vez de la letra, porque no tengo la tabla de breakpoints ilvl→dificultad de Midnight S1. Si el usuario la pasa, mapear ilvl→letra es trivial.
- **Bóveda por letra M/H/N/V exacta**: se muestra nivel de key / dificultad cruda en vez de la letra del track de recompensa, por la misma razón (no tengo la tabla key-level→track de la season). Es honesto y el jugador lo lee igual.
- **Columnas wowaudit que NO están en la API de forma simple**: Void-forged, Spark Items, Omnium Folio, Embellishments, Upgrade Tracks Missing — sistemas de crafteo/upgrade de Midnight. Algunos (embellishments) se podrían detectar del gear si tuviera los bonus IDs de embellishment; los otros requieren endpoints/lógica que no vale la pena todavía. Quedaron afuera, el usuario lo sabe.

**Agregado 2026-07-07 (layout ancho + fix de números cortados):** el usuario notó que en el Resumen los números se cortaban (ej. "293.00" → "29") y pidió ensanchar la interfaz + mobile-friendly.
- `.wrap` de `max-width:1200px` → `1680px`, con padding horizontal responsive `clamp(12px,3vw,34px)`. `.summary` base a `repeat(auto-fit,minmax(160px,1fr))`.
- **Causa real del corte** (diagnosticado midiendo con preview_eval `getBoundingClientRect`: valor en right=231 vs panel en 179 → lo comía el `overflow:hidden` del `.panel`): las filas del ranking eran `<table>` con `table-layout:fixed`+`td.vl{width:1%}`, que no deja ajustar la celda al contenido y el número con `nowrap` se desbordaba. **Fix**: `rankTable()` reescrito de tabla a **flexbox** (`.rankrow`: `rk` fijo + `nm` flex:1 min-width:0 con ellipsis + `vl` flex:none nowrap). Nombre largo → "…", número siempre entero.
- Media queries nuevas `@860px` y `@560px`. Verificado por DOM en 375/1440/1900px: cero desborde, cero scroll horizontal. (El screenshot tool tuvo timeouts intermitentes toda la sesión; se verificó por medición, más confiable.)

**Agregado 2026-07-07 (noche): tier letras, bóveda 9 slots, botón refrescar + auto-sync toggle.**
- **Tier por letra**: en vez de "5/5" ahora muestra la letra de dificultad por slot (M/H/N/V), coloreada (M naranja #f0821e, H violeta oscuro #7c4dbf, N azul #2f8fe0, V verde #2fbf71 — colores pedidos por el usuario). El dato NO trae el track limpio (el `name_description` de las piezas a 289 dice "Mythic+"/"Mythic" sin palabra de track), así que se mapea **ilvl→letra** con la constante editable `TIER_ILVL_BREAKS = [[285,'M'],[272,'H'],[259,'N'],[0,'V']]`, calibrada cruzando con el CSV de wowaudit (289 y 298 = M, confirmado: Merengw/Tokkï = M M M M M). Si aparecen piezas más bajas y las letras no coinciden, ajustar esa constante. Funciones: `tierLetter`, `tierLettersHtml`, `tierScore`. Aplicado en la sub-vista Tier de Progreso y en la columna del Resumen.
- **Bóveda 9 slots**: `progVaultView` ahora tiene 3 categorías (Mazmorra 1/4/8 keys · Raid 2/4/6 jefes · Mundo/Delves 2/4/8). Mazmorra+Raid se llenan con datos reales; **Mundo queda en "—"** porque los delves/actividades de mundo NO vienen en los endpoints de la API que uso (equipment/mythic-keystone/encounters). wowaudit los saca por su backend; no hay endpoint público limpio para "delves de esta semana". Queda documentado en el footer de esa vista.
- **Botón "↻ Refrescar API"** (en toolbar de Progreso, visible a officer+admin) + **toggle "Auto-sincronizar"** (en Usuarios, admin). Descubrimiento clave: la **publishable key** (`sb_publishable_...`) que YA está en el HTML **puede invocar la Edge Function** (el gateway de Supabase la acepta) — así que el botón llama a `sync-characters` sin `--no-verify-jwt` (bloqueado por el classifier, con razón) y sin agregar keys nuevas. Cero cambio de seguridad.
  - Función `sync-characters` actualizada: (a) **CORS** (maneja OPTIONS + headers `Access-Control-Allow-Origin:*` — sin esto el fetch del browser fallaba con "Failed to fetch", el curl funcionaba porque no hace preflight); (b) **throttle** de 60s (ignora si ya sincronizó hace <1min, evita spam del botón); (c) **param `source`**: `{"source":"cron"}` respeta el toggle `auto_sync`, `{"source":"manual"}` (botón) siempre corre. Redeployada.
  - HTML: `manualSync(btn)` hace POST con la publishable key, muestra toast según respuesta (synced N / "datos frescos" / error), y refresca. Toggle `swAutoSync` escribe `app_settings.auto_sync`. `settings` default suma `auto_sync:true`.
- ~~**PENDIENTE — el usuario tiene que correr `supabase/sql/008_autosync_5min.sql`**~~ **RESUELTO 2026-07-08, confirmado por Nicolás**: este SQL agrega la columna `app_settings.auto_sync` y reprograma el cron de 30min → **5min** con `body {"source":"cron"}`. Nota histórica: antes de correrlo, el botón manual funcionaba pero el toggle podía fallar y el auto-refresh seguía en 30min.

**Agregado 2026-07-07 (tarde-noche): tier letra por ORIGEN, no ilvl + fuente.** El usuario notó que wowaudit muestra piezas M y H a un mismo ilvl (ej. Merengw y Jarvo, ambos legs 289, una M otra H) — o sea la letra es el **track/origen** de la pieza, no el ilvl actual (los upgrades igualan ilvls de piezas de distinto origen). Analizando el dato: las piezas de tier a 289 vienen en 2 grupos por `context`/`name_description` — `ctx=6 "Mythic"` (raid Mítico) y `ctx=35 "Mythic+"`. **Fix**: `pieceLetter(it)` deriva la letra de la primera palabra de `name_description.display_string` (`NAMEDESC_LETTER`: /^mythic/→M, /^heroic/→H, /^normal/→N, /^(veteran|champion|…)/→V), con ilvl (`TIER_ILVL_BREAKS`) solo de respaldo si no hay name_description. `tierInfo.slots[s]` ahora es `{letter, ilvl}`. **Dato importante**: TODO el tier del roster actual es de origen Mítico (Mythic/Mythic+), así que "todo M" es correcto para el estado actual — la captura de wowaudit del usuario (06/07) era de cuando algunos tenían piezas Heroicas. Cuando alguien tenga una pieza H/N/V real, va a salir bien porque el `name_description` lo dice. Verificado: letras siguen M (correcto), fuente ahora Inter (font-body, = nombres) a 14.5px (pedido del usuario, "un poquito más grande"), clase `.tierL`.

**Pendiente de siempre**: rotar los secrets expuestos (Battle.net Client Secret + Supabase legacy service_role JWT + `sb_secret_...`) y los 2 riesgos de seguridad de fondo (`index.html` credentials hardcodeadas + wowaudit key en el Sheet público). (`sync-realms` ya corrido: `wow_realms`=797; SQL 008 confirmado corrido el 2026-07-08 por Nicolás.)

### 2026-07-08 - Codex - Revision de handoff/docs

- Pedido: Nicolas pidio revisar `ProtoCarries`, especialmente los dos `.md`, y dar una opinion general.
- Acciones: lei el `COLLAB.md` del workspace, `ProtoCarries/COLLAB.md` y `HANDOFF_CODEX.md`; liste archivos del repo; revise puntos sensibles en `index.html`, `supabase/functions/sync-characters/index.ts` y `supabase/sql/008_autosync_5min.sql`; corri `git status --short`, `rg --files`, busquedas con `rg` sobre seguridad/pendientes, y chequeo de sintaxis JS extrayendo el `<script>` de `index.html` con Node.
- Verificacion: el JavaScript embebido parsea correctamente (`script syntax OK`). `git status` muestra cambios/untracked previos (`index.html`, docs y `supabase/`), no generados por esta revision.
- Opinion/handoff: el handoff esta bien armado y bastante honesto; el proyecto ya tiene una arquitectura razonable para reemplazar wowaudit con Edge Functions + Battle.net API. En ese momento la prioridad era correr/confirmar SQL 008; luego Nicolas confirmo que ya lo hizo. Siguen pendientes rotar secrets expuestos y cerrar la deuda de seguridad real de usuarios/tablas viejas con Supabase Auth/RLS en base. No se hicieron cambios funcionales.

### 2026-07-08 - Codex - SQL 008 confirmado

- Pedido/actualizacion: Nicolas aviso que ya corrio `supabase/sql/008_autosync_5min.sql`.
- Acciones: actualice `HANDOFF_CODEX.md` y esta nota para sacar SQL 008 de la lista de pendientes activos.
- Verificacion: no se verifico contra Supabase desde esta sesion; queda como estado confirmado por el usuario. Lo que sigue pendiente son la rotacion de secrets expuestos y el endurecimiento de seguridad/RLS/Auth.

### 2026-07-08 - Codex - Ajustes Resumen Great Vault / tier / ilvl

- Pedido: Nicolas pidio alinear el Resumen con el spreadsheet: Great Vault son 9 opciones, mostrar opciones M/H/N/V con colores como tier, agregar columnas de tier `H S C G L`, y mostrar item level con decimales reales sin redondear a entero.
- Decisiones: se confirmo en Wowhead que Great Vault usa 3 categorias x 3 slots: Raid 2/4/6, Dungeons 1/4/8, World 2/4/8. Como la app no tiene datos de World/Delves, esos 3 slots quedan como faltantes y no se inventan valores. M+ se clasifica por key para el resumen de tracks (`10+` => M, debajo => H segun tabla actual de Wowhead); Raid usa dificultad real de kills; LFR/Raid Finder se muestra como V.
- Acciones: edite `index.html` para calcular item level desde `gear` equipado, mostrar Resumen con tier `# H S C G L`, mostrar Great Vault como M/H/N/V sobre `/9`, recalcular faltantes contra 9 opciones por personaje, y usar los colores de tier para los numeros/letras de Vault. Agregue `tests/protocarries-summary.test.js` como prueba Node de helpers puros extraidos del HTML.
- Verificacion: primero la prueba fallo por helper inexistente (`gearEquippedIlvl is not defined`), luego paso `node tests\protocarries-summary.test.js` con `protocarries summary helpers OK`. Tambien paso el parseo del script embebido con Node (`script syntax OK`). Quedo un server local corriendo en `http://127.0.0.1:4173/` para revisar visualmente.
- Handoff: `git status` ya tenia cambios/untracked previos (`index.html`, docs y `supabase/`); esta sesion agrega cambios sobre `index.html`, `COLLAB.md` y nuevo `tests/`.

### 2026-07-08 - Codex - Pulido Resumen alineacion / contador Vault

- Pedido: Nicolas pidio que las listas del Resumen arranquen a la misma altura y que en Opciones de boveda no quede solo `/9`, sino que se pueda contar claramente el total de cofres/opciones.
- Acciones: edite `index.html` para que `rankTable()` siempre renderice fila de encabezado (tambien en Mazmorras M+ hechas y Mythic+ Rating), alineando la primera fila de las 5 listas. `vaultSummaryHtml()` ahora muestra `total/9` (ej. `3/9`) despues de las columnas M/H/N/V, en vez de solo `/9`.
- Tests: actualice `tests/protocarries-summary.test.js` para exigir `3/9` y una fila `rankrow rankhead` aun en rankings simples.
- Verificacion: primero la prueba fallo por el comportamiento anterior (`/9` sin numerador), luego paso `node tests\protocarries-summary.test.js` (`protocarries summary helpers OK`) y el parseo del script embebido (`script syntax OK`). El server local sigue corriendo en `http://127.0.0.1:4173/`.

### 2026-07-08 - Codex - Investigacion Blizzard API habilidades por clase

- Pedido: Nicolas pregunto si por Battle.net / Blizzard API se pueden obtener habilidades de cada clase.
- Acciones: revise documentacion oficial de World of Warcraft Game Data APIs en Battle.net y use conocimiento de endpoints (`playable-class`, `playable-specialization`, `talent-tree`, `spell`).
- Conclusion: se puede obtener informacion parcial/estructurada de clases, specs, talentos y spells por ID, pero no hay un endpoint simple que devuelva "todas las habilidades base de una clase" listo para UI. Para una vista de roster con utilidades/skills conviene combinar Battle.net para datos vivos con una tabla curada propia de habilidades relevantes.
- Follow-up: Nicolas aclaro que quiere ver que habilidades se pueden sacar del API. Propuesta: crear una Edge Function temporal/debug `inspect-wow-spells` o script Deno local con secrets del entorno Supabase, que consulte `playable-class`, `playable-specialization`, `talent-tree`, y `spell/{id}` para generar un JSON/Markdown con los spells descubiertos por clase/spec. No poner secrets ni dumps grandes en `index.html`.

### 2026-07-08 - Codex - Edge Function debug inspect-wow-spells

- Pedido: Nicolas dijo que le gustaria ese enfoque para ver que habilidades se pueden sacar de Blizzard API.
- Decisiones: se implemento como Edge Function exploratoria, no como frontend directo, para no exponer `BATTLENET_CLIENT_SECRET` ni meter dumps grandes en `index.html`. No escribe en DB; solo devuelve JSON con clases/specs/spells descubiertos y sus fuentes (`spec:*`, `talent-tree:*`).
- Acciones: agregue `supabase/functions/inspect-wow-spells/index.ts`, helper testeable `supabase/functions/inspect-wow-spells/helpers.mjs`, documentacion en `supabase/README.md`, y test `tests/inspect-wow-spells.test.mjs`. La funcion acepta `class`, `maxClasses`, `maxSpecs`, `maxSpells`, `includeRaw` por POST o querystring.
- Verificacion: paso `node tests\inspect-wow-spells.test.mjs` (`inspect-wow-spells helpers OK`) y `node tests\protocarries-summary.test.js` (`protocarries summary helpers OK`). No se pudo correr `deno check` local porque `deno` no esta instalado. No se deployo a Supabase desde esta sesion.
- Handoff: para probar remoto, deployar con `supabase functions deploy inspect-wow-spells` y llamar por ejemplo `supabase functions invoke inspect-wow-spells --body '{"class":"Mage","maxSpells":40}'`.

### 2026-07-08 - Codex - Debug comando inspect-wow-spells en Windows

- Pedido: Nicolas aviso que `supabase functions invoke inspect-wow-spells --body '{"class":"Mage","maxSpells":40}'` le tira error.
- Acciones: revise el entorno local. En PowerShell, `supabase` falla porque intenta cargar `supabase.ps1` y Windows bloquea scripts (`running scripts is disabled`). Usar `supabase.cmd` evita esa ruta. Al intentar `supabase.cmd ... --help` dentro del sandbox de Codex, el CLI fallo por no poder escribir telemetry en `C:\Users\Ortiz\.supabase\telemetry...` (`EPERM`), probablemente por permisos del sandbox, no necesariamente por el entorno real del usuario.
- Handoff: responder al usuario con comandos Windows usando `supabase.cmd`, aclarar que primero debe deployar la funcion y que no hay SQL. Si el error persiste, pedir el texto exacto: puede ser no deployada, invoke local vs remoto, JWT/project-ref, secrets Battle.net, quoting JSON, o telemetry/permiso.

### 2026-07-08 - Codex - Supabase CLI sin functions invoke

- Pedido: Nicolas mando captura del error: su CLI muestra subcomandos de `supabase functions` (`list/delete/download/deploy/new/serve`) pero no `invoke`; tambien marca `--project-ref` y `--body` como flags no reconocidos para `functions`.
- Decision: en esta version del CLI hay que linkear el proyecto una vez (`supabase.cmd link --project-ref ...`), deployar sin `--project-ref`, y probar la funcion con `curl.exe` directo contra `https://<project-ref>.supabase.co/functions/v1/inspect-wow-spells`.
- Handoff: responder con comandos PowerShell concretos; usar Authorization/apikey con la publishable key/anon key del proyecto porque Edge Functions verifican JWT por defecto.

### 2026-07-08 - Codex - inspect-wow-spells deployado, error Invalid JWT

- Pedido: Nicolas mando captura nueva: `supabase.cmd link` y `supabase.cmd functions deploy inspect-wow-spells` funcionaron, pero la prueba HTTP devolvio `UNAUTHORIZED_INVALID_JWT_FORMAT / Invalid JWT` y `curl` marco `unmatched close brace/bracket`.
- Diagnostico: `$KEY` quedo como placeholder (`"TU_PUBLISHABLE_KEY_O_ANON_KEY"`), por eso Supabase rechaza el Authorization. El JSON tambien se rompio por escaping/line continuation de PowerShell.
- Handoff: recomendar extraer la key publica automaticamente desde `index.html` (`SUPABASE_KEY`) y probar con `Invoke-RestMethod` en vez de `curl.exe` para evitar problemas de comillas.

### 2026-07-08 - Codex - inspect-wow-spells prueba exitosa + fix defaults

- Pedido: Nicolas mando captura preguntando "asi?" luego de ejecutar `Invoke-RestMethod`; la funcion respondio con `generated_at`, `region`, `classes`, etc.
- Diagnostico: la prueba remota funciono. PowerShell solo estaba colapsando objetos anidados como `System.Object[]`. En el output se vio ademas que `limits.maxClasses` y `limits.maxSpecs` quedaban en `1` aunque no se pasaran; bug por `Number(null) === 0` en `clampInt`.
- Acciones: edite `supabase/functions/inspect-wow-spells/index.ts` para que `clampInt(null/undefined/"")` use el fallback real, asi por defecto vuelve a `maxClasses=13` y `maxSpecs=36`.
- Verificacion: pasaron `node tests\inspect-wow-spells.test.mjs` y `node tests\protocarries-summary.test.js`. Falta redeploy remoto para que Supabase use este fix.

### 2026-07-08 - Codex - inspect-wow-spells output Mage completo

- Pedido: Nicolas pego salida completa de `Invoke-RestMethod` + `ConvertTo-Json -Depth 30`.
- Resultado: la funcion remota respondio correctamente para `class=Mage`, `maxSpecs=3`, `maxSpells=40`; limites correctos (`maxClasses=13`, `maxSpecs=3`, `maxSpells=40`), clase Mage, `specs_checked=3`. Arcane muestra `refs_found=141`, `returned_spells=40`, `talent_trees_checked=3`; el dump contiene spells como Remove Curse, Arcane Missiles, Spellsteal, Dragon's Breath, Ice Block, Greater Invisibility, Ring of Frost, Shimmer, Alter Time, etc.
- Interpretacion: Blizzard API sirve para descubrir muchas referencias de spells/talentos con icono/descripcion, pero devuelve mezcla de activos, pasivos y modificadores. Para UI final de roster hay que filtrar/curar utilidades relevantes.

### 2026-07-08 - Codex - Roster rediseñado estilo spreadsheet

- Pedido: Nicolas pidio cambiar la pestaña Roster a un diseño parecido al spreadsheet, pero mas bonito, usando como referencia la captura con `Main Roster of Prototype`.
- Decisiones: se mantuvo el tema oscuro de Prototype y se llevo la estructura del spreadsheet a una grilla: titulo superior, columna de clases con filas coloreadas, cuatro tablas por rol con columnas `Name`/`Class`, celdas de clase con color canonico WoW, filas vacias sutiles para igualar alturas, y panel lateral con `Composition` + `Armor Types`.
- Acciones: edite `index.html` agregando CSS `.roster*` y reemplazando `renderRosterComp()`; agregue `tests/protocarries-roster-ui.test.js` para renderizar un roster fake y verificar que existan `rosterSheet`, role tables, celdas de clase y summaries.
- Verificacion: pasaron `node tests\protocarries-roster-ui.test.js`, `node tests\protocarries-summary.test.js`, `node tests\inspect-wow-spells.test.mjs`, y parseo del script embebido (`script syntax OK`). Se levanto server local simple en `http://127.0.0.1:4173/` y responde HTTP 200. Playwright no se pudo usar porque el runtime local tiene `playwright` sin `playwright-core`.

### 2026-07-08 - Codex - Roster vuelve a composición + base habilidades

- Pedido: Nicolas pidio devolver la parte superior de Roster al diseño anterior de "Composición del roster"; poner Clases/Tipos de armadura en español; sacar fondos de color de las filas de clase y usar texto coloreado por clase; agregar icono de rol en cada fila de Composición; y preparar un bloque futuro de personajes por habilidades (grip, inmunes, mass dispel, etc.) configurable desde Usuarios por spell id, clase y grupo.
- Decisiones: se mantuvo el tema oscuro y se reemplazo el diseño tabular del roster por tarjetas por rol como antes. Las clases y armaduras vuelven a panels inferiores (`Clases`, `Tipos de armadura`) con texto de clase coloreado, no fila pintada. Se agrego `Composición` como tercer panel con iconos de rol. Para habilidades se creo una tabla propia `tracked_abilities`; cada habilidad se asigna a una clase y grupo, y Roster muestra personajes activos de esa clase dentro del grupo.
- Acciones: edite `index.html` para agregar `ARMOR_LABEL`, `trackedAbilities`, fetch con fallback si falta la tabla, nuevo `renderTrackedAbilityBoard`, UI de Usuarios para buscar spell por ID / agregar / borrar habilidades, y estilos `.ability*` / `.rosterRoleGrid`. Modifique `supabase/functions/inspect-wow-spells/index.ts` para aceptar `{spellId}` y devolver el spell compacto con nombre/icono/descripcion. Agregue `supabase/sql/009_tracked_abilities.sql`. Actualice `tests/protocarries-roster-ui.test.js`.
- Verificacion: pasaron `node tests\protocarries-roster-ui.test.js`, `node tests\protocarries-summary.test.js`, `node tests\inspect-wow-spells.test.mjs`, y parseo del script embebido (`script syntax OK`). Server local `http://127.0.0.1:4173/` responde 200.
- Handoff: para activar todo en Supabase, Nicolas debe correr `supabase/sql/009_tracked_abilities.sql` en SQL Editor y redeployar `inspect-wow-spells` con `supabase.cmd functions deploy inspect-wow-spells` para que el boton "Buscar" por spell id funcione remoto.

### 2026-07-08 - Codex - Roster layout compacto tipo spreadsheet

- Pedido: Nicolas marco que las tarjetas de roles y los paneles inferiores del Roster seguian demasiado anchos; quiere mantener la composicion por rol, pero con ventanas mas angostas y balanceadas como el spreadsheet.
- Decisiones: no se cambio la estructura ni la logica de datos; solo se ajustaron proporciones. Las tarjetas de roles pasan a columnas fijas compactas y los paneles `Clases`, `Tipos de armadura` y `Composicion` pasan a tres columnas compactas, sin estirarse con `1fr`. El bloque futuro de habilidades queda alineado al ancho de las cuatro tarjetas.
- Acciones: edite CSS en `index.html` (`.rosterRoleGrid`, `.rosterRoleCard`, `.rosterPerson`, `.rosterSummaryGrid`, `.abilityBoard` y breakpoints 1100/620px).
- Verificacion: pasaron `node tests\protocarries-roster-ui.test.js`, `node tests\protocarries-summary.test.js`, `node tests\inspect-wow-spells.test.mjs`, parseo del script embebido (`script syntax OK`), y el server local `http://127.0.0.1:4173/` responde 200.
- Handoff: el cambio es visual/CSS; si Nicolas quiere aun mas parecido al spreadsheet, el siguiente ajuste seria reducir `248px` a `230-240px` o mover los paneles inferiores a un layout de dos columnas con `Composicion` debajo de `Clases`.

### 2026-07-08 - Codex - Roster en tres zonas

- Pedido: Nicolas propuso una composicion tipo esquema: `Clases` a la izquierda, roles al centro, y `Composicion`/`Tipos de armadura` a la derecha, con `Habilidades trackeadas` debajo.
- Decisiones: se adopto esa estructura porque se parece mas al spreadsheet y reduce la sensacion de tarjetas flotando. La zona central queda como lectura principal; los laterales funcionan como resumen fijo.
- Acciones: edite `index.html` para agregar la grilla `.rosterBoard` con `.rosterClassCard`, `.rosterMain` y `.rosterAside`; movi `Clases` al lateral izquierdo, `Composicion` + `Tipos de armadura` al lateral derecho, y mantuve las tarjetas de rol en el centro. Actualice `tests/protocarries-roster-ui.test.js` para verificar la nueva estructura.
- Verificacion: pasaron `node tests\protocarries-roster-ui.test.js`, `node tests\protocarries-summary.test.js`, `node tests\inspect-wow-spells.test.mjs`, y parseo del script embebido (`script syntax OK`). Se levanto server local real en `http://127.0.0.1:4173/`; responde `200` y sirve el HTML de Prototype.
- Handoff: hay un server Node local corriendo en `4173` para revisar la vista. El cambio sigue siendo solo frontend; no requiere SQL nuevo.

### 2026-07-08 - Codex - Roster titulos laterales externos

- Pedido: Nicolas pidio sacar los headers internos de `Clases`, `Composicion` y `Tipos de armadura`, ponerlos como titulos tipo `Composicion del roster`, y decidir si los contadores laterales debian alinearse con las barras de rol o con las primeras filas de personajes.
- Decision: elegi alinear los contadores con las barras de rol (`Tanks`/`Melee`), no con `Khansos`/`Akanthor`, porque hace que el layout lea como una sola planilla y no como contenido lateral hundido.
- Acciones: edite `index.html` para agregar `.rosterSideBlock` y `.rosterCounterPanel`; movi los titulos laterales a `sectitle` externos y quite los `.phead` internos de esos paneles. Ajuste el padding inicial de los contadores. Actualice `tests/protocarries-roster-ui.test.js`.
- Verificacion: pasaron `node tests\protocarries-roster-ui.test.js`, `node tests\protocarries-summary.test.js`, `node tests\inspect-wow-spells.test.mjs`, y parseo del script embebido (`script syntax OK`). Server local `http://127.0.0.1:4173/` responde `200` y sirve HTML de Prototype.
- Handoff: cambio solo visual; no requiere SQL.

### 2026-07-08 - Codex - SQL 009 entregado

- Pedido: Nicolas pidio el contenido de `supabase/sql/009_tracked_abilities.sql` para poder crear la tabla `tracked_abilities` en Supabase y destrabar el boton Agregar de habilidades trackeadas.
- Acciones: lei el archivo `supabase/sql/009_tracked_abilities.sql` y lo pase en el chat para copiar en SQL Editor.
- Verificacion: el archivo existe y contiene la tabla, RLS y policies publicas de select/insert/update/delete para el modelo actual de la app.
- Handoff: despues de correr SQL 009, si el boton "Buscar" por spell id no trae datos, falta redeployar `inspect-wow-spells`.

### 2026-07-08 - Codex - Editar habilidades + filtro por rol

- Pedido: Nicolas pidio poder editar habilidades trackeadas ya creadas y definir para cada cooldown uno o varios roles (`tank`, `healer`, `ranged`, `melee`), tanto al agregar como al editar. En Roster, la lista de personajes bajo cada habilidad debe filtrar por clase + rol.
- Decisiones: se agrego columna `role_filter text[]` a `tracked_abilities`; las habilidades existentes y las que no tengan esa columna se tratan como aplicables a los 4 roles para no romper compatibilidad.
- Acciones: edite `index.html` para agregar selector visual de roles, boton `Editar`, modal de edicion, helpers `abilityRoles`/`abilityAllowsRole`, filtrado en `renderTrackedAbilityBoard`, y tags de roles visibles en la lista. Actualice `supabase/sql/009_tracked_abilities.sql` para instalaciones nuevas y agregue `supabase/sql/010_tracked_ability_roles.sql` para migrar la DB actual. Actualice `tests/protocarries-roster-ui.test.js` con una prueba que falla si un Mage tank aparece en una habilidad limitada a ranged.
- Verificacion: TDD rojo confirmado primero (`Frostwall` aparecia bajo `Ice Block` pese a `role_filter:["ranged"]`). Luego pasaron `node tests\protocarries-roster-ui.test.js`, `node tests\protocarries-summary.test.js`, `node tests\inspect-wow-spells.test.mjs`, y parseo del script embebido (`script syntax OK`). Server local `http://127.0.0.1:4173/` responde `200`.
- Handoff: Nicolas debe correr `supabase/sql/010_tracked_ability_roles.sql` en Supabase antes de usar roles/editar guardando `role_filter`; si no, el guardado puede fallar con error de columna inexistente.

### 2026-07-08 - Codex - Pulido visual habilidades trackeadas

- Pedido: Nicolas marco visualmente que las tarjetas de `Habilidades trackeadas` quedaban apretadas, especialmente cuando nombre, spell id y chips de roles caian en una sola linea.
- Decisiones: se separo la linea del spell (`abilityTitle`) de los chips de roles (`abilityRoleTags`) para evitar cortes/overflow y que cada tarjeta respire mejor.
- Acciones: edite CSS y markup en `index.html` para que `.abilitySpell` use grid, el icono ocupe dos filas, el nombre + id queden arriba y los roles abajo con wrap. Actualice `tests/protocarries-roster-ui.test.js` para exigir `abilityTitle` y `abilityRoleTags`.
- Verificacion: primero el test fallo por ausencia de la nueva estructura; despues pasaron `node tests\protocarries-roster-ui.test.js`, `node tests\protocarries-summary.test.js`, `node tests\inspect-wow-spells.test.mjs`, y parseo del script embebido (`script syntax OK`). Server local `http://127.0.0.1:4173/` responde `200`.
- Handoff: cambio solo visual/frontend; no requiere SQL.

### 2026-07-08 - Codex - Exploracion vista individual de personaje

- Pedido: Nicolas pidio primero verificar si se pueden obtener los datos de las consultas actuales y recordar que la nueva vista tipo `Single Character View` debe ir en una solapa nueva, solo visible para officers/admins segun reglas anteriores.
- Hallazgos: `fetchAll()` hoy consume `weeks`, `sales`, `users`, `app_settings`, `audit_log`, `characters`, `character_progress`, `wow_realms` y `tracked_abilities`. Se verifico contra Supabase con conteos no sensibles: weeks=4, sales=2, users=8, app_settings=1, audit_log=96, characters=23, character_progress=23, wow_realms=797, tracked_abilities=6. Tambien se confirmo que `character_progress` devuelve snapshots reales con `equipped_ilvl`, `gear`, `mythic_rating`, `mythic_best_runs`, `raid_progress` y `updated_at`.
- Decisiones: la vista puede implementarse sin SQL nuevo si se limita a datos ya persistidos: selector de personaje, equipo equipado, ilvl real, M+ semanal/rating, raid semanal, enchants/gems, tier, links y quick info basica desde `characters`. Se confirmo en una muestra de `gear` que los items y enchants traen nombres/display strings suficientes para una tabla de equipo/enchants. Profesiones, gender/race, achievements, mounts/pets y reputaciones/renown no estan persistidos hoy; para clonarlos 1:1 haria falta ampliar `sync-characters` y probablemente `character_progress`.
- Handoff: antes de implementar, proponer/validar con Nicolas una version V1 que reutilice datos existentes. La nueva tab debe engancharse a `cap('viewAudit')` como Progreso/Resumen/Roster/Auditoria, no a usuarios basicos/cargadores.

### 2026-07-08 - Codex - SQL 011 datos extra personaje

- Pedido: Nicolas pidio el SQL para la info restante de la vista individual.
- Decisiones: se agregan columnas nullable/default-vacias en `character_progress`, sin tocar tablas ni datos existentes. Se usan JSONB para conservar respuestas crudas (`profile`, `professions`, `achievements`, `reputations`, `collections`) y escalares para datos rapidos de UI (`race`, `gender`, `faction`, `level`, `achievement_points`, `mounts_count`, `pets_count`, `exalted_reputations_count`).
- Acciones: cree `supabase/sql/011_character_extra_info.sql` y actualice `supabase/sql/001_schema.sql` para instalaciones nuevas.
- Verificacion: revise el contenido con `Get-Content` y busque las columnas en ambos SQL con `rg`. No se ejecuto contra Supabase desde esta sesion.
- Handoff: despues de correr SQL 011, falta actualizar y redeployar `sync-characters` para poblar estos campos.

### 2026-07-08 - Codex - Vista Personaje + fix timeouts por JSON pesado

- Pedido: Nicolas confirmo SQL 011 y pidio comenzar. Luego aviso que la app quedo sin datos y Supabase mostraba `canceling statement due to statement timeout`.
- Diagnostico: el primer intento de `sync-characters` agrego endpoints extra y guardaba dumps crudos grandes (`profile`, `achievements`, `collections`, etc.) en `character_progress`. Como `fetchAll()` hacia `select=*`, PostgREST empezo a traer JSON demasiado pesado en cada refresco y los SELECT empezaron a timeoutear. Tambien hubo 429 de Blizzard al hacer demasiadas llamadas paralelas.
- Acciones locales: agregue tab `Personaje` visible por `cap('viewAudit')`; agregue render de vista individual con selector, equipo, info rapida, profesiones, M+, raid semanal, links y enchants. Cambie `fetchAll()` para usar un `CHARACTER_PROGRESS_SELECT` compacto en vez de `select=*`. Cambie `sync-characters` para guardar extra info compacta y dejar de llamar endpoints grandes de achievements/collections en el sync normal. Agregue helper `supabase/functions/sync-characters/helpers.mjs`, retry/backoff para 429, y tests `tests/protocarries-single-view.test.js` / `tests/sync-characters-extra.test.mjs`.
- Verificacion local: pasaron `node tests\sync-characters-extra.test.mjs`, `node tests\protocarries-single-view.test.js`, `node tests\protocarries-roster-ui.test.js`, `node tests\protocarries-summary.test.js`, `node tests\inspect-wow-spells.test.mjs`, y parseo del script embebido (`script syntax OK`). `deno` no esta instalado localmente.
- Bloqueo: el redeploy final de `sync-characters` con la version compacta fue bloqueado por limite de uso de Codex en la solicitud escalada. Handoff urgente: Nicolas debe correr `supabase.cmd functions deploy sync-characters` desde `D:\ICloud\iCloudDrive\Claude - Codex\ProtoCarries` antes de volver a tocar "Refrescar API". Despues conviene invocar sync una vez y verificar que `synced_ok=false` quede en 0.

### 2026-07-08 - Codex - Aclaracion sync y updates de parches

- Pedido: Nicolas pregunto si despues del fix deberian actualizarse todos los personajes o si va de a poco; tambien pregunto si para futuros parches conviene pasar el spreadsheet/Excel o si se puede autoactualizar.
- Respuesta/decision: el sync actual intenta actualizar todos los personajes activos en una sola corrida; puede tardar y, si Blizzard rate-limitea, algun personaje puede quedar para la siguiente corrida. Para cambios de parche, los datos vivos (gear, ilvl, M+, raid, enchants disponibles en API) pueden sincronizarse automaticamente desde Battle.net; las reglas de presentacion/negocio del spreadsheet (nuevas columnas, thresholds, sistemas nuevos, que cosas comparar) conviene pasarlas con el Excel/spreadsheet o documentarlas para implementarlas. A futuro se puede mover parte de esas reglas a tablas/config para tocar menos codigo.

### 2026-07-08 - Codex - Carry raid Sporefall / Rotmire

- Pedido: Nicolas pidio agregar el ultimo tier/jefe para venta: raid `Sporefall`, region Harandar, boss unico `Rotmire`; tambien pregunto si esto se podia sacar del API de Blizzard.
- Decision: para progreso de personajes, Battle.net puede exponer instancias/encounters; para el catalogo comercial de carries (raids vendibles, bosses disponibles, slots, orden y agrupacion) la app usa configuracion propia `RAIDS`. Por eso se cargo manualmente con la informacion que paso Nicolas. A futuro conviene mover `RAIDS` a tablas editables si estos cambios van a ser frecuentes.
- Acciones: edite `index.html` agregando `sporefall` a `RAIDS` con `bosses:["Rotmire"]` y `sub:"Harandar · 1 boss"`. Agregue test `tests/protocarries-raid-config.test.js`.
- Verificacion: primero el test fallo porque `sporefall` no existia. Luego pasaron `node tests\protocarries-raid-config.test.js`, `node tests\protocarries-summary.test.js`, `node tests\protocarries-roster-ui.test.js`, `node tests\protocarries-single-view.test.js`, `node tests\sync-characters-extra.test.mjs`, `node tests\inspect-wow-spells.test.mjs`, y parseo del script embebido (`script syntax OK`).
 
### 2026-07-08 - Codex - Push a GitHub

- Pedido: Nicolas pidio subir el trabajo a GitHub y pregunto si GitHub permite tener mas de un sitio web publicado.
- Acciones: antes de commitear se redacto del `COLLAB.md` el Client Secret de Battle.net que habia quedado documentado en texto literal; se verifico con `rg` que no quedara ese valor. Se corrieron los tests locales relevantes (`protocarries-raid-config`, `protocarries-summary`, `protocarries-roster-ui`, `protocarries-single-view`, `sync-characters-extra`, `inspect-wow-spells`) y parseo JS del `<script>` embebido.
- Resultado: se integro el commit remoto `9bb2d67` sin forzar, se resolvio el conflicto de `index.html` conservando la version local completa, y se subio `main` a GitHub con el commit `d7700e5`.
