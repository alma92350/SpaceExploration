"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* Terraforming — reshape an unclaimed colonizable world's own resource deposits
   to the player's pick (2-4 raw commodities) and a population scale, before
   founding a colony there. Gated behind the "terraform" tech (the tree's
   capstone, same gate as the Concordat Spire — spireUnlocked()), paid in full
   up front, then a multi-cycle project (processTerraforming(), called from
   endTurn()) reshapes the world with no cancel/refund once started. */

function firstColonizableWorld(run) { return run(`(PLANETS.find(p => p.colonizable && !p.hidden) || {}).id`); }
function fundTerraforming(run) {
  run(`S.res.credits = 10000000;
       ["biomass","ice","energy","alloys","machinery"].forEach(c => S.res[c] = 100000);`);
  // funding this much credits crosses the "worth" win objective (and "terraform" is
  // usually already set too), so afterAction()'s checkWin() fires fireworks() — which
  // needs requestAnimationFrame, absent in Node. Same stub spire.test.js uses.
  run(`globalThis.requestAnimationFrame = () => 0;`);
}

test("canTerraform mirrors spireUnlocked — false without the tech, true once researched", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`canTerraform()`), false);
  run(`S.techs.terraform = true;`);
  assert.equal(run(`canTerraform()`), true);
});

test("terraformCost/Mats/Cycles scale up with resource count, population tier, and resource rarity", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  // more resources chosen costs and takes longer, at the same tier
  const cost2 = run(`terraformCost(["ore","ice"], "small")`);
  const cost3 = run(`terraformCost(["ore","ice","biomass"], "small")`);
  const cost4 = run(`terraformCost(["ore","ice","biomass","gas"], "small")`);
  assert.ok(cost2 < cost3 && cost3 < cost4, "cost should climb with resource count");
  const cyc2 = run(`terraformCycles(["ore","ice"], "small")`);
  const cyc4 = run(`terraformCycles(["ore","ice","biomass","gas"], "small")`);
  assert.ok(cyc2 < cyc4, "build time should climb with resource count");
  // a bigger population tier costs and takes longer, for the same resources
  const small = run(`terraformCost(["ore","ice"], "small")`);
  const medium = run(`terraformCost(["ore","ice"], "medium")`);
  const large = run(`terraformCost(["ore","ice"], "large")`);
  assert.ok(small < medium && medium < large, "cost should climb with population tier");
  // rarer picks (relics, radioactives) surcharge over common ones (ore, ice) at the same count/tier
  const cheap = run(`terraformCost(["ore","ice"], "small")`);
  const pricey = run(`terraformCost(["relics","radioactives"], "small")`);
  assert.ok(pricey > cheap, "rarer resource picks should cost more to engineer in");
  // materials scale the same way the credits cost does
  const mats2 = run(`terraformMats(["ore","ice"], "small")`);
  const mats4 = run(`terraformMats(["ore","ice","biomass","gas"], "large")`);
  assert.ok(mats4.biomass > mats2.biomass, "materials should scale up with count and tier");
  assert.ok(mats4.alloys > 0, "Medium/Large projects should require the heavier industrial materials");
  assert.equal(mats2.alloys, undefined, "a Small project shouldn't need the heavier industrial materials");
});

test("startTerraforming refuses without the tech, on a non-colonizable world, or once colonized", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const pid = firstColonizableWorld(run);
  run(`S.location = "${pid}"; S.res.credits = 100000;`);
  fundTerraforming(run);
  run(`startTerraforming(["ore","ice"], "small")`);
  assert.equal(run(`S.terraforming["${pid}"]`), undefined, "refused: Terraforming not researched yet");

  run(`S.techs.terraform = true;`);
  const notColonizable = run(`(PLANETS.find(p => !p.colonizable) || {}).id`);
  run(`S.location = "${notColonizable}"; startTerraforming(["ore","ice"], "small");`);
  assert.equal(run(`S.terraforming["${notColonizable}"]`), undefined, "refused: world isn't colonizable");

  run(`S.location = "${pid}";
       S.colonies["${pid}"] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
       startTerraforming(["ore","ice"], "small");`);
  assert.equal(run(`S.terraforming["${pid}"]`), undefined, "refused: already colonized");
});

test("startTerraforming refuses an out-of-range resource count, leaving state untouched", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.terraform = true;`);
  const pid = firstColonizableWorld(run);
  run(`S.location = "${pid}";`);
  fundTerraforming(run);
  run(`startTerraforming(["ore"], "small");`);
  assert.equal(run(`S.terraforming["${pid}"]`), undefined, "1 resource is below the minimum");
  run(`startTerraforming(["ore","ice","biomass","gas","spice"], "small");`);
  assert.equal(run(`S.terraforming["${pid}"]`), undefined, "5 resources is above the maximum");
});

test("startTerraforming refuses without enough credits or materials, leaving state untouched", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.terraform = true;`);
  const pid = firstColonizableWorld(run);
  run(`S.location = "${pid}"; S.res.credits = 10;`);
  run(`startTerraforming(["ore","ice"], "small");`);
  assert.equal(run(`S.terraforming["${pid}"]`), undefined);
  assert.equal(run(`S.res.credits`), 10);
});

test("startTerraforming succeeds: deducts cost/materials and opens a project with the right cycle count", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.terraform = true;`);
  const pid = firstColonizableWorld(run);
  run(`S.location = "${pid}";`);
  fundTerraforming(run);
  const credsBefore = run(`S.res.credits`);
  const expectedCost = run(`terraformCost(["ore","ice"], "small")`);
  const expectedCycles = run(`terraformCycles(["ore","ice"], "small")`);
  run(`startTerraforming(["ore","ice"], "small");`);
  // .join(",") on the vm-side array before comparing — an array built inside the vm
  // context is a different realm's Array than an outer literal, so deepStrictEqual's
  // reference check on the prototype fails even when the contents match
  assert.equal(run(`S.terraforming["${pid}"].resources.slice().sort().join(",")`), "ice,ore");
  assert.equal(run(`S.terraforming["${pid}"].tier`), "small");
  assert.equal(run(`S.terraforming["${pid}"].cyclesLeft`), expectedCycles);
  assert.equal(run(`S.res.credits`), credsBefore - expectedCost);
});

test("a second startTerraforming call on the same world is refused while one is already underway", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.terraform = true;`);
  const pid = firstColonizableWorld(run);
  run(`S.location = "${pid}";`);
  fundTerraforming(run);
  run(`startTerraforming(["ore","ice"], "small");`);
  const firstResources = run(`S.terraforming["${pid}"].resources.slice()`);
  run(`startTerraforming(["gas","spice","relics"], "large");`);
  assert.deepEqual(run(`S.terraforming["${pid}"].resources`), firstResources, "the running project must not be replaced");
});

test("colonize() refuses while a terraforming project is underway at the current world", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.colonial = true; S.techs.terraform = true;`);
  const pid = firstColonizableWorld(run);
  run(`S.location = "${pid}";`);
  fundTerraforming(run);
  run(`startTerraforming(["ore","ice"], "small");`);
  run(`colonize();`);
  assert.equal(run(`S.colonies["${pid}"]`), undefined);
});

test("processTerraforming ticks a project down and only reshapes the world once it completes", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.terraform = true;`);
  const pid = firstColonizableWorld(run);
  run(`S.location = "${pid}";`);
  fundTerraforming(run);
  const cycles = run(`terraformCycles(["ore","gas"], "small")`);
  run(`startTerraforming(["ore","gas"], "small");`);
  for (let i = 0; i < cycles - 1; i++) run(`processTerraforming();`);
  assert.ok(run(`S.terraforming["${pid}"]`), "the project should still be running one cycle before completion");
  assert.equal(run(`PLANETS.find(p => p.id === "${pid}").terraformed`), undefined);
  run(`processTerraforming();`);
  assert.equal(run(`S.terraforming["${pid}"]`), undefined, "the project is cleared on completion");
  const deposits = run(`PLANETS.find(p => p.id === "${pid}").deposits`);
  assert.deepEqual(Object.keys(deposits).sort(), ["gas", "ore"]);
  assert.equal(deposits.ore, run(`TERRAFORM_YIELD_PER_COUNT[2]`));
  assert.equal(run(`PLANETS.find(p => p.id === "${pid}").colonizable`), true);
  assert.equal(run(`PLANETS.find(p => p.id === "${pid}").terraformHousing`), run(`TERRAFORM_POP_TIERS.find(t => t.id === "small").housing`));
  assert.equal(run(`S.terraformed["${pid}"].resources.slice().sort().join(",")`), "gas,ore");
});

test("a completed terraforming project raises the founded colony's housing cap", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.colonial = true; S.techs.terraform = true;`);
  const pid = firstColonizableWorld(run);
  run(`S.location = "${pid}";`);
  const baseHousing = run(`colonyHousing({ buildings: {} }, PLANETS.find(p => p.id === "${pid}"))`);
  fundTerraforming(run);
  const cycles = run(`terraformCycles(["ore","ice"], "large")`);
  run(`startTerraforming(["ore","ice"], "large");`);
  for (let i = 0; i < cycles; i++) run(`processTerraforming();`);
  const newHousing = run(`colonyHousing({ buildings: {} }, PLANETS.find(p => p.id === "${pid}"))`);
  assert.equal(newHousing, baseHousing + run(`TERRAFORM_POP_TIERS.find(t => t.id === "large").housing`));
});

test("replayTerraforming reapplies a completed project's deposits after PLANETS is rebuilt fresh (reload)", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.terraform = true;`);
  const pid = firstColonizableWorld(run);
  run(`S.location = "${pid}";`);
  fundTerraforming(run);
  const cycles = run(`terraformCycles(["crystals","spice"], "medium")`);
  run(`startTerraforming(["crystals","spice"], "medium");`);
  for (let i = 0; i < cycles; i++) run(`processTerraforming();`);
  const depositsAfterCompletion = run(`JSON.stringify(PLANETS.find(p => p.id === "${pid}").deposits)`);
  // simulate a reload: applyCoreVariance()/generateFrontierRing() would reset this
  // world's deposits back to baseline before replayTerraforming() runs, same as
  // territory flips get reapplied after a reload clobbers PLANETS.faction
  run(`const p = PLANETS.find(x => x.id === "${pid}"); p.deposits = { biomass: 1.3, ore: 0.9 }; p.terraformHousing = 0; p.terraformed = false;`);
  run(`replayTerraforming();`);
  assert.equal(run(`JSON.stringify(PLANETS.find(p => p.id === "${pid}").deposits)`), depositsAfterCompletion);
  assert.equal(run(`PLANETS.find(p => p.id === "${pid}").terraformed`), true);
});
