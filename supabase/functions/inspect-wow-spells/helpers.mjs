export function normalizeName(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value.en_US === "string") return value.en_US;
  const first = Object.values(value).find((v) => typeof v === "string");
  return first ?? "";
}

export function parseBnetIdFromHref(href, resource) {
  if (typeof href !== "string") return null;
  const match = href.match(new RegExp(`/data/wow/${resource}/(\\d+)`));
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

function firstHref(node) {
  if (!node || typeof node !== "object") return "";
  return node.key?.href ?? node.self?.href ?? node.href ?? "";
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

export function collectBnetRefs(value) {
  const spellById = new Map();
  const talentTreeHrefs = new Set();
  const seen = new WeakSet();

  function addSpell(id, node, href, path) {
    if (!id) return;
    const existing = spellById.get(id) ?? { id, name: "", href: "", paths: [] };
    const name = normalizeName(node?.name);
    spellById.set(id, {
      id,
      name: existing.name || name,
      href: existing.href || href || "",
      paths: dedupe([...existing.paths, path]),
    });
  }

  function visit(node, path) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    const href = firstHref(node);
    if (href) {
      const spellId = parseBnetIdFromHref(href, "spell");
      if (spellId) addSpell(spellId, node, href, path);
      if (href.includes("/data/wow/talent-tree/")) talentTreeHrefs.add(href);
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === "href") continue;
      visit(child, `${path}.${key}`);
    }
  }

  visit(value, "$");
  return {
    spellRefs: [...spellById.values()].sort((a, b) => a.id - b.id),
    talentTreeHrefs: [...talentTreeHrefs].sort(),
  };
}

export function compactSpell(spell, media, sources = []) {
  const assets = Array.isArray(media?.assets) ? media.assets : [];
  const icon = assets.find((asset) => asset.key === "icon") ?? assets[0] ?? null;
  return {
    id: spell?.id ?? null,
    name: normalizeName(spell?.name),
    description: normalizeName(spell?.description ?? spell?.tooltip),
    icon_url: icon?.value ?? "",
    sources: dedupe(sources),
  };
}
