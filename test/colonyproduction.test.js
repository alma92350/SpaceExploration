"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* Colony production used to be pure tier×rate, gated only by input stock and
   storage room — population, research and political stability never entered
   the formula, even though effIndustry()/effTech() already track population
   and get displayed on every colony card. Separately, population growth was
   capped by ONLY this cycle's raw food output (foodMade), ignoring the food
   stockpile entirely — a colony could sit on thousands of stored biomass,
   with maxed happiness and ample housing, and still plateau exactly at
   whatever its farm currently produces per cycle. This file covers both the
   growth-cap bug fix and the three new production multipliers (workforce,
   automation, unrest). */

function freshColony(run, overrides) {
  run(`S.colonies[S.location] = Object.assign({ pop: 5, happiness: 70, tax: 0, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} }, ${JSON.stringify(overrides || {})});`);
}

test("population growth respects a stocked granary, not just this cycle's raw harvest", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();
       S.colonies[S.location] = { pop: 20, happiness: 90, tax: 0,
         buildings: { farm: 3, habitat: 6 }, storage: { biomass: 5000, goods: 100, luxury: 50, medicine: 50 },
         orders: {}, unrest: 0, faction: null, idle: {} };`);
  const farmRawOutput = run(`Math.round(3 * 8)`);   // the old plateau: tier-3 farm's raw per-cycle output
  for (let i = 0; i < 20; i++) run(`processColonies();`);
  const finalPop = run(`S.colonies[S.location].pop`);
  assert.ok(finalPop > farmRawOutput + 4, `population (${finalPop}) should climb well past the old farm-output plateau (${farmRawOutput}) given a 5,000-biomass stockpile`);
});

test("colonyLaborNeeded sums every building's tier, and colonyWorkforceMult returns 1 with no buildings", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshColony(run, {});
  assert.equal(run(`colonyLaborNeeded(S.colonies[S.location])`), 0);
  assert.equal(run(`colonyWorkforceMult(S.colonies[S.location])`), 1, "nothing built yet — no workforce penalty or bonus");
  freshColony(run, { buildings: { factory: 3, habitat: 2 } });
  assert.equal(run(`colonyLaborNeeded(S.colonies[S.location])`), 5);
});

test("colonyLaborNeeded excludes paused (idle) buildings, so pausing eases workforce strain", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshColony(run, { buildings: { factory: 3, habitat: 2 } });
  assert.equal(run(`colonyLaborNeeded(S.colonies[S.location])`), 5);
  run(`S.colonies[S.location].idle.factory = true;`);
  assert.equal(run(`colonyLaborNeeded(S.colonies[S.location])`), 2, "a paused building's tiers shouldn't count toward labor demand");
  run(`S.colonies[S.location].idle.factory = false;`);
  assert.equal(run(`colonyLaborNeeded(S.colonies[S.location])`), 5, "resuming restores its labor demand");
});

test("colonyWorkforceMult floors at WORKFORCE_MIN when badly understaffed", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshColony(run, { pop: 5, buildings: { factory: 10 } });   // needs 10*LABOR_PER_TIER pop to be fully staffed
  assert.equal(run(`colonyWorkforceMult(S.colonies[S.location])`), run(`WORKFORCE_MIN`));
});

test("colonyWorkforceMult caps at WORKFORCE_MAX when heavily overstaffed", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshColony(run, { pop: 500, buildings: { factory: 1 } });
  assert.equal(run(`colonyWorkforceMult(S.colonies[S.location])`), run(`WORKFORCE_MAX`));
});

test("colonyWorkforceMult scales linearly with the staffing ratio between the two clamps", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshColony(run, { pop: 7, buildings: { factory: 5 } });   // needed = 5*LABOR_PER_TIER = 10, ratio = 0.7
  assert.equal(run(`colonyWorkforceMult(S.colonies[S.location])`), 0.7);
});

test("colonyAutomationMult scales with effTech(planet) and caps at 1+AUTOMATION_CAP", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshColony(run, {});
  const baseTech = run(`effTech(currentPlanet())`);
  const expected = 1 + Math.min(run(`AUTOMATION_CAP`), baseTech * run(`AUTOMATION_PER_TECH`));
  assert.equal(run(`colonyAutomationMult(currentPlanet())`), expected);
  // push effTech well past the cap threshold (AUTOMATION_CAP/AUTOMATION_PER_TECH ≈ 16.7)
  freshColony(run, { pop: 400, buildings: { lab: 20 } });
  assert.ok(run(`effTech(currentPlanet())`) > 17, "this setup should comfortably exceed the automation cap's effTech threshold");
  assert.equal(run(`colonyAutomationMult(currentPlanet())`), 1 + run(`AUTOMATION_CAP`));
});

test("colonyUnrestMult scales down with unrest and floors at UNREST_FLOOR", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshColony(run, { unrest: 0 });
  assert.equal(run(`colonyUnrestMult(S.colonies[S.location])`), 1);
  freshColony(run, { unrest: 5 });
  assert.equal(run(`colonyUnrestMult(S.colonies[S.location])`), 0.7);
  freshColony(run, { unrest: 20 });
  assert.equal(run(`colonyUnrestMult(S.colonies[S.location])`), run(`UNREST_FLOOR`));
});

test("an understaffed colony's industry-chain output lands below the nominal tier*rate", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.metallurgy = true;`);
  // storage cap is 300 with no habitat/spaceport — keep inputs well under that, with room for output
  freshColony(run, { pop: 3, happiness: 70, unrest: 0, buildings: { foundry: 5 }, storage: { metals: 100, energy: 100 } });
  run(`processColonies();`);
  const nominal = 5 * 2;   // foundry: tier 5, rate 2 (colonization.js/catalogs.js recipe.rate)
  const alloysMade = run(`S.colonies[S.location].storage.alloys || 0`);
  assert.ok(alloysMade < nominal, `understaffed output (${alloysMade}) should be below the nominal ${nominal} batches`);
  assert.ok(alloysMade > 0, "the workforce floor (0.5x) should still leave SOME output, not zero it out entirely");
});

test("a well-staffed, high-tech, zero-unrest colony's industry-chain output meets or beats nominal (automation bonus)", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.metallurgy = true;`);
  freshColony(run, { pop: 200, happiness: 90, unrest: 0, buildings: { foundry: 5, lab: 10, habitat: 2 }, storage: { metals: 100, energy: 100 } });
  run(`processColonies();`);
  const nominal = 5 * 2;
  const alloysMade = run(`S.colonies[S.location].storage.alloys || 0`);
  assert.ok(alloysMade >= nominal, `well-staffed + high-tech output (${alloysMade}) should meet or beat the nominal ${nominal} batches`);
});

test("rising unrest measurably reduces industry-chain output, all else equal", () => {
  const { run } = createSandbox();
  const setup = (unrest) => {
    run(`S = freshState(); rollPrices(); S.techs.metallurgy = true;`);
    // a garrison raises the secession threshold (revoltAt = 4 + colonyDefense) well above the
    // unrest values under test — this test wants the OUTPUT penalty, not an actual revolt
    freshColony(run, { pop: 40, happiness: 70, unrest, buildings: { foundry: 5, garrison: 5 }, storage: { metals: 100, energy: 100 } });
    run(`processColonies();`);
    return run(`S.colonies[S.location].storage.alloys || 0`);
  };
  const calmOutput = setup(0);
  const unrestOutput = setup(6);
  assert.ok(unrestOutput < calmOutput, `unrest should reduce output (calm=${calmOutput}, unrest=${unrestOutput})`);
});

test("a paused building still produces and consumes nothing, regardless of the new multipliers", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.metallurgy = true;`);
  freshColony(run, { pop: 200, happiness: 90, unrest: 0, buildings: { foundry: 5, lab: 10 }, storage: { metals: 1000, energy: 1000 }, idle: { foundry: true } });
  // pin out the random per-cycle colony event (pirate raid/disaster/boom, colonyEventRoll)
  // so an unrelated raid can't loot storage and break this exact-equality assertion
  run(`Math.random = () => 0.99;`);
  run(`processColonies();`);
  assert.equal(run(`S.colonies[S.location].storage.alloys || 0`), 0, "a paused foundry should make nothing");
  assert.equal(run(`S.colonies[S.location].storage.metals`), 1000, "a paused foundry should consume nothing either");
});

test("an understaffed extractor depletes its planet's deposit reserve more slowly than a fully-staffed one", () => {
  // one sandbox/planet for both halves — applyCoreVariance() jitters deposit richness
  // per freshState() call, so two separately-seeded sandboxes aren't a fair comparison;
  // resetting the SAME reserve back to full between runs is deterministic instead
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const dep = run(`Object.keys(currentPlanet().deposits || {})[0]`);
  if (!dep) return;   // the randomly-chosen start world has no deposits this run — nothing to assert
  const maxReserve = run(`reserveOf(S.location, "${dep}").max`);

  freshColony(run, { pop: 3, buildings: { ["ext_" + dep]: 5 }, storage: {} });
  run(`processColonies();`);
  const understaffedReserve = run(`reserveOf(S.location, "${dep}").cur`);

  run(`S.reserves[S.location]["${dep}"] = { cur: ${maxReserve}, max: ${maxReserve} };`);   // reset to full before the second trial
  freshColony(run, { pop: 400, buildings: { ["ext_" + dep]: 5 }, storage: {} });
  run(`processColonies();`);
  const staffedReserve = run(`reserveOf(S.location, "${dep}").cur`);

  assert.ok(understaffedReserve > staffedReserve, `an understaffed mine (reserve ${understaffedReserve}) should draw down the deposit less than a fully-staffed one (reserve ${staffedReserve})`);
});
