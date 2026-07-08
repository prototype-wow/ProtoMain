const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadHelpers() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert(match, "index.html script block not found");

  const script = match[1].split("/* ---------- user menu ---------- */")[0];
  const context = {
    console,
    setTimeout() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
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
  rankTable,
};`, context);
  return context.__helpers;
}

const h = loadHelpers();

const gear = [
  { slot: { type: "HEAD" }, ilvl: { value: 293 }, set: { item_set: { name: "Tier" } }, name_description: { display_string: "Mythic" } },
  { slot: { type: "SHOULDER" }, ilvl: { value: 293 }, set: { item_set: { name: "Tier" } }, name_description: { display_string: "Mythic" } },
  { slot: { type: "CHEST" }, ilvl: { value: 293 }, set: { item_set: { name: "Tier" } }, name_description: { display_string: "Mythic" } },
  { slot: { type: "HANDS" }, ilvl: { value: 285 }, set: { item_set: { name: "Tier" } }, name_description: { display_string: "Heroic" } },
  { slot: { type: "LEGS" }, ilvl: { value: 292 } },
];

assert.strictEqual(h.gearEquippedIlvl(gear), 291.2);
assert.strictEqual(h.fmtIlvl({ gear, equipped_ilvl: 291 }), "291.20");

const row = {
  vaultM: 2,
  vaultR: 1,
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

const plainRank = h.rankTable("Plain", [{ ch: { name: "A", class: "Mage" }, p: {}, tier: {}, killed: {} }], () => 1, () => "1");
assert.match(plainRank, /rankrow rankhead/);

console.log("protocarries summary helpers OK");
