"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* Labor Relief: a paid, temporary Production Surge (colonySurgeMult) for a colony
   that's under-crewed for what it's built, and an on-demand Community Relief
   happiness/unrest perk — both alongside the existing workforce/automation/unrest
   multipliers and the passive goods/luxury/medicine happiness bonuses, not a
   replacement for either. */

function freshColony(run, overrides) {
  run(`S.colonies[S.location] = Object.assign({ pop: 5, happiness: 70, tax: 0, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} }, ${JSON.stringify(overrides || {})});`);
}
// processColonies() also rolls a per-colony random event each cycle (pirate raid/disaster/
// boom) that can loot storage independent of whatever this file is checking — pin
// Math.random past every branch (max threshold 0.16) so only the mechanic under test moves.
function suppressColonyEvents(run) { run(`Math.random = () => 0.99;`); }

test("PRODUCTION_SURGE_TIERS is a strictly increasing cost/magnitude/duration ladder", () => {
  const { run } = createSandbox();
  const tiers = JSON.parse(run(`JSON.stringify(PRODUCTION_SURGE_TIERS)`));
  assert.equal(tiers.length, 3);
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i].mult > tiers[i - 1].mult, "each tier should boost output more than the last");
    assert.ok(tiers[i].cycles >= tiers[i - 1].cycles, "each tier should last at least as long as the last");
    const prevTotal = Object.values(tiers[i - 1].cost).reduce((a, b) => a + b, 0);
    const total = Object.values(tiers[i].cost).reduce((a, b) => a + b, 0);
    assert.ok(total > prevTotal, "each tier should cost strictly more than the last");
  }
  assert.ok(tiers.every(t => t.cycles >= 10 && t.cycles <= 15), "durations should land in the requested 10-15 cycle window");
});

test("colonySurgeMult is 1 with no active surge, and the tier's mult once one is running", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshColony(run, {});
  assert.equal(run(`colonySurgeMult(S.colonies[S.location])`), 1);
  freshColony(run, { surge: { tier: 2, mult: 1.3, cyclesLeft: 12, total: 12 } });
  assert.equal(run(`colonySurgeMult(S.colonies[S.location])`), 1.3);
});

test("startProductionSurge pays local storage first, then the hold, and sets col.surge", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  // stock the colony with exactly half of tier 1's cost, and the hold with the other half
  freshColony(run, { storage: { electronics: 5, machinery: 2, ai: 1, alloys: 7 } });
  run(`S.res.tech = 15; S.res.electronics = 5; S.res.machinery = 3; S.res.ai = 1; S.res.alloys = 8;`);
  run(`startProductionSurge(1);`);
  assert.equal(run(`!!S.colonies[S.location].surge`), true, "a surge should now be running");
  assert.equal(run(`S.colonies[S.location].surge.tier`), 1);
  assert.equal(run(`S.colonies[S.location].surge.mult`), run(`PRODUCTION_SURGE_TIERS[0].mult`));
  assert.equal(run(`S.colonies[S.location].surge.cyclesLeft`), run(`PRODUCTION_SURGE_TIERS[0].cycles`));
  // colony storage (5 electronics) should be drained before any hold electronics is touched
  assert.equal(run(`S.colonies[S.location].storage.electronics`), 0);
  assert.equal(run(`S.res.electronics`), 0, "hold covers only the 5 electronics the colony couldn't");
  assert.equal(run(`S.colonies[S.location].storage.alloys`), 0);
  assert.equal(run(`S.res.alloys`), 0, "8 - (15-7)=0 left in hold after the colony's 7 alloys are spent first");
});

test("startProductionSurge refuses (and spends nothing) when unaffordable", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  freshColony(run, {});
  run(`startProductionSurge(3);`);
  assert.equal(run(`!S.colonies[S.location].surge`), true);
  assert.equal(run(`S.res.tech`), 0, "a rejected surge should not touch any resource");
});

test("startProductionSurge refuses a second surge while one is already running", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  freshColony(run, { surge: { tier: 1, mult: 1.15, cyclesLeft: 10, total: 10 } });
  run(`S.res.tech = 1000; S.res.electronics = 1000; S.res.machinery = 1000; S.res.ai = 1000; S.res.alloys = 1000;`);
  run(`startProductionSurge(3);`);
  assert.equal(run(`S.colonies[S.location].surge.tier`), 1, "the original tier-1 surge should be untouched");
  assert.equal(run(`S.res.tech`), 1000, "nothing should be spent on the refused upgrade attempt");
});

test("an active surge measurably raises both raw-producer and industry-chain output, all else equal", () => {
  // one sandbox/planet/freshState() for both halves — re-rolling freshState() per half would
  // also re-roll the start world's tech (colonyAutomationMult depends on effTech(planet)),
  // an unrelated source of noise this comparison doesn't want.
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.metallurgy = true;`);
  suppressColonyEvents(run);
  const outputWith = (surge) => {
    freshColony(run, Object.assign({ pop: 40, happiness: 70, buildings: { foundry: 5, garrison: 5 }, storage: { metals: 100, energy: 100 } }, surge ? { surge } : {}));
    run(`processColonies();`);
    return run(`S.colonies[S.location].storage.alloys || 0`);
  };
  const plainOutput = outputWith(null);
  const surgedOutput = outputWith({ tier: 3, mult: 1.5, cyclesLeft: 15, total: 15 });
  assert.ok(surgedOutput > plainOutput, `a tier-3 surge (${surgedOutput}) should beat the unsurged colony (${plainOutput})`);
});

test("a surge ticks down and clears itself exactly after its tier's cycle count", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  freshColony(run, { surge: { tier: 1, mult: 1.15, cyclesLeft: 3, total: 10 } });
  suppressColonyEvents(run);
  run(`processColonies();`);
  assert.equal(run(`S.colonies[S.location].surge.cyclesLeft`), 2);
  run(`processColonies();`);
  assert.equal(run(`S.colonies[S.location].surge.cyclesLeft`), 1);
  run(`processColonies();`);
  assert.equal(run(`S.colonies[S.location].surge`), null, "the surge should clear itself once its clock runs out");
});

test("giveMoralePerk raises happiness (capped 100), relieves unrest (floored 0), and pays local storage first", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  freshColony(run, { happiness: 95, unrest: 0, storage: { goods: 3 } });
  run(`S.res.goods = 100;`);
  const cost = JSON.parse(run(`JSON.stringify(moralePerkCost(S.colonies[S.location]))`));
  run(`giveMoralePerk();`);
  assert.equal(run(`S.colonies[S.location].happiness`), 100, "happiness should cap at 100, not overshoot");
  assert.equal(run(`S.colonies[S.location].unrest`), 0, "unrest should floor at 0, not go negative");
  assert.equal(run(`S.colonies[S.location].storage.goods`), 0, "the 3 stored goods should be spent first");
  assert.equal(run(`S.res.goods`), 100 - (cost.goods - 3), "the hold covers only the shortfall");
  assert.equal(run(`S.colonies[S.location].perkCooldown`), run(`MORALE_PERK_COOLDOWN`));
});

test("giveMoralePerk refuses (and spends nothing) while on cooldown or unaffordable", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  freshColony(run, { happiness: 50, unrest: 2, perkCooldown: 3, storage: {} });
  run(`S.res.goods = 0;`);
  run(`giveMoralePerk();`);
  assert.equal(run(`S.colonies[S.location].happiness`), 50, "cooldown should block the perk entirely");
  assert.equal(run(`S.colonies[S.location].unrest`), 2);
  freshColony(run, { happiness: 50, unrest: 2, perkCooldown: 0, storage: {} });
  run(`S.res.goods = 0;`);
  run(`giveMoralePerk();`);
  assert.equal(run(`S.colonies[S.location].happiness`), 50, "no goods anywhere should also block it");
});

test("renderColonies draws the Labor Relief card (tier costs, including the non-cargo Tech Pts) without throwing", () => {
  // fleetMatsString (fleet.js) previously assumed every cost key was a COM cargo commodity;
  // a surge's cost dict names "tech", a META resource with no COM entry, and blew up mid-render.
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.showAllTabs = true; S.techs.colonial = true;`);
  const pid = run(`(PLANETS.find(p => p.colonizable) || {}).id`);
  run(`S.location = "${pid}";`);
  const cacheGetElementById = `const _c = {}; const _o = document.getElementById.bind(document);
    document.getElementById = id => _c[id] || (_c[id] = _o(id));`;
  run(cacheGetElementById);
  freshColony(run, { buildings: { foundry: 5 }, storage: {} });
  run(`renderColonies();`);
  const html = run(`document.getElementById("panel-colonies").innerHTML`);
  assert.match(html, /Labor Relief/);
  assert.match(html, /Overtime Shift/);
  assert.match(html, /Community Relief/);
});

test("perkCooldown ticks down each cycle and the perk is usable again once it hits 0", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  freshColony(run, { perkCooldown: 2, storage: {} });
  suppressColonyEvents(run);
  run(`processColonies();`);
  assert.equal(run(`S.colonies[S.location].perkCooldown`), 1);
  run(`processColonies();`);
  assert.equal(run(`S.colonies[S.location].perkCooldown`), 0);
  run(`S.res.goods = 1000;`);
  run(`giveMoralePerk();`);
  assert.equal(run(`S.colonies[S.location].perkCooldown`), run(`MORALE_PERK_COOLDOWN`), "the perk should be usable again at cooldown 0");
});
