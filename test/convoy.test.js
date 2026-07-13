"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function freighterKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "freighter")`); }
function warshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "warship")`); }

test("assignConvoy refuses a ship that isn't idle", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState();
       S.fleet = [{ id: "s1", key: "${fr}", name: "Busy", home: S.location, status: "mission", hull: 10, hullMax: 10 }];`);
  run(`assignConvoy("s1");`);
  assert.equal(run(`S.fleet[0].status`), "mission", "a ship already on duty should not be pulled into the convoy");
});

test("assignConvoy refuses a ship not docked at its home port", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState();
       const otherPid = Object.keys(currentPlanet().distances)[0];
       S.fleet = [{ id: "s1", key: "${fr}", name: "AwayShip", home: otherPid, status: "idle", hull: 10, hullMax: 10 }];`);
  run(`assignConvoy("s1");`);
  assert.equal(run(`S.fleet[0].status`), "idle", "a ship must be docked at its own home port to join the convoy");
});

test("assignConvoy and recallConvoy toggle status for an idle ship docked here", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState(); rollPrices();
       S.fleet = [{ id: "s1", key: "${fr}", name: "Tramp", home: S.location, status: "idle", hull: 10, hullMax: 10 }];`);
  run(`assignConvoy("s1");`);
  assert.equal(run(`S.fleet[0].status`), "convoy", "assignConvoy should mark the ship as convoy status");
  run(`recallConvoy("s1");`);
  assert.equal(run(`S.fleet[0].status`), "idle", "recallConvoy should return the ship to idle");
});

test("convoyCargoBonus sums convoy freighter capacity, scaled by hull fraction", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState();
       S.fleet = [{ id: "s1", key: "${fr}", name: "Full", home: S.location, status: "convoy", hull: 100, hullMax: 100 }];`);
  const capFull = run(`FLEET_SHIPS["${fr}"].cap`);
  assert.equal(run(`convoyCargoBonus()`), capFull, "a full-hull convoy freighter should contribute its full cap");
});

test("convoyCargoBonus has no ceiling — it keeps growing with more freighters", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState();
       S.fleet = Array.from({length: 6}, (_, i) => ({ id: "s"+i, key: "${fr}", name: "F"+i, home: S.location, status: "convoy", hull: 100, hullMax: 100 }));`);
  const capFull = run(`FLEET_SHIPS["${fr}"].cap`);
  const bonus = run(`convoyCargoBonus()`);
  assert.equal(bonus, capFull * 6, "stacking freighters should sum without any cap");
});

test("a damaged convoy freighter contributes less cargo than a healthy one", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState();
       S.fleet = [{ id: "s1", key: "${fr}", name: "Wounded", home: S.location, status: "convoy", hull: 20, hullMax: 100 }];`);
  const wounded = run(`convoyCargoBonus()`);
  run(`S.fleet[0].hull = 100;`);
  const healthy = run(`convoyCargoBonus()`);
  assert.ok(wounded < healthy, "a battered freighter should haul less than a healthy one");
});

test("cargoCap() includes convoyCargoBonus()", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState();`);
  const before = run(`cargoCap()`);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Tramp", home: S.location, status: "convoy", hull: 100, hullMax: 100 }];`);
  const after = run(`cargoCap()`);
  assert.equal(after, before + run(`convoyCargoBonus()`), "cargoCap() should add the convoy's bonus on top of the base");
});

test("convoyFuelSurcharge scales with convoy size and caps at 50%", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState();`);
  assert.equal(run(`convoyFuelSurcharge()`), 0, "no convoy ships means no surcharge");
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "F1", home: S.location, status: "convoy", hull: 10, hullMax: 10 }];`);
  assert.ok(Math.abs(run(`convoyFuelSurcharge()`) - 0.08) < 1e-9, "one convoy ship should add an 8% surcharge");
  run(`S.fleet = Array.from({length: 10}, (_, i) => ({ id: "s"+i, key: "${fr}", name: "F"+i, home: S.location, status: "convoy", hull: 10, hullMax: 10 }));`);
  assert.equal(run(`convoyFuelSurcharge()`), 0.5, "the surcharge should cap at 50% no matter how many ships are added");
});

test("fuelCost() rises with the convoy fuel surcharge", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState();`);
  const destId = run(`Object.keys(currentPlanet().distances)[0]`);
  const before = run(`fuelCost("${destId}")`);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "F1", home: S.location, status: "convoy", hull: 10, hullMax: 10 }];`);
  const after = run(`fuelCost("${destId}")`);
  assert.ok(after > before, "towing a convoy should cost more fuel per jump");
});

test("convoyGuardCount counts convoy warships and following pirate bands", () => {
  const { run } = createSandbox();
  const wr = warshipKey(run);
  run(`S = freshState();`);
  assert.equal(run(`convoyGuardCount()`), 0, "no escorts means zero guards");
  run(`S.fleet = [{ id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "convoy", hull: 10, hullMax: 10 }];`);
  assert.equal(run(`convoyGuardCount()`), 1, "a convoy-status warship should count as a guard");
  run(`S.pirateBands = { b1: { id: "b1", name: "Band", status: "active", follow: true, followUntil: S.turn + 5 } };`);
  assert.equal(run(`convoyGuardCount()`), 2, "a currently-following pirate band should also count as a guard");
});

test("maybeAmbush's odds are damped by convoyGuardCount, same shape as processConvoys", () => {
  const { run } = createSandbox();
  const wr = warshipKey(run);
  run(`S = freshState(); S.pirates = {}; S.pirates[S.location] = 5; S.pirateCalm = 0;`);
  // pin a roll that would trigger an ambush with zero guards but not with enough guards
  const chanceNoGuards = run(`0.05 + pirateLevel(S.location) * 0.045`);
  run(`S.fleet = [];`);
  const rollJustUnderNoGuardChance = chanceNoGuards - 0.001;
  run(`Math.random = () => ${rollJustUnderNoGuardChance};`);
  run(`maybeAmbush(currentPlanet());`);
  assert.ok(run(`!!S.encounter`), "with no guards, a roll just under the base chance should trigger an ambush");

  run(`S.encounter = null; S.fleet = [{ id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "convoy", hull: 10, hullMax: 10 }, { id: "w2", key: "${wr}", name: "Guard2", home: S.location, status: "convoy", hull: 10, hullMax: 10 }];`);
  run(`maybeAmbush(currentPlanet());`);
  assert.ok(!run(`!!S.encounter`), "the same roll should NOT trigger an ambush once guards damp the odds below it");
});

test("convoyAmbushRisk damages a convoy freighter, reduced by guards, and purges it on destruction", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState(); S.res.credits = 10000;
       S.fleet = [{ id: "s1", key: "${fr}", name: "Target", home: S.location, status: "convoy", hull: 5, hullMax: 100 }];`);
  run(`Math.random = () => 0.9;`); // near the top of the (0.5 + Math.random()) range, deterministic
  run(`convoyAmbushRisk(5);`);
  assert.equal(run(`S.fleet.length`), 0, "a low-hull freighter should be destroyed and purged by a strong-enough hit");
});

test("convoyAmbushRisk is a no-op with no convoy freighters", () => {
  const { run } = createSandbox();
  const wr = warshipKey(run);
  run(`S = freshState(); S.res.credits = 10000;
       S.fleet = [{ id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "convoy", hull: 10, hullMax: 10 }];`);
  run(`convoyAmbushRisk(5);`);
  assert.equal(run(`S.fleet.length`), 1, "with only a warship in the convoy, there is no freighter for pirates to swipe at");
  assert.equal(run(`S.res.credits`), 10000, "no credits should be lost when there is no freighter to target");
});

test("scrapShip refuses a ship that's on convoy duty", () => {
  const { run, state } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState();
       S.fleet = [{ id: "s1", key: "${fr}", name: "Convoy Ship", home: S.location, status: "convoy", hull: 10, hullMax: 10 }];`);
  state.confirmResult = true;
  run(`scrapShip("s1");`);
  assert.equal(run(`S.fleet.length`), 1, "a ship riding in the convoy should not be scrapped until recalled");
  assert.equal(state.confirmCalls.length, 0, "the confirm dialog shouldn't even appear for a ship on convoy duty");
});

function knownDest(run) { return run(`(PLANETS.find(p => isActive(p) && galaxyKnown(p) && p.id !== S.location) || {}).id`); }

test("convoyTravelLegs returns 1 with no convoy freighters, and at least tankerRunCycles' 2-cycle floor once one rides along", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState();`);
  const destId = knownDest(run);
  assert.equal(run(`convoyTravelLegs("${destId}")`), 1, "no convoy freighters means a normal one-cycle jump");
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "F1", home: S.location, status: "convoy", hull: 10, hullMax: 10 }];`);
  const legs = run(`convoyTravelLegs("${destId}")`);
  assert.ok(legs >= 2, "towing even one freighter should take at least 2 cycles, tankerRunCycles' own floor");
});

test("convoyTravelLegs is gated by the SLOWEST freighter riding along, not the fastest", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  const destId = knownDest(run);
  const fastKey = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "freighter" && FLEET_SHIPS[k].tier === 1)`);
  const slowKey = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "freighter" && FLEET_SHIPS[k].tier === 4)`);
  run(`S.fleet = [{ id: "fast", key: "${fastKey}", name: "Fast", home: S.location, status: "convoy", hull: 10, hullMax: 10 }];`);
  const legsFastOnly = run(`convoyTravelLegs("${destId}")`);
  run(`S.fleet.push({ id: "slow", key: "${slowKey}", name: "Slow", home: S.location, status: "convoy", hull: 10, hullMax: 10 });`);
  const legsWithSlow = run(`convoyTravelLegs("${destId}")`);
  assert.ok(legsWithSlow >= legsFastOnly, "adding a slower freighter to the convoy should never make the trip faster");
});

test("travel() burns extra cycles (S.turn advances by convoyTravelLegs) when towing a convoy freighter", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const destId = knownDest(run);
  const slowKey = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "freighter" && FLEET_SHIPS[k].tier === 4)`);
  run(`S.fleet = [{ id: "s1", key: "${slowKey}", name: "Slow", home: S.location, status: "convoy", hull: 10, hullMax: 10 }];
       S.res.fuel = 1000000;`);
  const legs = run(`convoyTravelLegs("${destId}")`);
  assert.ok(legs >= 2, "sanity check: this convoy should stretch the trip past a single cycle");
  const turnBefore = run(`S.turn`);
  run(`travel("${destId}");`);
  assert.equal(run(`S.turn`), turnBefore + legs, "travel() should advance S.turn by exactly convoyTravelLegs' cycle count");
  assert.equal(run(`S.location`), destId, "the player should still arrive at the destination");
});

test("travel() advances exactly one cycle with no convoy freighters, same as before this feature", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.fuel = 1000000;`);
  const destId = knownDest(run);
  const turnBefore = run(`S.turn`);
  run(`travel("${destId}");`);
  assert.equal(run(`S.turn`), turnBefore + 1, "a solo jump with no convoy freighters should still take exactly one cycle");
});
