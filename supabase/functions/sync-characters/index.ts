// ProtoCarries · sync-characters
//
// Reemplaza a wowaudit: trae equipo/ilvl, Mythic+ y progreso de raid directo
// de la Battle.net Game Data API para cada personaje en la tabla `characters`,
// y guarda todo en `character_progress` / `raid_reset_baseline`.
//
// Secrets requeridos (supabase secrets set ...):
//   BATTLENET_CLIENT_ID, BATTLENET_CLIENT_SECRET
// Provistos automáticamente por el runtime de Supabase Edge Functions:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Invocar manualmente: supabase functions invoke sync-characters
// En producción: Cron Job de Supabase (ver supabase/sql/002_cron.sql)

import { createClient } from "npm:@supabase/supabase-js@2";
import { extraProfileFields, mapSettledWithConcurrency } from "./helpers.mjs";

const REGION = "us";
const NAMESPACE = `profile-${REGION}`;
const API_BASE = `https://${REGION}.api.blizzard.com`;
const TOKEN_URL = "https://oauth.battle.net/token";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function getToken(): Promise<string> {
  const id = Deno.env.get("BATTLENET_CLIENT_ID")!;
  const secret = Deno.env.get("BATTLENET_CLIENT_SECRET")!;
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${id}:${secret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`OAuth token failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token as string;
}

function slugify(name: string): string {
  // Battle.net espera el nombre del personaje en minúsculas, sin tildes/apóstrofes en la URL
  // (la API tolera los caracteres normales del nombre codificados, pero normalizamos igual).
  return encodeURIComponent(name.toLowerCase());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function bnetGet(path: string, token: string, attempt = 0): Promise<any | null> {
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}namespace=${NAMESPACE}&locale=en_US`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null; // personaje no encontrado / renombrado / no logueado nunca
  if (res.status === 429 && attempt < 3) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : [1200, 3000, 6500][attempt];
    await sleep(delay);
    return bnetGet(path, token, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function bnetGetOptional(path: string, token: string): Promise<any | null> {
  try {
    return await bnetGet(path, token);
  } catch (e) {
    console.warn(`Optional Battle.net endpoint failed: ${path}`, e);
    return null;
  }
}

function buildRaidProgress(encounters: any): Record<string, Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, Record<string, number>>> = {};
  if (!encounters?.expansions) return out;
  for (const exp of encounters.expansions) {
    for (const inst of exp.instances ?? []) {
      const instName = inst.instance?.name?.en_US ?? inst.instance?.name ?? "unknown";
      for (const mode of inst.modes ?? []) {
        const diff = mode.difficulty?.type ?? "UNKNOWN";
        for (const enc of mode.progress?.encounters ?? []) {
          const bossName = enc.encounter?.name?.en_US ?? enc.encounter?.name ?? "unknown";
          out[instName] ??= {};
          out[instName][diff] ??= {};
          out[instName][diff][bossName] = enc.completed_count ?? 0;
        }
      }
    }
  }
  return out;
}

function diffKilledThisWeek(
  current: Record<string, Record<string, Record<string, number>>>,
  baseline: Record<string, Record<string, Record<string, number>>> | null,
): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const [instName, diffs] of Object.entries(current)) {
    for (const [diff, bosses] of Object.entries(diffs)) {
      for (const [boss, count] of Object.entries(bosses)) {
        const before = baseline?.[instName]?.[diff]?.[boss] ?? 0;
        if (count > before) {
          out[instName] ??= {};
          out[instName][diff] ??= [];
          out[instName][diff].push(boss);
        }
      }
    }
  }
  return out;
}

// Reset semanal de US: martes. Devuelve la fecha (YYYY-MM-DD) del martes on-or-before "now".
function currentWeekStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0=domingo, 2=martes
  const diff = (day - 2 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  // source: "cron" (automático) o "manual" (botón). El toggle auto_sync solo frena al cron.
  let source = "manual";
  try { const b = await req.json(); if (b && typeof b.source === "string") source = b.source; } catch { /* body vacío */ }

  if (source === "cron") {
    const { data: st } = await sb.from("app_settings").select("auto_sync").limit(1);
    if (st?.[0] && st[0].auto_sync === false) return json({ skipped: "auto_sync_off" });
  }

  // Throttle: si ya se sincronizó hace menos de 60s, no repetir (evita spam del botón manual).
  const { data: recent } = await sb
    .from("character_progress")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);
  const lastTs = recent?.[0]?.updated_at ? new Date(recent[0].updated_at).getTime() : 0;
  if (Date.now() - lastTs < 60_000) return json({ skipped: "too_soon", last_sync: recent?.[0]?.updated_at });

  const token = await getToken();
  const weekStart = currentWeekStart();

  const { data: chars, error: charsErr } = await sb.from("characters").select("*").eq("active", true);
  if (charsErr) return json({ error: charsErr.message }, 500);

  const { data: baselines } = await sb.from("raid_reset_baseline").select("*");
  const baselineByChar = new Map((baselines ?? []).map((b) => [b.character_id, b]));

  const results = await mapSettledWithConcurrency(chars ?? [], 2, async (c) => {
      const realm = c.realm_slug;
      const slug = slugify(c.name);
      const base = `/profile/wow/character/${realm}/${slug}`;

      const [summary, equipment, mythic, encounters, professions, reputations] = await Promise.all([
        bnetGet(base, token),
        bnetGet(`${base}/equipment`, token),
        bnetGet(`${base}/mythic-keystone-profile`, token),
        bnetGet(`${base}/encounters/raids`, token),
        bnetGetOptional(`${base}/professions`, token),
        bnetGetOptional(`${base}/reputations`, token),
      ]);

      const raidProgress = buildRaidProgress(encounters);
      const baseline = baselineByChar.get(c.id);

      if (!baseline) {
        // Primera sincronización de este personaje: no hay con qué comparar,
        // así que el baseline arranca IGUAL al progreso actual (0 matados "esta
        // semana" hasta que haya un kill nuevo real). Si en cambio usáramos {} acá,
        // toda la historia de raideo del personaje aparecería como "esta semana".
        await sb.from("raid_reset_baseline").upsert({
          character_id: c.id,
          week_start: weekStart,
          raid_progress: raidProgress,
          updated_at: new Date().toISOString(),
        });
        baselineByChar.set(c.id, { character_id: c.id, week_start: weekStart, raid_progress: raidProgress });
      } else if (baseline.week_start !== weekStart) {
        // Arrancó una semana nueva desde el último baseline guardado: el baseline
        // pasa a ser el raid_progress que teníamos ANTES de este sync (aprox. al reset).
        const { data: prev } = await sb
          .from("character_progress")
          .select("raid_progress")
          .eq("character_id", c.id)
          .maybeSingle();
        await sb.from("raid_reset_baseline").upsert({
          character_id: c.id,
          week_start: weekStart,
          raid_progress: prev?.raid_progress ?? {},
          updated_at: new Date().toISOString(),
        });
        baselineByChar.set(c.id, { character_id: c.id, week_start: weekStart, raid_progress: prev?.raid_progress ?? {} });
      }

      const killedThisWeek = diffKilledThisWeek(raidProgress, baselineByChar.get(c.id)?.raid_progress ?? null);

      // La clase no se elige a mano al crear el personaje: se completa sola
      // acá, con lo que devuelve el perfil de Battle.net.
      const apiClass = summary?.character_class?.name;
      if (apiClass && apiClass !== c.class) {
        await sb.from("characters").update({ class: apiClass }).eq("id", c.id);
      }

      await sb.from("character_progress").upsert({
        character_id: c.id,
        equipped_ilvl: summary?.equipped_item_level ?? null,
        gear: equipment?.equipped_items ?? null,
        mythic_rating: mythic?.current_mythic_rating?.rating ?? null,
        mythic_best_runs: mythic?.current_period?.best_runs ?? [],
        raid_progress: { ...raidProgress, _killed_this_week: killedThisWeek },
        ...extraProfileFields({ summary, professions, reputations }),
        synced_ok: true,
        last_error: null,
        updated_at: new Date().toISOString(),
      });

      return c.name;
    },
  );

  const failed = results
    .map((r, i) => ({ r, name: chars?.[i]?.name }))
    .filter((x) => x.r.status === "rejected")
    .map((x) => ({ name: x.name, error: (x.r as PromiseRejectedResult).reason?.message ?? String((x.r as PromiseRejectedResult).reason) }));

  // Marcar en la DB los que fallaron (para poder mostrarlo en el HTML si hace falta)
  for (const f of failed) {
    const c = chars?.find((x) => x.name === f.name);
    if (c) {
      await sb.from("character_progress").upsert({
        character_id: c.id,
        synced_ok: false,
        last_error: f.error,
        updated_at: new Date().toISOString(),
      });
    }
  }

  return json({ synced: (chars?.length ?? 0) - failed.length, failed });
});
