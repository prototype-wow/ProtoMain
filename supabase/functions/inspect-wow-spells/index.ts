// ProtoCarries - inspect-wow-spells
//
// Funcion exploratoria/debug: consulta Game Data de Battle.net para descubrir
// que referencias de spells aparecen colgadas de clases, specs y talent trees.
// No escribe en Supabase; sirve para decidir que habilidades vale la pena curar
// para una futura vista de roster/utilidades.
//
// Invocar:
//   supabase functions invoke inspect-wow-spells --body '{"class":"Mage","maxSpells":40}'
//   .../functions/v1/inspect-wow-spells?class=Mage&maxSpells=40

import {
  collectBnetRefs,
  compactSpell,
  normalizeName,
} from "./helpers.mjs";

const REGION = "us";
const NAMESPACE = `static-${REGION}`;
const API_BASE = `https://${REGION}.api.blizzard.com`;
const TOKEN_URL = "https://oauth.battle.net/token";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type InspectOptions = {
  className: string;
  spellId: number | null;
  maxClasses: number;
  maxSpecs: number;
  maxSpells: number;
  includeRaw: boolean;
};

type SpellRef = {
  id: number;
  name?: string;
  href?: string;
  paths?: string[];
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function boolish(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

async function getToken(): Promise<string> {
  const id = Deno.env.get("BATTLENET_CLIENT_ID");
  const secret = Deno.env.get("BATTLENET_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Missing BATTLENET_CLIENT_ID or BATTLENET_CLIENT_SECRET");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${id}:${secret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`OAuth token failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token as string;
}

function buildBnetUrl(pathOrHref: string): string {
  const url = new URL(pathOrHref.startsWith("http") ? pathOrHref : `${API_BASE}${pathOrHref}`);
  if (!url.searchParams.has("namespace")) url.searchParams.set("namespace", NAMESPACE);
  if (!url.searchParams.has("locale")) url.searchParams.set("locale", "en_US");
  return url.toString();
}

async function bnetGet(pathOrHref: string, token: string): Promise<any | null> {
  const url = buildBnetUrl(pathOrHref);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${pathOrHref} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function readOptions(req: Request): Promise<InspectOptions> {
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  const get = (key: string) => body[key] ?? url.searchParams.get(key);
  return {
    className: String(get("class") ?? get("className") ?? "").trim(),
    spellId: clampInt(get("spellId"), 0, 0, 999999) || null,
    maxClasses: clampInt(get("maxClasses"), 13, 1, 13),
    maxSpecs: clampInt(get("maxSpecs"), 36, 1, 48),
    maxSpells: clampInt(get("maxSpells"), 60, 1, 250),
    includeRaw: boolish(get("includeRaw")),
  };
}

function sourceLabel(prefix: string, specName: string): string {
  return `${prefix}:${specName || "Unknown"}`;
}

async function inspectSpec(specRef: any, token: string, maxSpells: number, includeRaw: boolean) {
  const specDetail = await bnetGet(specRef.key?.href ?? `/data/wow/playable-specialization/${specRef.id}`, token);
  const specName = normalizeName(specDetail?.name ?? specRef.name);
  const specId = specDetail?.id ?? specRef.id;
  const spellSources = new Map<number, Set<string>>();

  function addRefs(refs: SpellRef[], source: string) {
    for (const ref of refs) {
      if (!ref.id) continue;
      const set = spellSources.get(ref.id) ?? new Set<string>();
      set.add(source);
      spellSources.set(ref.id, set);
    }
  }

  const specRefs = collectBnetRefs(specDetail);
  addRefs(specRefs.spellRefs as SpellRef[], sourceLabel("spec", specName));

  const talentTrees: unknown[] = [];
  for (const href of specRefs.talentTreeHrefs) {
    const tree = await bnetGet(href, token);
    if (!tree) continue;
    talentTrees.push(includeRaw ? tree : { id: tree.id, name: normalizeName(tree.name) });
    const treeRefs = collectBnetRefs(tree);
    addRefs(treeRefs.spellRefs as SpellRef[], sourceLabel("talent-tree", specName));
  }

  const spells = [];
  const spellIds = [...spellSources.keys()].sort((a, b) => a - b).slice(0, maxSpells);
  for (const spellId of spellIds) {
    const [spell, media] = await Promise.all([
      bnetGet(`/data/wow/spell/${spellId}`, token),
      bnetGet(`/data/wow/media/spell/${spellId}`, token).catch(() => null),
    ]);
    if (!spell) continue;
    spells.push(compactSpell(spell, media, [...(spellSources.get(spellId) ?? [])]));
  }

  return {
    id: specId,
    name: specName,
    refs_found: spellSources.size,
    returned_spells: spells.length,
    talent_trees_checked: specRefs.talentTreeHrefs.length,
    spells,
    ...(includeRaw ? { raw_spec: specDetail, raw_talent_trees: talentTrees } : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!["GET", "POST"].includes(req.method)) return json({ error: "Use GET or POST" }, 405);

  try {
    const options = await readOptions(req);
    const token = await getToken();
    if (options.spellId) {
      const [spell, media] = await Promise.all([
        bnetGet(`/data/wow/spell/${options.spellId}`, token),
        bnetGet(`/data/wow/media/spell/${options.spellId}`, token).catch(() => null),
      ]);
      if (!spell) return json({ error: "spell_not_found", spellId: options.spellId }, 404);
      return json({
        generated_at: new Date().toISOString(),
        region: REGION,
        namespace: NAMESPACE,
        spell: compactSpell(spell, media, ["spell-id"]),
      });
    }

    const index = await bnetGet("/data/wow/playable-class/index", token);
    const allClasses = (index?.classes ?? []) as any[];
    const selectedClasses = allClasses
      .filter((klass) => {
        if (!options.className) return true;
        return normalizeName(klass.name).toLowerCase() === options.className.toLowerCase();
      })
      .slice(0, options.maxClasses);

    if (!selectedClasses.length) {
      return json({
        error: "class_not_found",
        class: options.className,
        available_classes: allClasses.map((klass) => normalizeName(klass.name)).filter(Boolean),
      }, 404);
    }

    let specsRemaining = options.maxSpecs;
    const classes = [];
    for (const classRef of selectedClasses) {
      if (specsRemaining <= 0) break;
      const classDetail = await bnetGet(classRef.key?.href ?? `/data/wow/playable-class/${classRef.id}`, token);
      const specs = ((classDetail?.specializations ?? []) as any[]).slice(0, specsRemaining);
      specsRemaining -= specs.length;

      const inspectedSpecs = [];
      for (const spec of specs) {
        inspectedSpecs.push(await inspectSpec(spec, token, options.maxSpells, options.includeRaw));
      }

      classes.push({
        id: classDetail?.id ?? classRef.id,
        name: normalizeName(classDetail?.name ?? classRef.name),
        specs_checked: inspectedSpecs.length,
        specializations: inspectedSpecs,
        ...(options.includeRaw ? { raw_class: classDetail } : {}),
      });
    }

    return json({
      generated_at: new Date().toISOString(),
      region: REGION,
      namespace: NAMESPACE,
      note: "Exploratorio: Battle.net expone referencias de spells en clases/specs/talent trees, pero no una lista completa y curada de todas las habilidades base por clase.",
      limits: {
        class: options.className || null,
        maxClasses: options.maxClasses,
        maxSpecs: options.maxSpecs,
        maxSpells: options.maxSpells,
      },
      classes,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
