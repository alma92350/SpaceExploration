"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("trimBuildPool sums only cargo/fueltank/engine/cannons tiers", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`trimBuildPool()`), 0, "a fresh ship has nothing invested yet");
  run(`S.upgrades.cargo = 2; S.upgrades.fueltank = 1; S.upgrades.engine = 3; S.upgrades.cannons = 1; S.upgrades.shield = 3;`);
  assert.equal(run(`trimBuildPool()`), 7, "shield (unrelated axis) shouldn't count toward the pool");
});

test("trimRefitCost and trimRefitCycles scale up with the build pool", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  const baseCost = run(`trimRefitCost()`), baseCycles = run(`trimRefitCycles()`);
  run(`S.upgrades.cargo = 3; S.upgrades.cannons = 3;`);
  assert.ok(run(`trimRefitCost()`) > baseCost, "a bigger build should cost more to refit");
  assert.ok(run(`trimRefitCycles()`) >= baseCycles, "a bigger build should take at least as long to refit");
});

test("setShipTrim refuses to switch to the currently active trim", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  run(`setShipTrim("balanced");`);
  assert.equal(run(`S.trimRefit`), null, "already-balanced should be refused before spending anything");
  assert.equal(run(`S.res.credits`), 100000);
});

test("setShipTrim refuses without enough credits, leaving state untouched", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 10;`);
  run(`setShipTrim("gunship");`);
  assert.equal(run(`S.trimRefit`), null);
  assert.equal(run(`S.trim`), "balanced");
  assert.equal(run(`S.res.credits`), 10);
});

test("setShipTrim deducts credits and starts a timed refit", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  const cost = run(`trimRefitCost()`), cycles = run(`trimRefitCycles()`);
  run(`setShipTrim("gunship");`);
  assert.equal(run(`S.trim`), "balanced", "the old trim stays active until the refit completes");
  assert.equal(run(`S.trimRefit.target`), "gunship");
  assert.equal(run(`S.trimRefit.cyclesLeft`), cycles);
  assert.equal(run(`S.res.credits`), 100000 - cost);
});

test("setShipTrim refuses a second refit while one is already underway", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 1000000;`);
  run(`setShipTrim("gunship");`);
  const creditsAfterFirst = run(`S.res.credits`);
  run(`setShipTrim("voyager");`);
  assert.equal(run(`S.trimRefit.target`), "gunship", "the in-progress refit shouldn't be overridden");
  assert.equal(run(`S.res.credits`), creditsAfterFirst, "no credits should be spent on the refused second refit");
});

test("processTrimRefit ticks down and does nothing while no refit is active", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  run(`processTrimRefit();`);
  assert.equal(run(`S.trim`), "balanced");
  assert.equal(run(`S.trimRefit`), null);
});

test("processTrimRefit completes the refit once cyclesLeft reaches 0, and not before", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 1000000;`);
  run(`setShipTrim("hauler");`);
  const cycles = run(`S.trimRefit.cyclesLeft`);
  for (let i = 0; i < cycles - 1; i++) {
    run(`processTrimRefit();`);
    assert.equal(run(`S.trim`), "balanced", `should still be balanced after tick ${i + 1}`);
  }
  run(`processTrimRefit();`);
  assert.equal(run(`S.trim`), "hauler", "the final tick should complete the refit");
  assert.equal(run(`S.trimRefit`), null);
});

test("switching back to balanced costs the same as switching away — no free undo", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 1000000;`);
  run(`setShipTrim("gunship"); const _n = S.trimRefit.cyclesLeft; for (let i = 0; i < _n; i++) processTrimRefit();`);
  assert.equal(run(`S.trim`), "gunship");
  const creditsBeforeUndo = run(`S.res.credits`);
  const cost = run(`trimRefitCost()`);
  run(`setShipTrim("balanced");`);
  assert.equal(run(`S.res.credits`), creditsBeforeUndo - cost, "reverting to Balanced should cost a full refit too");
});

test("cargoCap/fuelCap only reflect the trim once the refit actually completes", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 1000000; S.upgrades.cargo = 2; S.upgrades.fueltank = 2;`);
  const balancedCargo = run(`cargoCap()`), balancedFuel = run(`fuelCap()`);
  run(`setShipTrim("hauler");`);
  assert.equal(run(`cargoCap()`), balancedCargo, "mid-refit, stats should be unchanged");
  run(`const _n = S.trimRefit.cyclesLeft; for (let i = 0; i < _n; i++) processTrimRefit();`);
  assert.ok(run(`cargoCap()`) > balancedCargo, "Hauler should raise cargo capacity once the refit lands");
  assert.ok(run(`fuelCap()`) < balancedFuel, "Hauler should lower fuel capacity (autonomy trade-off) once the refit lands");
});

test("raidPower respects the firepower trim once installed", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 1000000; S.upgrades.cannons = 3;`);
  const balancedPower = run(`raidPower()`);
  run(`setShipTrim("gunship"); const _n = S.trimRefit.cyclesLeft; for (let i = 0; i < _n; i++) processTrimRefit();`);
  assert.ok(run(`raidPower()`) > balancedPower, "Gunship trim should raise raid power");
});

test("a Cargo/Firepower/Autonomy trim with zero invested tiers changes nothing", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 1000000;`);
  const balancedCargo = run(`cargoCap()`), balancedFuel = run(`fuelCap()`), balancedPower = run(`raidPower()`);
  run(`setShipTrim("gunship"); const _n = S.trimRefit.cyclesLeft; for (let i = 0; i < _n; i++) processTrimRefit();`);
  assert.equal(run(`cargoCap()`), balancedCargo, "nothing invested in cargo means nothing to trade away");
  assert.equal(run(`fuelCap()`), balancedFuel, "nothing invested in fueltank means nothing to trade away");
  assert.equal(run(`raidPower()`), balancedPower, "nothing invested in cannons means the firepower trim has nothing to boost");
});
