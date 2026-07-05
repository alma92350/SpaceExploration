"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* Colonies could already build a Fuel Refinery (an ordinary industry-chain
   recipe building: 2 Ice + 1 Energy -> 2 Fuel), but it was missing from
   COLONY_BUILD_CAT, so it fell through to the "survival" bucket instead of
   sitting with its recipe-chain siblings (smelter, chem_plant, foundry,
   fabricator) under "industry". Not a visibility bug — survival is always
   revealed — but a mis-filed one. This file locks in both the end-to-end
   production/withdrawal path and the correct categorization. */

function colonizableWorld(run) { return run(`(PLANETS.find(p => p.colonizable) || {}).id`); }
// processColonies() also rolls a per-colony random event each cycle (pirate raid/disaster/
// boom, colonization.js's colonyEventRoll) that can loot a chunk of storage independent of
// the recipe math these tests check — pin Math.random so that roll always lands past every
// branch (max threshold 0.16) and the recipe's own output is what's actually observed.
function suppressColonyEvents(run) { run(`Math.random = () => 0.99;`); }

test("a colony Fuel Refinery converts stored Ice+Energy into Fuel via processColonies", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const pid = colonizableWorld(run);
  run(`S.location = "${pid}";
       S.colonies["${pid}"] = { pop: 5, happiness: 70, tax: 10, buildings: { fuelrefinery: 3, solar: 5 },
         storage: { ice: 100, energy: 0 }, orders: {}, unrest: 0, faction: null, idle: {} };`);
  assert.equal(run(`S.colonies["${pid}"].storage.fuel`), undefined, "no fuel yet");
  suppressColonyEvents(run);
  for (let i = 0; i < 5; i++) run(`processColonies();`);
  const fuel = run(`S.colonies["${pid}"].storage.fuel`);
  const ice = run(`S.colonies["${pid}"].storage.ice`);
  assert.ok(fuel > 0, "the refinery should have produced fuel");
  assert.equal(ice, 100 - fuel, "the recipe consumes 2 ice per 2 fuel output, a 1:1 draw");
});

test("a paused Fuel Refinery consumes no ice and makes no fuel", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const pid = colonizableWorld(run);
  run(`S.location = "${pid}";
       S.colonies["${pid}"] = { pop: 5, happiness: 70, tax: 10, buildings: { fuelrefinery: 3, solar: 5 },
         storage: { ice: 100, energy: 0 }, orders: {}, unrest: 0, faction: null, idle: { fuelrefinery: true } };`);
  suppressColonyEvents(run);
  for (let i = 0; i < 5; i++) run(`processColonies();`);
  assert.equal(run(`S.colonies["${pid}"].storage.fuel`), undefined);
  assert.equal(run(`S.colonies["${pid}"].storage.ice`), 100);
});

test("Fuel withdrawn from a colony lands in the player's fuel tank, not the cargo hold", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`const _c = {}; const _o = document.getElementById.bind(document);
       document.getElementById = id => _c[id] || (_c[id] = _o(id));`);
  const pid = colonizableWorld(run);
  run(`S.location = "${pid}";
       S.colonies["${pid}"] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: { fuel: 30 },
         orders: {}, unrest: 0, faction: null, idle: {} };
       S.res.fuel = 0;`);
  run(`document.getElementById("col-fuel").value = 10;`);
  run(`colonyWithdraw("fuel");`);
  assert.equal(run(`S.res.fuel`), 10);
  assert.equal(run(`S.colonies["${pid}"].storage.fuel`), 20);
});

test("fuelrefinery is categorized as industry, alongside its recipe-chain siblings", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`COLONY_BUILD_CAT.fuelrefinery`), "industry");
  assert.equal(run(`colonyBuildCat({ id: "fuelrefinery" })`), "industry");
});
