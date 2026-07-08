function nameOf(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.name === "string") return value.name;
  if (value.name && typeof value.name.en_US === "string") return value.name.en_US;
  if (typeof value.en_US === "string") return value.en_US;
  return null;
}

function lastTier(profession) {
  const tiers = Array.isArray(profession?.tiers) ? profession.tiers : [];
  return tiers.length ? tiers[tiers.length - 1] : {};
}

function professionRows(professions, key) {
  return (professions?.[key] ?? []).map((p) => {
    const tier = lastTier(p);
    return {
      name: nameOf(p.profession) ?? nameOf(p) ?? "Unknown",
      skill_points: tier.skill_points ?? p.skill_points ?? null,
      max_skill_points: tier.max_skill_points ?? p.max_skill_points ?? null,
    };
  });
}

function collectionList(collection, key) {
  const rows = collection?.[key];
  return Array.isArray(rows) ? rows : [];
}

function compactProfile(summary) {
  return {
    race: nameOf(summary?.race),
    gender: nameOf(summary?.gender),
    faction: nameOf(summary?.faction),
    level: summary?.level ?? null,
    achievement_points: summary?.achievement_points ?? null,
    active_spec: nameOf(summary?.active_spec),
    character_class: nameOf(summary?.character_class),
  };
}

function exaltedCount(reputations) {
  return (reputations?.reputations ?? []).filter((r) => {
    const standing = String(nameOf(r.standing) ?? r.standing?.type ?? "").toLowerCase();
    return standing === "exalted";
  }).length;
}

export function extraProfileFields({ summary, professions, achievements, reputations, mounts, pets }) {
  const mountRows = collectionList(mounts, "mounts");
  const petRows = collectionList(pets, "pets");
  const mountedFetched = !!mounts;
  const petsFetched = !!pets;
  const exalted = exaltedCount(reputations);
  return {
    profile: compactProfile(summary),
    professions: {
      primaries: professionRows(professions, "primaries"),
      secondaries: professionRows(professions, "secondaries"),
    },
    achievements: { total_quantity: summary?.achievement_points ?? achievements?.total_quantity ?? null },
    reputations: {
      exalted_count: exalted,
      reputations: (reputations?.reputations ?? []).slice(0, 120).map((r) => ({
        name: nameOf(r.faction) ?? "Unknown",
        standing: nameOf(r.standing) ?? r.standing?.type ?? null,
      })),
    },
    collections: {
      mounts_count: mountedFetched ? mountRows.length : null,
      pets_count: petsFetched ? petRows.length : null,
    },
    race: nameOf(summary?.race),
    gender: nameOf(summary?.gender),
    faction: nameOf(summary?.faction),
    level: summary?.level ?? null,
    achievement_points: summary?.achievement_points ?? achievements?.total_quantity ?? null,
    mounts_count: mountedFetched ? mountRows.length : null,
    pets_count: petsFetched ? petRows.length : null,
    exalted_reputations_count: exalted,
  };
}

export async function mapSettledWithConcurrency(items, limit, mapper) {
  const safeLimit = Math.max(1, Math.floor(limit || 1));
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
