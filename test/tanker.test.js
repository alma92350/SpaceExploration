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

test("fleetShipSpeed defaults to 1 for any hull without a speed field (warships unaffected)", () => {
  const { run } = createSandbox();
  const wr = warshipKey(run);
  assert.equal(run(`fleetShipSpeed(FLEET_SHIPS["${wr}"])`), 1);
  const t1 = tankerKeyAt(run, 1);
  assert.ok(run(`fleetShipSpeed(FLEET_SHIPS["${t1}"])`) < 1, "a tanker should be slower than full speed");
});

test("freighters run exactly twice as fast as their comparable tanker tier", () => {
  const { run } = createSandbox();
  const frKeys = run(`Object.keys(FLEET_SHIPS).filter(k => FLEET_SHIPS[k].role === "freighter")`);
  assert.equal(frKeys.length, 4, "there should be exactly 4 freighter hulls");
  frKeys.forEach(k => {
    const tier = run(`FLEET_SHIPS["${k}"].tier`);
    const tk = tankerKeyAt(run, tier);
    const frSpeed = run(`fleetShipSpeed(FLEET_SHIPS["${k}"])`);
    const tkSpeed = run(`fleetShipSpeed(FLEET_SHIPS["${tk}"])`);
    assert.ok(Math.abs(frSpeed - tkSpeed * 2) < 1e-9, `tier ${tier} freighter should be exactly 2x its comparable tanker's speed`);
  });
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

test("assignTankerRun carries exactly what's pre-loaded aboard (via loadTanker), sets run state, and assigns escorts", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), wr = warshipKey(run);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 },
                  { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 20, hullMax: 20 }];`);
  const destId = knownDest(run);
  const cap = run(`FLEET_SHIPS["${t1}"].cap`);
  run(`loadTanker("t1");`); // stages the tanker to its full cap ahead of dispatch — assignTankerRun itself no longer auto-loads
  const localBefore = run(`S.colonies[S.location].storage.fuel`);
  run(`assignTankerRun("t1", "${destId}", ["w1"]);`);
  assert.equal(run(`S.fleet[0].status`), "tanker_run", "the tanker should now be running");
  assert.equal(run(`S.fleet[0].run.to`), destId);
  assert.equal(run(`S.fleet[0].run.fuel`), cap, "the run should carry exactly what was pre-loaded aboard");
  assert.equal(run(`S.fleet[0].run.cyclesLeft`), run(`S.fleet[0].run.totalCycles`), "cyclesLeft should start equal to totalCycles");
  assert.equal(run(`S.colonies[S.location].storage.fuel`), localBefore, "dispatch itself should not draw any further fuel from local storage");
  assert.equal(run(`S.fleet[1].status`), "tanker_run", "the escorting warship should also be marked as on the run");
  assert.equal(run(`S.fleet[1].escortFor`), "t1");
});

test("assignTankerRun never draws from local storage on its own — a tanker dispatched without being loaded first carries zero fuel", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 }];`);
  const destId = knownDest(run);
  run(`assignTankerRun("t1", "${destId}", []);`);
  assert.equal(run(`S.fleet[0].run.fuel`), 0, "with nothing manually loaded, the run should carry zero fuel");
  assert.equal(run(`S.colonies[S.location].storage.fuel`), 500, "colony storage should be completely untouched by dispatch");
});

test("recallTankerRun restores fuel aboard the ship and frees escorts before the run has ticked, but refuses once it has", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), wr = warshipKey(run);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 },
                  { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 20, hullMax: 20 }];`);
  const destId = knownDest(run);
  run(`loadTanker("t1");`);
  run(`assignTankerRun("t1", "${destId}", ["w1"]);`);
  const loaded = run(`S.fleet[0].run.fuel`);
  const storageBefore = run(`S.colonies[S.location].storage.fuel`);
  run(`recallTankerRun("t1");`);
  assert.equal(run(`S.fleet[0].status`), "idle", "recall before any cycle should return the tanker to idle");
  assert.equal(run(`S.fleet[0].run`), null);
  assert.equal(run(`S.fleet[0].fuel`), loaded, "the recalled cargo should stay aboard the ship (it never left port), not go back to storage");
  assert.equal(run(`S.colonies[S.location].storage.fuel`), storageBefore, "local storage should be untouched by a recall — the fuel never left the ship");
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
  unescorted.run(`loadTanker("t1"); assignTankerRun("t1", "${destId}", []);`);
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
  escorted.run(`loadTanker("t1"); assignTankerRun("t1", "${destId2}", ["w1"]);`);
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
  run(`loadTanker("t1"); assignTankerRun("t1", "${destId}", []);`);
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
  owned.run(`loadTanker("t1"); assignTankerRun("t1", "${destId}", []);`);
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
  foreign.run(`loadTanker("t2"); assignTankerRun("t2", "${destId2}", []);`);
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

test("loadTanker draws from the base first, then the colony, up to the tanker's own cargo cap", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();`);
  run(`S.bases[S.location] = { modules: {}, storage: { fuel: 30 }, trade: { on: false, exp: {}, imp: {}, cols: {} } };
       S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: {}, storage: { fuel: 500 }, orders: {}, unrest: 0, faction: null, idle: {} };
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30, fuel: 0 }];`);
  const cap = run(`FLEET_SHIPS["${t1}"].cap`);
  run(`loadTanker("t1");`);
  assert.equal(run(`S.bases[S.location].storage.fuel`), 0, "the base's fuel (30, less than the cap) should be drained first");
  assert.equal(run(`S.fleet[0].fuel`), cap, "the tanker should top off from the colony for the remainder, up to its own cap");
  assert.equal(run(`S.colonies[S.location].storage.fuel`), 500 - (cap - 30), "the colony should only be drawn on for what the base couldn't cover");
});

test("loadTanker refuses when not idle/docked here, or when there's nothing to load", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();`);
  run(`S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: {}, storage: { fuel: 500 }, orders: {}, unrest: 0, faction: null, idle: {} };
       const otherPid = Object.keys(currentPlanet().distances)[0];
       S.fleet = [{ id: "away", key: "${t1}", name: "Away", home: otherPid, status: "idle", hull: 30, hullMax: 30, fuel: 0 },
                  { id: "busy", key: "${t1}", name: "Busy", home: S.location, status: "tanker_run", hull: 30, hullMax: 30, fuel: 0, run: { to: otherPid, dist: 5, totalCycles: 3, cyclesLeft: 3, fuel: 10, escorts: [] } }];`);
  run(`loadTanker("away"); loadTanker("busy");`);
  assert.equal(run(`S.fleet[0].fuel`), 0, "a tanker docked elsewhere shouldn't be loadable from here");
  assert.equal(run(`S.fleet[1].fuel`), 0, "a tanker mid-run shouldn't be loadable");
  assert.equal(run(`S.colonies[S.location].storage.fuel`), 500, "nothing should have been drawn from storage");

  run(`S.colonies[S.location].storage.fuel = 0;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30, fuel: 0 }];`);
  run(`loadTanker("t1");`);
  assert.equal(run(`S.fleet[0].fuel`), 0, "with no fuel anywhere here, loading should be a no-op");
});

test("unloadTanker fills the player's own tank first, then the base, then the colony, then sells the rest", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();`);
  // pin every capacity so the test can predict exactly how much reaches each step: the player's
  // tank has 60 room (40 -> fuelCap 100), the base has 20 room (200 cap, 180 already used by
  // other cargo), the colony has 20 room (300 cap, 280 already used) — 100 total before selling.
  run(`S.res.fuel = 40;
       S.bases[S.location] = { modules: {}, storage: { metals: 180 }, trade: { on: false, exp: {}, imp: {}, cols: {} } };
       S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: {}, storage: { metals: 280 }, orders: {}, unrest: 0, faction: null, idle: {} };
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30, fuel: 150 }];`);
  const baseCap = run(`baseStorageCap(S.location)`), baseUsed = run(`baseStorageUsed(S.bases[S.location])`);
  const colCap = run(`colonyStorageCap(S.colonies[S.location], currentPlanet())`), colUsed = run(`colonyStorageUsed(S.colonies[S.location])`);
  const baseRoom = baseCap - baseUsed, colRoom = colCap - colUsed;
  const creditsBefore = run(`S.res.credits`);
  run(`unloadTanker("t1");`);
  assert.equal(run(`S.res.fuel`), 100, "the player's own tank should fill to its cap first (40 -> 100, taking 60)");
  assert.equal(run(`S.bases[S.location].storage.fuel`), baseRoom, "the base should then fill up to its remaining room");
  assert.equal(run(`S.colonies[S.location].storage.fuel`), colRoom, "the colony should then fill up to its remaining room with whatever's left");
  const remaining = 150 - 60 - baseRoom - colRoom;
  assert.ok(remaining > 0, "test setup should leave a remainder to sell — otherwise this isn't exercising the sell step");
  assert.ok(run(`S.res.credits`) > creditsBefore, "any fuel left after topping off the tank/base/colony should be sold for credits");
  assert.equal(run(`S.fleet[0].fuel`), 0, "the tanker should end up fully unloaded");
});

test("unloadTanker refuses when not idle/docked here, or when carrying nothing", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();
       const otherPid = Object.keys(currentPlanet().distances)[0];
       S.fleet = [{ id: "away", key: "${t1}", name: "Away", home: otherPid, status: "idle", hull: 30, hullMax: 30, fuel: 50 },
                  { id: "empty", key: "${t1}", name: "Empty", home: S.location, status: "idle", hull: 30, hullMax: 30, fuel: 0 }];`);
  const creditsBefore = run(`S.res.credits`);
  run(`unloadTanker("away"); unloadTanker("empty");`);
  assert.equal(run(`S.fleet[0].fuel`), 50, "a tanker docked elsewhere shouldn't be unloadable from here");
  assert.equal(run(`S.fleet[1].fuel`), 0, "an already-empty tanker has nothing to unload");
  assert.equal(run(`S.res.credits`), creditsBefore, "no credits should change when nothing was unloaded");
});

test("assignTankerRun dispatches with exactly a partial pre-load, WITHOUT topping it up from local storage", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30, fuel: 0 }];`);
  const cap = run(`FLEET_SHIPS["${t1}"].cap`);
  const preload = Math.floor(cap / 2);
  run(`S.fleet[0].fuel = ${preload};
       S.colonies[S.location].storage.fuel = 500;`);   // reset local storage after the manual preload above
  const localBefore = run(`S.colonies[S.location].storage.fuel`);
  const destId = knownDest(run);
  run(`assignTankerRun("t1", "${destId}", []);`);
  assert.equal(run(`S.fleet[0].run.fuel`), preload, "the run should carry exactly the partial amount pre-loaded, not the tanker's full cap");
  assert.equal(run(`S.colonies[S.location].storage.fuel`), localBefore, "dispatch should not draw anything further from local storage, even though there's plenty of room left aboard");
  assert.equal(run(`S.fleet[0].fuel`), 0, "the ship's own fuel field should be rolled into the run and cleared");
});

test("reinforceTankerRun adds a same-home idle warship to an active run's escorts", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), wr = warshipKey(run);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.pirates = {};
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 },
                  { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 40, hullMax: 40 }];`);
  const destId = knownDest(run);
  run(`assignTankerRun("t1", "${destId}", []);`);
  assert.equal(run(`tankerRunGuards(S.fleet[0])`), 0, "no escorts assigned yet");
  run(`reinforceTankerRun("t1", "w1");`);
  assert.equal(run(`S.fleet[1].status`), "tanker_run", "the warship should now be on the run");
  assert.equal(run(`S.fleet[1].escortFor`), "t1");
  assert.equal(run(`S.fleet[0].run.escorts.includes("w1")`), true, "the run's own escort list should include the reinforcement");
  assert.equal(run(`tankerRunGuards(S.fleet[0])`), 1, "the reinforcement should count toward the run's live guard count");
});

test("reinforceTankerRun refuses a warship docked at a different home port, or one that isn't idle/a warship", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), wr = warshipKey(run), fr = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "freighter")`);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.pirates = {};`);
  const destId = knownDest(run);
  run(`S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 },
                  { id: "away", key: "${wr}", name: "Away Guard", home: "${destId}", status: "idle", hull: 40, hullMax: 40 },
                  { id: "busy", key: "${wr}", name: "Busy Guard", home: S.location, status: "logistics", station: S.location, hull: 40, hullMax: 40 },
                  { id: "hauler", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 10, hullMax: 10 }];`);
  run(`assignTankerRun("t1", "${destId}", []);`);
  run(`reinforceTankerRun("t1", "away"); reinforceTankerRun("t1", "busy"); reinforceTankerRun("t1", "hauler");`);
  assert.equal(run(`tankerRunGuards(S.fleet[0])`), 0, "none of a wrong-home, busy, or non-warship ship should be able to reinforce");
  assert.equal(run(`S.fleet.find(s => s.id === "away").status`), "idle", "the away warship should be untouched");
});

test("reinforceTankerRun refuses when the target tanker isn't actually on a run", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), wr = warshipKey(run);
  run(`S = freshState();
       S.fleet = [{ id: "t1", key: "${t1}", name: "Idle Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 },
                  { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 40, hullMax: 40 }];`);
  run(`reinforceTankerRun("t1", "w1");`);
  assert.equal(run(`S.fleet[1].status`), "idle", "reinforcing a tanker that isn't on a run should be refused");
});

test("a reinforcement added mid-run dampens pirate-ambush damage the same as an escort assigned at dispatch", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), wr = warshipKey(run);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 100, hullMax: 100 },
                  { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 40, hullMax: 40 }];`);
  const destId = knownDest(run);
  run(`S.pirates = {}; S.pirates["${destId}"] = 5; S.pirates[S.location] = 0;`);
  run(`loadTanker("t1"); assignTankerRun("t1", "${destId}", []);`);
  run(`reinforceTankerRun("t1", "w1");`);
  const hullBefore = run(`S.fleet[0].hull`), fuelBefore = run(`S.fleet[0].run.fuel`);
  run(`Math.random = () => 0.0;`);
  run(`processTankerRuns();`);
  const dmg = hullBefore - run(`S.fleet[0].hull`), loss = fuelBefore - run(`S.fleet[0].run.fuel`);
  // same forced roll, same lvl, zero guards this time — should hurt strictly more. A fresh
  // sandbox re-rolls its own starting location (pickStart), so its own destination must be
  // recomputed here too rather than reusing the first sandbox's destId.
  const unguarded = createSandbox();
  const t1b = tankerKeyAt(unguarded.run, 1);
  unguarded.run(`S = freshState(); rollPrices();`);
  withColonyShipyard(unguarded.run, 4);
  const destId2 = knownDest(unguarded.run);
  unguarded.run(`S.colonies[S.location].storage.fuel = 500;
       S.pirates = {}; S.pirates["${destId2}"] = 5; S.pirates[S.location] = 0;
       S.fleet = [{ id: "t1", key: "${t1b}", name: "Tanker", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  unguarded.run(`loadTanker("t1"); assignTankerRun("t1", "${destId2}", []);`);
  const hullBefore2 = unguarded.run(`S.fleet[0].hull`), fuelBefore2 = unguarded.run(`S.fleet[0].run.fuel`);
  unguarded.run(`Math.random = () => 0.0;`);
  unguarded.run(`processTankerRuns();`);
  const dmgUnguarded = hullBefore2 - unguarded.run(`S.fleet[0].hull`), lossUnguarded = fuelBefore2 - unguarded.run(`S.fleet[0].run.fuel`);
  assert.ok(dmg < dmgUnguarded, "a mid-run reinforcement should reduce pirate damage just like a dispatch-time escort");
  assert.ok(loss < lossUnguarded, "a mid-run reinforcement should reduce fuel lost to pirates");
});

test("a reinforcement escort is freed and relocated on delivery just like an original escort", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1), wr = warshipKey(run);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 500;
       S.pirates = {};
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30 },
                  { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 40, hullMax: 40 }];`);
  const destId = knownDest(run);
  run(`S.pirates["${destId}"] = 0; S.pirates[S.location] = 0;`);
  run(`assignTankerRun("t1", "${destId}", []);`);
  run(`reinforceTankerRun("t1", "w1");`);
  run(`Math.random = () => 0.99;`);
  const cycles = run(`S.fleet[0].run.totalCycles`);
  for (let i = 0; i < cycles; i++) run(`processTankerRuns();`);
  assert.equal(run(`S.fleet[1].status`), "idle", "the reinforcement should be freed once the run delivers");
  assert.equal(run(`S.fleet[1].escortFor`), null);
  assert.equal(run(`S.fleet[1].home`), destId, "the reinforcement should end up at the delivered-to world alongside the tanker");
});

test("assignTankerRun allows dispatching a tanker with no fuel available anywhere", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30, fuel: 0 }];
       S.res.fuel = 0;`);
  const destId = knownDest(run);
  run(`assignTankerRun("t1", "${destId}", []);`);
  assert.equal(run(`S.fleet[0].status`), "tanker_run", "an empty tanker should still be dispatchable");
  assert.equal(run(`S.fleet[0].run.fuel`), 0, "the run should carry zero fuel");
  assert.equal(run(`S.fleet[0].run.to`), destId);
});

test("an empty tanker run delivers without touching storage or credits at either an owned or a foreign world", () => {
  const owned = createSandbox();
  const t1 = tankerKeyAt(owned.run, 1);
  owned.run(`S = freshState(); rollPrices();
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30, fuel: 0 }];
       S.res.fuel = 0;`);
  const destId = knownDest(owned.run);
  owned.run(`S.colonies["${destId}"] = { pop: 5, happiness: 60, tax: 10, buildings: {}, storage: { fuel: 10 }, orders: {}, unrest: 0, faction: null, idle: {} };
       S.pirates = {}; S.pirates["${destId}"] = 0; S.pirates[S.location] = 0;`);
  owned.run(`assignTankerRun("t1", "${destId}", []);`);
  const cycles = owned.run(`S.fleet[0].run.totalCycles`);
  owned.run(`Math.random = () => 0.99;`);
  for (let i = 0; i < cycles; i++) owned.run(`processTankerRuns();`);
  assert.equal(owned.run(`S.fleet[0].status`), "idle", "the empty tanker should still finish its run and go idle");
  assert.equal(owned.run(`S.fleet[0].home`), destId, "its home should still update to the delivered-to world");
  assert.equal(owned.run(`S.colonies["${destId}"].storage.fuel`), 10, "an owned destination's storage should be untouched by an empty delivery");

  const foreign = createSandbox();
  const t1b = tankerKeyAt(foreign.run, 1);
  foreign.run(`S = freshState(); rollPrices();
       S.fleet = [{ id: "t1", key: "${t1b}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30, fuel: 0 }];
       S.res.fuel = 0;`);
  const destId2 = knownDest(foreign.run);
  foreign.run(`S.pirates = {}; S.pirates["${destId2}"] = 0; S.pirates[S.location] = 0;`);
  const creditsBefore = foreign.run(`S.res.credits`);
  foreign.run(`assignTankerRun("t1", "${destId2}", []);`);
  const cycles2 = foreign.run(`S.fleet[0].run.totalCycles`);
  foreign.run(`Math.random = () => 0.99;`);
  for (let i = 0; i < cycles2; i++) foreign.run(`processTankerRuns();`);
  assert.equal(foreign.run(`S.fleet[0].status`), "idle");
  assert.equal(foreign.run(`S.res.credits`), creditsBefore, "delivering nothing to a foreign market shouldn't pay out any credits");
});

test("loadTanker(shipId, qty) loads exactly the requested amount, clamped to available room and local fuel", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();`);
  run(`S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: {}, storage: { fuel: 500 }, orders: {}, unrest: 0, faction: null, idle: {} };
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30, fuel: 0 }];`);
  run(`loadTanker("t1", 25);`);
  assert.equal(run(`S.fleet[0].fuel`), 25, "loading a specific quantity should load exactly that much");
  assert.equal(run(`S.colonies[S.location].storage.fuel`), 475, "only the requested amount should be drawn from storage");

  const cap = run(`FLEET_SHIPS["${t1}"].cap`);
  run(`loadTanker("t1", ${cap + 1000});`);
  assert.equal(run(`S.fleet[0].fuel`), cap, "a quantity beyond the tanker's remaining room should clamp to the cap");

  run(`S.fleet[0].fuel = 0; S.colonies[S.location].storage.fuel = 10;`);
  run(`loadTanker("t1", 999);`);
  assert.equal(run(`S.fleet[0].fuel`), 10, "a quantity beyond what's available locally should clamp to what's actually there");
});

test("unloadTanker(shipId, qty) unloads exactly the requested amount, leaving the remainder aboard", () => {
  const { run } = createSandbox();
  const t1 = tankerKeyAt(run, 1);
  run(`S = freshState(); rollPrices();
       S.res.fuel = 0;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker", home: S.location, status: "idle", hull: 30, hullMax: 30, fuel: 100 }];`);
  run(`unloadTanker("t1", 30);`);
  assert.equal(run(`S.fleet[0].fuel`), 70, "only the requested amount should leave the tanker");
  assert.equal(run(`S.res.fuel`), 30, "the requested amount should land in the player's own tank first");

  run(`unloadTanker("t1", 9999);`);
  assert.equal(run(`S.fleet[0].fuel`), 0, "a quantity beyond what's carried should clamp to the full remaining amount");
});
