const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const match = html.match(/<script>([\s\S]*)<\/script>/);
assert(match, "index.html script block not found");

const script = match[1].split("/* ---------- user menu ---------- */")[0];
const content = { innerHTML: "" };
const tabs = { innerHTML: "", querySelectorAll() { return []; } };
const copyVacAll = { style: {} };
const userArea = { innerHTML: "" };
const context = {
  console,
  setTimeout() {},
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById(id) {
      if (id === "content") return content;
      if (id === "tabs") return tabs;
      if (id === "copyVacAll") return copyVacAll;
      if (id === "userArea") return userArea;
      return { innerHTML: "", style: {}, querySelectorAll() { return []; } };
    },
  },
};
vm.createContext(context);
vm.runInContext(`${script}
globalThis.openUserMenu = function(){};
session = { username:"Officer", role:"officer" };
characters = [
  { id:"1", name:"Exxé", class:"Mage", role:"ranged", realm_slug:"sargeras", region:"us", active:true },
  { id:"2", name:"Khansos", class:"Monk", role:"tank", realm_slug:"quelthalas", region:"us", active:true },
];
realms = [{ region:"us", slug:"sargeras", name:"Sargeras" }];
characterProgress = [{
  character_id:"1",
  equipped_ilvl:293.06,
  race:"Void Elf",
  gender:"Male",
  faction:"Alliance",
  level:80,
  achievement_points:15655,
  mounts_count:206,
  pets_count:198,
  exalted_reputations_count:40,
  professions:{ primaries:[{ name:"Tailoring", skill_points:100 },{ name:"Alchemy", skill_points:100 }] },
  reputations:{ renown:[{ name:"Silvermoon Court", value:20, max:20 }] },
  gear:[
    { slot:{ type:"HEAD" }, name:"Voidbreaker's Veil", ilvl:{ value:289 }, enchantments:[{ display_string:"Empowered Rune of Avoidance" }] },
    { slot:{ type:"CHEST" }, name:"Voidbreaker's Robe", ilvl:{ value:298 }, enchantments:[{ display_string:"Mark of the Worldsoul" }] },
  ],
  mythic_rating:3514,
  mythic_best_runs:[{ dungeon:{ name:"Windrunner Spire" }, keystone_level:18, score:442 }],
  raid_progress:{ _killed_this_week:{ Raid:{ HEROIC:["Boss A","Boss B"] } } },
  updated_at:"2026-07-08T14:40:02Z",
}];
globalThis.__officerTabs = visibleTabs();
session = { username:"Carry", role:"cargador" };
globalThis.__carryTabs = visibleTabs();
session = { username:"Officer", role:"officer" };
view = "personaje";
render();
globalThis.__singleHtml = document.getElementById("content").innerHTML;
`, context);

assert(context.__officerTabs.some(([id, label]) => id === "personaje" && label === "Personaje"));
assert(!context.__carryTabs.some(([id]) => id === "personaje"));

const single = context.__singleHtml;
assert.match(single, /singleView/);
assert.match(single, /singleCharSelect/);
assert.match(single, /Exx/);
assert.match(single, /Voidbreaker&#39;s Veil/);
assert.match(single, /Tailoring/);
assert.match(single, /Alchemy/);
assert.match(single, /Void Elf/);
assert.match(single, /15655/);
assert.match(single, /Windrunner Spire/);
assert.match(single, /Empowered Rune of Avoidance/);
assert.match(single, /Armory/);

console.log("protocarries single view OK");
