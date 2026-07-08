import assert from "node:assert/strict";
import {
  collectBnetRefs,
  compactSpell,
  normalizeName,
  parseBnetIdFromHref,
} from "../supabase/functions/inspect-wow-spells/helpers.mjs";

const fixture = {
  playable_class: { id: 8, name: "Mage" },
  specializations: [
    {
      id: 62,
      name: "Arcane",
      key: { href: "https://us.api.blizzard.com/data/wow/playable-specialization/62?namespace=static-us" },
      spell_tooltip: {
        spell: {
          id: 2139,
          name: "Counterspell",
          key: { href: "https://us.api.blizzard.com/data/wow/spell/2139?namespace=static-us" },
        },
      },
    },
  ],
  talent_tree: {
    key: {
      href: "https://us.api.blizzard.com/data/wow/talent-tree/658/playable-specialization/62?namespace=static-us",
    },
  },
  weird_nested_spell: {
    key: { href: "https://us.api.blizzard.com/data/wow/spell/80353?namespace=static-us" },
    name: "Time Warp",
  },
};

assert.equal(parseBnetIdFromHref(fixture.weird_nested_spell.key.href, "spell"), 80353);
assert.equal(normalizeName({ en_US: "Counterspell" }), "Counterspell");

const refs = collectBnetRefs(fixture);
assert.deepEqual(
  refs.spellRefs.map((r) => r.id).sort((a, b) => a - b),
  [2139, 80353],
);
assert.equal(refs.talentTreeHrefs.length, 1);

const spell = compactSpell(
  { id: 80353, name: { en_US: "Time Warp" }, description: { en_US: "Warp time." } },
  { assets: [{ key: "icon", value: "https://render.worldofwarcraft.com/icons/timewarp.jpg" }] },
  ["spec:Arcane", "talent-tree"],
);
assert.deepEqual(spell, {
  id: 80353,
  name: "Time Warp",
  description: "Warp time.",
  icon_url: "https://render.worldofwarcraft.com/icons/timewarp.jpg",
  sources: ["spec:Arcane", "talent-tree"],
});

console.log("inspect-wow-spells helpers OK");
