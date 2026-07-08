import assert from "node:assert/strict";
import { extraProfileFields, mapSettledWithConcurrency } from "../supabase/functions/sync-characters/helpers.mjs";

const fields = extraProfileFields({
  summary: {
    race: { name: "Void Elf" },
    gender: { name: "Male" },
    faction: { name: "Alliance" },
    level: 80,
    achievement_points: 15655,
  },
  professions: {
    primaries: [
      { profession: { name: "Tailoring" }, tiers: [{ skill_points: 100 }] },
      { profession: { name: "Alchemy" }, tiers: [{ skill_points: 100 }] },
    ],
  },
  achievements: { total_quantity: 1234 },
  reputations: {
    reputations: [
      { faction: { name: "Silvermoon Court" }, standing: { name: "Exalted" } },
      { faction: { name: "Amani Tribe" }, standing: { name: "Honored" } },
    ],
  },
  mounts: { mounts: [{}, {}] },
  pets: { pets: [{}, {}, {}] },
});

assert.equal(fields.race, "Void Elf");
assert.equal(fields.gender, "Male");
assert.equal(fields.faction, "Alliance");
assert.equal(fields.level, 80);
assert.equal(fields.achievement_points, 15655);
assert.equal(fields.mounts_count, 2);
assert.equal(fields.pets_count, 3);
assert.equal(fields.exalted_reputations_count, 1);
assert.equal(fields.professions.primaries[0].name, "Tailoring");
assert.equal(fields.professions.primaries[0].skill_points, 100);
assert.equal(fields.profile.race, "Void Elf");
assert.equal(fields.achievements.total_quantity, 15655);
assert.equal(fields.collections.mounts_count, 2);
assert.equal(fields.collections.pets_count, 3);
assert.equal(fields.reputations.reputations[0].name, "Silvermoon Court");

let active = 0;
let maxActive = 0;
const results = await mapSettledWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
  active++;
  maxActive = Math.max(maxActive, active);
  await new Promise((resolve) => setTimeout(resolve, 5));
  active--;
  if (n === 4) throw new Error("boom");
  return n * 10;
});

assert.equal(maxActive <= 2, true);
assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled", "fulfilled", "rejected", "fulfilled"]);
assert.equal(results[0].value, 10);
assert.equal(results[4].value, 50);

console.log("sync characters extra helpers OK");
