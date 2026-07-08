const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
globalThis.__raids = RAIDS;
globalThis.__keys = RAID_KEYS;
globalThis.__slots = blankSlots();
`, context);

assert(context.__keys.includes("sporefall"), "Sporefall should be available as a carry raid");
assert.equal(context.__raids.sporefall.name, "Sporefall");
assert.match(context.__raids.sporefall.sub, /Harandar/);
assert.deepEqual(context.__raids.sporefall.bosses, ["Rotmire"]);
assert.equal(context.__slots.sporefall.Rotmire, 4);

console.log("protocarries raid config OK");
