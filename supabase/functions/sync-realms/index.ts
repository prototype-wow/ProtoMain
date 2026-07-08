// ProtoCarries · sync-realms
//
// Trae la lista completa de realms de Battle.net (us/eu/kr/tw) y la guarda en
// `wow_realms`, para que el HTML pueda ofrecer un autocompletado de "Servidor"
// al agregar/editar un personaje, sin tener que llamar a Blizzard desde el
// cliente. Los realms casi no cambian — no hace falta correr esto seguido,
// alcanza con invocarlo una vez (o de tanto en tanto, manual).
//
// Invocar: supabase functions invoke sync-realms

import { createClient } from "npm:@supabase/supabase-js@2";

const REGIONS = ["us", "eu", "kr", "tw"];
const TOKEN_URL = "https://oauth.battle.net/token";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function getToken(): Promise<string> {
  const id = Deno.env.get("BATTLENET_CLIENT_ID")!;
  const secret = Deno.env.get("BATTLENET_CLIENT_SECRET")!;
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

Deno.serve(async () => {
  const token = await getToken();
  let total = 0;
  const errors: Record<string, string> = {};

  for (const region of REGIONS) {
    try {
      const url = `https://${region}.api.blizzard.com/data/wow/realm/index?namespace=dynamic-${region}&locale=en_US`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const json = await res.json();
      const rows = (json.realms ?? []).map((r: any) => ({ region, slug: r.slug, name: r.name }));
      if (rows.length) {
        const { error } = await sb.from("wow_realms").upsert(rows, { onConflict: "region,slug" });
        if (error) throw new Error(error.message);
        total += rows.length;
      }
    } catch (e) {
      errors[region] = e instanceof Error ? e.message : String(e);
    }
  }

  return new Response(JSON.stringify({ total, errors }), { headers: { "Content-Type": "application/json" } });
});
