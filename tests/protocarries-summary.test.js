const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadHelpers() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(match, "index.html script block not found");

  const script = match[1].split("/* ---------- user menu ---------- */")[0];
  const context = {
    console,
    setTimeout() {},
    URLSearchParams,
    location: { search: "" },
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; },
      querySelector() { return null; },
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  vm.createContext(context);
  vm.runInContext(`${script}
globalThis.__helpers = {
  gearEquippedIlvl,
  fmtIlvl,
  vaultTrackCounts,
  vaultTotalSlots,
  vaultSummaryHtml,
  tierSlotsHeaderHtml,
  tierSummaryHtml,
  tierInfo,
  parseItemBonusTrackMap,
  itemHref,
  itemExactHref,
  wowheadData,
  itemGemHtml,
  itemEnchantHtml,
  configuredTierSetForClass,
  knownTierSetOptionsForClass,
  __setUpgradeTrackMap(map){ applyUpgradeTrackMap(map); },
  __setSettings(patch){ settings={...settings,...patch}; },
  rankTable,
};`, context);
  return context.__helpers;
}

const h = loadHelpers();

const gear = [
  { slot: { type: "HEAD" }, ilvl: { value: 293 }, set: { item_set: { name: "Tier" } }, upgrade: { display_string: "Nivel de mejora: Mito 6/6" } },
  { slot: { type: "SHOULDER" }, ilvl: { value: 293 }, set: { item_set: { name: "Tier" } }, upgrade: { display_string: "Nivel de mejora: Mito 6/6" } },
  { slot: { type: "CHEST" }, ilvl: { value: 293 }, set: { item_set: { name: "Tier" } }, upgrade: { display_string: "Nivel de mejora: Mito 6/6" } },
  { slot: { type: "HANDS" }, ilvl: { value: 285 }, set: { item_set: { name: "Tier" } }, upgrade: { display_string: "Nivel de mejora: Héroe 6/6" } },
  { slot: { type: "LEGS" }, ilvl: { value: 292 } },
];

assert.strictEqual(h.gearEquippedIlvl(gear), 291.2);
assert.strictEqual(h.fmtIlvl({ gear, equipped_ilvl: 291 }), "291.20");

const row = {
  mplusVaultRuns: [{ keystone_level: 12 }, { keystone_level: 11 }, { keystone_level: 10 }, { keystone_level: 10 }],
  vaultW: 0,
  p: {
    mythic_best_runs: [{ keystone_level: 12 }, { keystone_level: 11 }, { keystone_level: 10 }, { keystone_level: 10 }],
  },
  killed: {
    Raid: {
      HEROIC: ["Boss A", "Boss B"],
    },
  },
};

assert.strictEqual(h.vaultTotalSlots(row), 3);
assert.strictEqual(JSON.stringify(h.vaultTrackCounts(row)), JSON.stringify({ M: 2, H: 1, N: 0, V: 0 }));
assert.match(h.vaultSummaryHtml(row), />2<\/b>.*>1<\/b>.*>0<\/b>.*>0<\/b>.*3\/9/);

const tierHtml = h.tierSummaryHtml({ count: 4, slots: h.tierInfo ? h.tierInfo(gear).slots : {
  HEAD: { letter: "M", ilvl: 293 },
  SHOULDER: { letter: "M", ilvl: 293 },
  CHEST: { letter: "M", ilvl: 293 },
  HANDS: { letter: "H", ilvl: 285 },
  LEGS: null,
} });
assert.match(tierHtml, /class="tierCount"/);
assert.match(h.tierSlotsHeaderHtml(), /H<\/span>.*S<\/span>.*C<\/span>.*G<\/span>.*L<\/span>/);
assert.match(tierHtml, />M<\/b>.*>M<\/b>.*>M<\/b>.*>H<\/b>/);

const currentSeasonTier = h.tierInfo([
  { slot: { type: "HEAD" }, ilvl: { value: 308 }, set: { item_set: { id: 200, name: "New Tier" } }, upgrade: { display_string: "Nivel de mejora: Héroe 4/6" } },
  { slot: { type: "SHOULDER" }, ilvl: { value: 298 }, set: { item_set: { id: 200, name: "New Tier" } }, upgrade: { display_string: "Nivel de mejora: Campeón 7/8" } },
  { slot: { type: "CHEST" }, ilvl: { value: 321 }, set: { item_set: { id: 200, name: "New Tier" } }, upgrade: { display_string: "Nivel de mejora: Mito 2/6" } },
]);
assert.strictEqual(currentSeasonTier.slots.HEAD.letter, "H");
assert.strictEqual(currentSeasonTier.slots.SHOULDER.letter, "N");
assert.strictEqual(currentSeasonTier.slots.CHEST.letter, "M");

const spanishUpgradeTrackTier = h.tierInfo([
  { slot: { type: "HEAD" }, ilvl: { value: 308 }, set: { item_set: { id: 200, name: "New Tier" } }, name_description: { display_string: "Mítico" }, upgrade: { display_string: "Nivel de mejora: Campeón 6/6" } },
  { slot: { type: "SHOULDER" }, ilvl: { value: 321 }, set: { item_set: { id: 200, name: "New Tier" } }, name_description: { display_string: "Mítico" }, upgrade: { display_string: "Nivel de mejora: Héroe 6/6" } },
  { slot: { type: "CHEST" }, ilvl: { value: 324 }, set: { item_set: { id: 200, name: "New Tier" } }, name_description: { display_string: "Mítico" }, upgrade: { display_string: "Nivel de mejora: Mito 6/6" } },
  { slot: { type: "HANDS" }, ilvl: { value: 285 }, set: { item_set: { id: 200, name: "New Tier" } }, name_description: { display_string: "Mítico" }, upgrade: { display_string: "Nivel de mejora: Veterano 8/8" } },
]);
assert.strictEqual(spanishUpgradeTrackTier.slots.HEAD.letter, "N");
assert.strictEqual(spanishUpgradeTrackTier.slots.SHOULDER.letter, "H");
assert.strictEqual(spanishUpgradeTrackTier.slots.CHEST.letter, "M");
assert.strictEqual(spanishUpgradeTrackTier.slots.HANDS.letter, "V");

const englishUpgradeTrackTier = h.tierInfo([
  { slot: { type: "HEAD" }, ilvl: { value: 308 }, set: { item_set: { id: 200, name: "New Tier" } }, upgrade: { display_string: "Upgrade Level: Champion 6/6" } },
  { slot: { type: "SHOULDER" }, ilvl: { value: 321 }, set: { item_set: { id: 200, name: "New Tier" } }, upgrade: { display_string: "Upgrade Level: Hero 6/6" } },
  { slot: { type: "CHEST" }, ilvl: { value: 324 }, set: { item_set: { id: 200, name: "New Tier" } }, upgrade: { display_string: "Upgrade Level: Myth 6/6" } },
  { slot: { type: "HANDS" }, ilvl: { value: 285 }, set: { item_set: { id: 200, name: "New Tier" } }, upgrade: { display_string: "Upgrade Level: Veteran 8/8" } },
]);
assert.strictEqual(englishUpgradeTrackTier.slots.HEAD.letter, "N");
assert.strictEqual(englishUpgradeTrackTier.slots.SHOULDER.letter, "H");
assert.strictEqual(englishUpgradeTrackTier.slots.CHEST.letter, "M");
assert.strictEqual(englishUpgradeTrackTier.slots.HANDS.letter, "V");

const parsedUpgradeTracks = h.parseItemBonusTrackMap(`
{ 27776, 12841, 34, 617, 974, 0, 0, 0 }
{ 27777, 12842, 34, 617, 974, 0, 0, 0 }
{ 27778, 12843, 34, 617, 974, 0, 0, 0 }
{ 27779, 12833, 34, 616, 973, 0, 0, 0 }
{ 27780, 12825, 34, 615, 972, 0, 0, 0 }
{ 27781, 12849, 34, 618, 978, 0, 0, 0 }
`);
h.__setUpgradeTrackMap(parsedUpgradeTracks);
const bonusDecodedTier = h.tierInfo([
  { slot: { type: "HEAD" }, ilvl: { value: 308 }, set: { item_set: { id: 200, name: "New Tier" } }, bonus_list: [6652, 12843, 13440] },
  { slot: { type: "SHOULDER" }, ilvl: { value: 298 }, set: { item_set: { id: 200, name: "New Tier" } }, bonus_list: ["12833"] },
  { slot: { type: "CHEST" }, ilvl: { value: 321 }, set: { item_set: { id: 200, name: "New Tier" } }, bonus_list: [{ id: 12849 }] },
]);
assert.strictEqual(bonusDecodedTier.slots.HEAD.letter, "H");
assert.strictEqual(bonusDecodedTier.slots.SHOULDER.letter, "N");
assert.strictEqual(bonusDecodedTier.slots.CHEST.letter, "M");

const wowheadItem = {
  item: { id: 237587 },
  level: { value: 308 },
  bonus_list: [6652, "12843", { id: 13440 }],
  sockets: [{ item: { id: 213743, name: "Quick Sapphire" } }],
  enchantments: [{ display_string: "Enchant Helm - Blessing of Speed", enchantment: { id: 7423 } }],
};
assert.strictEqual(h.wowheadData(wowheadItem), "bonus=6652:12843:13440&ilvl=308&gems=213743&ench=7423");
assert.strictEqual(h.itemHref(wowheadItem), "https://www.wowhead.com/item=237587");
assert.strictEqual(h.itemExactHref(wowheadItem), "https://www.wowhead.com/item=237587?bonus=6652:12843:13440&ilvl=308&gems=213743&ench=7423");
assert.match(h.itemGemHtml(wowheadItem), /Quick Sapphire/);
assert.match(h.itemGemHtml(wowheadItem), /class="gemIconLink"/);
assert.match(h.itemGemHtml(wowheadItem), /data-wh-icon-size="tiny"/);
assert.match(h.itemGemHtml(wowheadItem), /https:\/\/www\.wowhead\.com\/item=213743/);
assert.strictEqual(h.itemEnchantHtml(wowheadItem), '<span class="enchantText">Enchant Helm - Blessing of Speed</span>');
h.__setUpgradeTrackMap(new Map());

const fallbackSeasonTier = h.tierInfo([
  { slot: { type: "HEAD" }, ilvl: { value: 298 }, set: { item_set: { id: 201, name: "Fallback Tier" } } },
  { slot: { type: "SHOULDER" }, ilvl: { value: 308 }, set: { item_set: { id: 201, name: "Fallback Tier" } } },
  { slot: { type: "CHEST" }, ilvl: { value: 321 }, set: { item_set: { id: 201, name: "Fallback Tier" } } },
]);
assert.strictEqual(fallbackSeasonTier.slots.HEAD.letter, null);
assert.strictEqual(fallbackSeasonTier.slots.SHOULDER.letter, null);
assert.strictEqual(fallbackSeasonTier.slots.CHEST.letter, null);

const previousSeasonTier = h.tierInfo([
  { slot: { type: "HEAD" }, ilvl: { value: 321 }, set: { item_set: { id: 100, name: "Old Tier" } }, upgrade: { display_string: "Nivel de mejora: Mito 6/6" } },
  { slot: { type: "SHOULDER" }, ilvl: { value: 308 }, set: { item_set: { id: 200, name: "New Tier" } }, upgrade: { display_string: "Nivel de mejora: Héroe 6/6" } },
], "200");
assert.strictEqual(previousSeasonTier.slots.HEAD.previous, true);
assert.strictEqual(previousSeasonTier.slots.SHOULDER.previous, false);
assert.strictEqual(previousSeasonTier.count, 1);
assert.strictEqual(previousSeasonTier.previous, 1);
assert.match(h.tierSummaryHtml(previousSeasonTier), />MA<\/b>.*>H<\/b>/);

const manualNameTier = h.tierInfo([
  { slot: { type: "HEAD" }, ilvl: { value: 321 }, set: { item_set: { id: 999, name: "Guile of the Monkey King" } }, upgrade: { display_string: "Nivel de mejora: Mito 6/6" } },
], { item_set_id: "Guile of the Monkey King", name: "Guile of the Monkey King" });
assert.strictEqual(manualNameTier.slots.HEAD.previous, false);

const monkPreviousTier = h.tierInfo([
  { slot: { type: "HEAD" }, ilvl: { value: 289 }, set: { item_set: { id: 1984, name: "Way of Ra-den's Chosen" } }, upgrade: { display_string: "Nivel de mejora: Mito 6/6" } },
], { item_set_id: "Guile of the Monkey King", name: "Guile of the Monkey King" });
assert.strictEqual(monkPreviousTier.slots.HEAD.previous, true);
assert.strictEqual(monkPreviousTier.count, 0);

const normalizedNameTier = h.tierInfo([
  { slot: { type: "HEAD" }, ilvl: { value: 321 }, set: { item_set: { id: 999, name: "Guile of the Monkey-King" } }, upgrade: { display_string: "Nivel de mejora: Mito 6/6" } },
], { item_set_id: "Guile of the Monkey King", name: "Guile of the Monkey King" });
assert.strictEqual(normalizedNameTier.slots.HEAD.previous, false);

h.__setSettings({ current_tier_sets: { Monk: "1984" } });
assert.strictEqual(h.configuredTierSetForClass("Monk"), null);
h.__setSettings({ current_tier_sets: { Monk: "Way of Ra-den's Chosen" } });
assert.strictEqual(h.configuredTierSetForClass("Monk"), null);
h.__setSettings({ current_tier_sets: { Druid: "1980", Warrior: "Rage of the Night Ender" } });
assert.strictEqual(h.configuredTierSetForClass("Druid").name, "Bark of the Enigmatic Dreamwatcher");
assert.strictEqual(h.configuredTierSetForClass("Warrior").name, "Jade Warlord's Dominion");
assert.strictEqual(h.knownTierSetOptionsForClass("Druid").map(o=>o.key).join(","), "2057,1980");
assert.strictEqual(h.knownTierSetOptionsForClass("Warrior").map(o=>o.key).join(","), "2067,1990");

const plainRank = h.rankTable("Plain", [{ ch: { name: "A", class: "Mage" }, p: {}, tier: {}, killed: {} }], () => 1, () => "1");
assert.match(plainRank, /rankrow rankhead/);

console.log("protocarries summary helpers OK");
