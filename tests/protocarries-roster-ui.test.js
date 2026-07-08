const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const match = html.match(/<script>([\s\S]*)<\/script>/);
assert(match, "index.html script block not found");

const script = match[1].split("/* ---------- user menu ---------- */")[0];
const content = { innerHTML: "" };
const context = {
  console,
  setTimeout() {},
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: { getElementById() { return content; } },
};
vm.createContext(context);
vm.runInContext(`${script}
characters = [
  { id:"1", name:"Aegis", class:"Warrior", role:"tank", active:true },
  { id:"2", name:"Mender", class:"Priest", role:"healer", active:true },
  { id:"3", name:"Spark", class:"Mage", role:"ranged", active:true },
  { id:"4", name:"Blade", class:"Rogue", role:"melee", active:true },
  { id:"5", name:"Frostwall", class:"Mage", role:"tank", active:true },
];
characterProgress = [{ character_id:"1", updated_at:"2026-07-08T03:00:00Z" }];
trackedAbilities = [
  { id:"a1", spell_id:45438, name:"Ice Block", class:"Mage", group_name:"Inmunes", role_filter:["ranged"], enabled:true },
];
renderRosterComp();
globalThis.__rosterHtml = document.getElementById("content").innerHTML;
globalThis.__abilityConfigHtml = abilityConfigHtml();
`, context);

const roster = context.__rosterHtml;
assert.match(roster, /rosterBoard/);
assert.match(roster, /rosterClassCard/);
assert.match(roster, /rosterAside/);
assert.match(roster, /rosterSideBlock/);
assert.match(roster, /rosterCounterPanel/);
assert.match(roster, /Composición del roster/);
assert.match(roster, /Tanks \(2\)/);
assert.match(roster, /Healers \(1\)/);
assert.match(roster, /Ranged \(1\)/);
assert.match(roster, /Melee \(1\)/);
assert.match(roster, /Clases/);
assert.match(roster, /Tipos de armadura/);
assert.match(roster, /Composición/);
assert.match(roster, /roleMini/);
assert.match(roster, /Habilidades trackeadas/);
assert.match(roster, /Inmunes/);
assert.match(roster, /Ice Block/);
assert.match(roster, /abilityTitle/);
assert.match(roster, /abilityRoleTags/);
const abilityBoard = roster.slice(roster.indexOf("Habilidades trackeadas"));
assert.match(abilityBoard, /Spark/);
assert.doesNotMatch(abilityBoard, /Frostwall/);

const abilityConfig = context.__abilityConfigHtml;
assert.match(abilityConfig, /data-editabil="a1"/);
assert.match(abilityConfig, /ab_roles/);

console.log("protocarries roster ui OK");
