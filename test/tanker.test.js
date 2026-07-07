"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function tankerKeys(run) { return run(`Object.keys(FLEET_SHIPS).filter(k => FLEET_SHIPS[k].role === "tanker")`); }
function tankerKeyAt(run, tier) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "tanker" && FLEET_SHIPS[k].tier === ${tier})`); }
function warshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "warship")`); }
// a destination genuinely reachable via assignTankerRun's own galaxyKnown() gate — NOT just any
// key in currentPlanet().distances, since most of those aren't actually charted at game start.
function knownDest(run) { return run(`(PLANETS.find(p => isActive(p) && galaxyKnown(p) && p.id !== S.location) || {}).id`); }

function withColonyShipyard(run, tier) {
  run(`S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: { shipyard: ${tier} }, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
}
function withBaseShipyard(run, tier) {
  run(`S.bases[S.location] = { modules: { shipyard_small: ${tier} }, storage: {}, trade: { on: false, exp: {}, imp: {}, cols: {} } };`);
}

test("FLEET_SHIPS has exactly 4 tanker hulls, tiers 1-4, increasing cap and decreasing speed", () => {
  const { run } = createSandbox();
  const keys = tankerKeys(run);
  assert.equal(keys.length, 4, "there should be exactly 4 tanker hulls");
  const defs = JSON.parse(run(`JSON.stringify(${JSON.stringify(keys)}.map(k => FLEET_SHIPS[k]))`));
  const tiers = defs.map(d => d.tier).sort((a, b) => a - b);
  assert.deepEqual(tiers, [1, 2, 3, 4], "tanker tiers should span 1-4");
  const byTier = defs.slice().sort((a, b) => a.tier - b.tier);
  for (let i = 1; i < byTier.length; i++) {
    assert.ok(byTier[i].cap > byTier[i - 1].cap, "cap should increase with tier");
    assert.ok(byTier[i].speed < byTier[i - 1].speed, "speed should decrease with tier — bigger tankers are slower");
    assert.ok(byTier[i].speed > 0 && byTier[i].speed <= 1, "speed should be a 0-1 multiplier");
  }
});

test("fleetShipSpeed defaults to 1 for any hull without a speed field (freighters/warships unaffected)", () => {
  const { run } = createSandbox();
  const fr = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "freighter")`);
  const wr = warshipKey(run);
  assert.equal(run(`fleetShipSpeed(FLEET_SHIPS["${fr}"])`), 1);
  assert.equal(run(`fleetShipSpeed(FLEET_SHIPS["${wr}"])`), 1);
  const t1 = tankerKeyAt(run, 1);
  assert.ok(run(`fleetShipSpeed(FLEET_SHIPS["${t1}"])`) < 1, "a tanker should be slower than full speed");
});

test("orderShip: a Tier-1/2 tanker builds at a base Small Shipyard, Tier-3/4 is refused there but builds at a colony Tier-4 Shipyard", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), t2 = tankerKeyAt(run, 2), t3 = tankerKeyAt(run, 3), t4 = tankerKeyAt(run, 4);
  run(`S = freshState(); rollPrices(); S.res.credits = 1000000; S.res.metals = 10000; S.res.electronics = 10000; S.res.radioactives = 10000; S.res.alloys = 10000; S.res.ai = 10000;`);
  withBaseShipyard(run, 2);
  run(`orderShip("${t1}"); orderShip("${t2}");`);
  assert.equal(run(`S.fleet.filter(s => s.key === "${t1}").length`), 1, "a Tier-1 tanker should build at a Tier-2 base Small Shipyard");
  assert.equal(run(`S.fleet.filter(s => s.key === "${t2}").length`), 1, "a Tier-2 tanker should build at a Tier-2 base Small Shipyard");
  run(`orderShip("${t3}");`);
  assert.equal(run(`S.fleet.filter(s => s.key === "${t3}").length`), 0, "a Tier-3 tanker should be refused at a Tier-2 base Small Shipyard");

  withColonyShipyard(run, 4);
  run(`orderShip("${t3}"); orderShip("${t4}");`);
  assert.equal(run(`S.fleet.filter(s => s.key === "${t3}").length`), 1, "a Tier-3 tanker should build at a Tier-4 colony Shipyard");
  assert.equal(run(`S.fleet.filter(s => s.key === "${t4}").length`), 1, "a Tier-4 tanker should build at a Tier-4 colony Shipyard");
});

test("tankerRunCycles is deterministic, always >= 2, and monotonic in distance and slowness", () => {
  const { run } = createSandbox();
  const a = run(`tankerRunCycles(6, 0.75)`), aAgain = run(`tankerRunCycles(6, 0.75)`);
  assert.equal(a, aAgain, "same inputs should give the same cycle count");
  assert.ok(a >= 2, "a run should always take at least 2 cycles");
  const near = run(`tankerRunCycles(2, 0.75)`), far = run(`tankerRunCycles(20, 0.75)`);
  assert.ok(far > near, "a farther destination should take more cycles");
  const fast = run(`tankerRunCycles(10, 0.9)`), slow = run(`tankerRunCycles(10, 0.3)`);
  assert.ok(slow > fast, "a slower hull should take more cycles over the same distance");
});

test("assignTankerRun refuses a ship that isn't an idle tanker", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), wr = warshipKey(run);
  run(`S = freshState();
       S.fleet = [{ id: "busy", key: "${t1}", name: "Busy", home: S.location, status: "logistics", station: S.location, hull: 30, hullMax: 30 },
                  { id: "notank", key: "${wr}", name: "Not a tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 }];`);
  const destId = knownDest(run);
  run(`assignTankerRun("busy", "${destId}", []);`);
  assert.equal(run(`S.fleet[0].status`), "logistics", "a busy tanker should not be dispatchable");
  run(`assignTankerRun("notank", "${destId}", []);`);
  assert.equal(run(`S.fleet[1].status`), "idle", "a non-tanker hull should be refused");
});

test("assignTankerRun loads fuel from local storage before the hold, sets run state, and assigns escorts", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), wr = warshipKey(run);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 },
                  { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 20, hullMax: 20 }];`);
  const destId = knownDest(run);
  const cap = run(`FLEET_SHIPS["${t1}"].cap`);
  const localBefore = run(`S.colonies[S.location].storage.fuel`);
  run(`assignTankerRun("t1", "${destId}", ["w1"]);`);
  assert.equal(run(`S.fleet[0].status`), "tanker_run", "the tanker should now be running");
  assert.equal(run(`S.fleet[0].run.to`), destId);
  assert.equal(run(`S.fleet[0].run.fuel`), cap, "the tanker should load up to its full cap when local storage covers it");
  assert.equal(run(`S.fleet[0].run.cyclesLeft`), run(`S.fleet[0].run.totalCycles`), "cyclesLeft should start equal to totalCycles");
  assert.equal(run(`S.colonies[S.location].storage.fuel`), localBefore - cap, "fuel should be drawn from local storage first");
  assert.equal(run(`S.fleet[1].status`), "tanker_run", "the escorting warship should also be marked as on the run");
  assert.equal(run(`S.fleet[1].escortFor`), "t1");
});

test("recallTankerRun refunds fuel and frees escorts before the run has ticked, but refuses once it has", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), wr = warshipKey(run);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 },
                  { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 20, hullMax: 20 }];`);
  const destId = knownDest(run);
  run(`assignTankerRun("t1", "${destId}", ["w1"]);`);
  const loaded = run(`S.fleet[0].run.fuel`);
  const storageBefore = run(`S.colonies[S.location].storage.fuel`);
  run(`recallTankerRun("t1");`);
  assert.equal(run(`S.fleet[0].status`), "idle", "recall before any cycle should return the tanker to idle");
  assert.equal(run(`S.fleet[0].run`), null);
  assert.equal(run(`S.colonies[S.location].storage.fuel`), storageBefore + loaded, "recalled fuel should be refunded to local storage");
  assert.equal(run(`S.fleet[1].status`), "idle", "the escort should also be freed");

  run(`assignTankerRun("t1", "${destId}", []);`);
  run(`Math.random = () => 0.99;`); // dodge risk rolls, just tick the clock
  run(`processTankerRuns();`);
  run(`recallTankerRun("t1");`);
  assert.equal(run(`S.fleet[0].status`), "tanker_run", "a run that has already ticked should refuse recall");
});

test("processTankerRuns: pirate risk damages hull and fuel, damped by an escorting warship", () => {
  // unescorted run
  const unescorted = createSandbox();
  const t1 = tankerKeyAt(unescorted.run, 1);
  unescorted.run(`S = freshState(); rollPrices();`);
  withColonyShipyard(unescorted.run, 4);
  unescorted.run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  const destId = knownDest(unescorted.run);
  unescorted.run(`S.pirates = {}; S.pirates["${destId}"] = 5; S.pirates[S.location] = 0;`);
  unescorted.run(`assignTankerRun("t1", "${destId}", []);`);
  const hullBefore = unescorted.run(`S.fleet[0].hull`), fuelBefore = unescorted.run(`S.fleet[0].run.fuel`);
  unescorted.run(`Math.random = () => 0.0;`); // force the ambush chance to trigger with max-severity rolls
  unescorted.run(`processTankerRuns();`);
  const hullAfter = unescorted.run(`S.fleet[0].hull`), fuelAfter = unescorted.run(`S.fleet[0].run.fuel`);
  assert.ok(hullAfter < hullBefore, "an unescorted tanker hit by pirates should take hull damage");
  assert.ok(fuelAfter < fuelBefore, "an unescorted tanker hit by pirates should lose carried fuel");
  const dmgUnescorted = hullBefore - hullAfter, lossUnescorted = fuelBefore - fuelAfter;

  // same forced roll, same route, but with a warship escort — damage/loss should shrink
  const escorted = createSandbox();
  const t1b = tankerKeyAt(escorted.run, 1), wr = warshipKey(escorted.run);
  escorted.run(`S = freshState(); rollPrices();`);
  withColonyShipyard(escorted.run, 4);
  escorted.run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1b}", name: "Tanker", home: S.location, status: "idle", hull: 100, hullMax: 100 },
                  { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 20, hullMax: 20 }];`);
  const destId2 = knownDest(escorted.run);
  escorted.run(`S.pirates = {}; S.pirates["${destId2}"] = 5; S.pirates[S.location] = 0;`);
  escorted.run(`assignTankerRun("t1", "${destId2}", ["w1"]);`);
  const hullBefore2 = escorted.run(`S.fleet[0].hull`), fuelBefore2 = escorted.run(`S.fleet[0].run.fuel`);
  escorted.run(`Math.random = () => 0.0;`);
  escorted.run(`processTankerRuns();`);
  const dmgEscorted = hullBefore2 - escorted.run(`S.fleet[0].hull`), lossEscorted = fuelBefore2 - escorted.run(`S.fleet[0].run.fuel`);
  assert.ok(dmgEscorted < dmgUnescorted, "an escorting warship should reduce pirate damage to the tanker");
  assert.ok(lossEscorted < lossUnescorted, "an escorting warship should reduce fuel lost to pirates");
});

test("processTankerRuns: authority interception only fires once Wanted >= 25, and confiscates cargo without hull damage", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.pirate.wanted = 0;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  const destId = knownDest(run);
  run(`S.pirates = {}; S.pirates["${destId}"] = 0; S.pirates[S.location] = 0;`);
  run(`assignTankerRun("t1", "${destId}", []);`);
  run(`Math.random = () => 0.0;`);
  const fuelBefore = run(`S.fleet[0].run.fuel`);
  run(`processTankerRuns();`);
  assert.equal(run(`S.fleet[0].run.fuel`), fuelBefore, "below the Wanted threshold, interception should not confiscate cargo");
  assert.equal(run(`S.fleet[0].hull`), 100, "interception never damages hull even when Wanted is low (it simply doesn't fire, and piracy is zeroed out here)");

  run(`S.pirate.wanted = 90;`);
  run(`processTankerRuns();`);
  assert.equal(run(`S.fleet[0].run ? S.fleet[0].run.fuel : 0`), 0, "once Wanted, a forced-roll interception should confiscate all carried fuel");
});

test("delivery: fuel tops up a player-owned colony's storage; a foreign destination sells it for credits; ship's home updates", () => {
  // ---- owned destination ----
  const owned = createSandbox();
  const t1 = tankerKeyAt(owned.run, 1);
  owned.run(`S = freshState(); rollPrices();`);
  withColonyShipyard(owned.run, 4);
  owned.run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  const destId = knownDest(owned.run);
  owned.run(`S.colonies["${destId}"] = { pop: 5, happiness: 60, tax: 10, buildings: {}, storage: { fuel: 10 }, orders: {}, unrest: 0, faction: null, idle: {} };
       S.pirates = {}; S.pirates["${destId}"] = 0; S.pirates[S.location] = 0;`);
  owned.run(`assignTankerRun("t1", "${destId}", []);`);
  const cycles = owned.run(`S.fleet[0].run.totalCycles`);
  const loaded = owned.run(`S.fleet[0].run.fuel`);
  owned.run(`Math.random = () => 0.99;`); // dodge risk rolls so the full cargo survives to delivery
  for (let i = 0; i < cycles; i++) owned.run(`processTankerRuns();`);
  assert.equal(owned.run(`S.fleet[0].status`), "idle", "the tanker should be idle again after delivery");
  assert.equal(owned.run(`S.fleet[0].home`), destId, "the tanker's home should update to the delivered-to world");
  assert.equal(owned.run(`S.fleet[0].run`), null);
  assert.equal(owned.run(`S.colonies["${destId}"].storage.fuel`), 10 + loaded, "fuel should top up the owned colony's storage");

  // ---- foreign (non-owned) destination: sold at market instead ----
  const foreign = createSandbox();
  const t1b = tankerKeyAt(foreign.run, 1);
  foreign.run(`S = freshState(); rollPrices();`);
  withColonyShipyard(foreign.run, 4);
  foreign.run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t2", key: "${t1b}", name: "Tanker2", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  const destId2 = knownDest(foreign.run);
  foreign.run(`S.pirates = {}; S.pirates["${destId2}"] = 0; S.pirates[S.location] = 0;`);
  const creditsBefore = foreign.run(`S.res.credits`);
  foreign.run(`assignTankerRun("t2", "${destId2}", []);`);
  const cycles2 = foreign.run(`S.fleet[0].run.totalCycles`);
  foreign.run(`Math.random = () => 0.99;`);
  for (let i = 0; i < cycles2; i++) foreign.run(`processTankerRuns();`);
  assert.equal(foreign.run(`S.fleet[0].status`), "idle");
  assert.equal(foreign.run(`S.fleet[0].home`), destId2);
  assert.ok(foreign.run(`S.res.credits`) > creditsBefore, "selling delivered fuel at a foreign market should pay out credits");
});

test("scrapShip refuses a ship that's on a tanker run", () => {
  const { run, state } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 }];`);
  const destId = knownDest(run);
  run(`assignTankerRun("t1", "${destId}", []);`);
  state.confirmResult = true;
  run(`scrapShip("t1");`);
  assert.equal(run(`S.fleet.length`), 1, "a tanker on a run should not be scrapped");
  assert.equal(state.confirmCalls.length, 0, "the confirm dialog shouldn't even appear for a ship on a tanker run");
});
