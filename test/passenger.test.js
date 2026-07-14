"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* Passenger liners: a fourth FLEET_SHIPS family that ferries population between worlds.
   Tanky like a warship of the same class (hull scales off SHIP_CLASSES, not cargo cap like a
   freighter/tanker), near-zero firepower, flat half-speed regardless of tier. Boarding sells
   paid tickets (fare revenue) — at one of your own colonies the manifest is drawn from that
   colony's own population; anywhere else it's abstracted as booking passage. Debarking at one
   of your own colonies grows col.pop, housing-capped, same shape the migrant-wave event uses.
   The headline rule: a hull still carrying souls is never actually destroyed by combat damage
   — it's crippled (pinned at 1 hull) and automatically evacuates its passengers instead; only
   an EMPTY passenger hull can be destroyed outright. */

function passengerKey(run, cls) {
  return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "passenger"${cls ? ` && FLEET_SHIPS[k].cls === "${cls}"` : ""})`);
}
function warshipKey(run, cls) {
  return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "warship"${cls ? ` && FLEET_SHIPS[k].cls === "${cls}"` : ""})`);
}
function freshColony(run, pid, overrides) {
  run(`S.colonies["${pid}"] = Object.assign({ pop: 10, happiness: 70, tax: 0, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} }, ${JSON.stringify(overrides || {})});`);
}

test("a passenger hull runs at flat half speed regardless of tier", () => {
  const { run } = createSandbox();
  const keys = run(`Object.keys(FLEET_SHIPS).filter(k => FLEET_SHIPS[k].role === "passenger")`);
  keys.forEach(k => {
    assert.equal(run(`fleetShipSpeed(FLEET_SHIPS["${k}"])`), 0.5, `${k} should run at exactly 0.5x speed`);
  });
});

test("a passenger hull is tanky like a same-class warship, but nearly unarmed", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run, "cruiser");
  const wk = warshipKey(run, "cruiser");
  const passHull = run(`fleetShipHullMax(FLEET_SHIPS["${pk}"])`);
  const warHull = run(`fleetShipHullMax(FLEET_SHIPS["${wk}"])`);
  assert.equal(passHull, warHull, "a passenger liner should share its warship counterpart's hull formula (class-based, not cargo-scaled)");
  const passStr = run(`fleetShipStr(FLEET_SHIPS["${pk}"])`);
  const warStr = run(`fleetShipStr(FLEET_SHIPS["${wk}"])`);
  assert.ok(passStr > 0 && passStr < warStr * 0.2, "a passenger liner's firepower should be a small fraction of a warship's");
});

test("boardPassengers at a player colony draws down col.pop and pays fares", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run, "cruiser");   // Luxury Liner, 5k capacity — room enough for this test's 3k
  run(`S = freshState(); rollPrices();`);
  freshColony(run, run(`S.location`), { pop: 10 });
  run(`S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 100, hullMax: 100 }];
       S.res.credits = 1000;`);
  run(`boardPassengers("p1", 3);`);
  assert.equal(run(`S.colonies[S.location].pop`), 7, "boarding 3k passengers should draw the colony's own population down by 3k");
  assert.equal(run(`S.fleet[0].passengers`), 3, "the liner should now carry the boarded passengers");
  assert.equal(run(`S.res.credits`), 1000 + 3 * run(`PASSENGER_FARE`), "boarding should pay fare revenue per head");
});

test("boardPassengers away from any colony books passage abstractly — no population source needed", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run, "cruiser");
  run(`S = freshState(); rollPrices(); S.colonies = {};`);
  run(`S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 100, hullMax: 100 }];
       S.res.credits = 1000;`);
  run(`boardPassengers("p1", 2);`);
  assert.equal(run(`S.fleet[0].passengers`), 2, "booking passage away from a colony should still load passengers");
  assert.equal(run(`S.res.credits`), 1000 + 2 * run(`PASSENGER_FARE`), "booking passage should still pay fare revenue");
});

test("boardPassengers refuses a ship not riding in the convoy", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run);
  run(`S = freshState(); rollPrices();
       S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "idle", hull: 100, hullMax: 100 }];
       S.res.credits = 1000;`);
  run(`boardPassengers("p1", 2);`);
  assert.equal(run(`S.fleet[0].passengers || 0`), 0, "an idle liner not in the convoy shouldn't be able to board passengers");
});

test("debarkPassengers at a colony grows col.pop, hard-clamped to housing", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run);
  run(`S = freshState(); rollPrices();`);
  freshColony(run, run(`S.location`), { pop: 10 });
  const housing = run(`colonyHousing(S.colonies[S.location], currentPlanet())`);
  run(`S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 100, hullMax: 100, passengers: 999 }];`);
  run(`debarkPassengers("p1", 999);`);
  assert.equal(run(`S.colonies[S.location].pop`), housing, "population delivered past the housing cap should clamp exactly to it");
  assert.equal(run(`S.fleet[0].passengers`), 0, "the liner should be emptied out regardless of the housing clamp");
});

test("debarkPassengers away from a colony just disembarks — no colony effect", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run);
  run(`S = freshState(); rollPrices(); S.colonies = {};
       S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 100, hullMax: 100, passengers: 3 }];`);
  run(`debarkPassengers("p1", 3);`);
  assert.equal(run(`S.fleet[0].passengers`), 0, "passengers should still leave the ship");
});

test("fleetShipHit cripples a passenger hull carrying souls instead of destroying it", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run);
  run(`S = freshState();
       S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 10, hullMax: 100, passengers: 5 }];`);
  const outcome = run(`fleetShipHit(S.fleet[0], 999)`);
  assert.equal(outcome, "crippled", "a lethal hit to a liner carrying passengers should cripple it, not kill it");
  assert.equal(run(`S.fleet[0].hull`), 1, "a crippled hull should be pinned at 1, not removed");
  assert.equal(run(`S.fleet[0].passengers`), 0, "passengers should be automatically evacuated");
  assert.equal(run(`!!S.fleet[0]._dead`), false, "a crippled ship must not be marked dead");
  assert.equal(run(`!!S.fleet[0].crippled`), true, "a crippled ship should be flagged so it can't just take on new passengers and shrug off the next hit");
});

test("fleetShipHit destroys an EMPTY passenger hull normally — the same lethal hit", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run);
  run(`S = freshState();
       S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 10, hullMax: 100, passengers: 0 }];`);
  const outcome = run(`fleetShipHit(S.fleet[0], 999)`);
  assert.equal(outcome, "dead", "an empty passenger hull should be destroyable just like any other hull");
  assert.equal(run(`!!S.fleet[0]._dead`), true, "an empty passenger hull hit lethally should be marked dead");
});

test("fleetShipHit destroys a normal warship exactly as before (no crippling carve-out for non-passenger roles)", () => {
  const { run } = createSandbox();
  const wk = warshipKey(run);
  run(`S = freshState();
       S.fleet = [{ id: "w1", key: "${wk}", name: "Warship", home: S.location, status: "convoy", hull: 10, hullMax: 100 }];`);
  const outcome = run(`fleetShipHit(S.fleet[0], 999)`);
  assert.equal(outcome, "dead", "a warship should still be destroyed normally");
});

test("boardPassengers refuses a crippled liner until it's repaired", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run, "cruiser");
  run(`S = freshState(); rollPrices();`);
  freshColony(run, run(`S.location`), { pop: 10 });
  run(`S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 1, hullMax: 100, crippled: true }];
       S.res.credits = 1000;`);
  run(`boardPassengers("p1", 3);`);
  assert.equal(run(`S.fleet[0].passengers || 0`), 0, "a crippled hulk shouldn't be able to re-board passengers");
  assert.equal(run(`S.colonies[S.location].pop`), 10, "the colony's population shouldn't be drawn down by a refused boarding");
  assert.equal(run(`S.res.credits`), 1000, "a refused boarding shouldn't pay out fares");
});

test("repairFleetShip clears the crippled flag, letting the liner board passengers again", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run, "cruiser");
  run(`S = freshState(); rollPrices(); S.res.credits = 100000; S.res.metals = 1000;`);
  freshColony(run, run(`S.location`), { pop: 10, buildings: { shipyard: 1 } });
  run(`S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 1, hullMax: 100, crippled: true }];`);
  run(`repairFleetShip("p1");`);
  assert.equal(run(`S.fleet[0].hull`), run(`S.fleet[0].hullMax`), "repair should restore full hull");
  assert.equal(run(`!!S.fleet[0].crippled`), false, "repair should clear the crippled flag");
  run(`boardPassengers("p1", 3);`);
  assert.equal(run(`S.fleet[0].passengers`), 3, "a repaired liner should be able to board passengers again");
});

test("convoyAmbushRisk cripples a passenger liner with passengers aboard instead of purging it", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run);
  run(`S = freshState(); S.res.credits = 10000; S.pirate.formation = "reserve";
       S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 5, hullMax: 100, formation: "vanguard", passengers: 4 }];`);
  run(`Math.random = () => 0.5;`);   // front-tier branch — the lone vanguard liner is the front
  run(`convoyAmbushRisk(5);`);
  assert.equal(run(`S.fleet.length`), 1, "a crippled liner should remain in the fleet, not be purged");
  assert.equal(run(`S.fleet[0].hull`), 1, "the liner should be pinned at 1 hull");
  assert.equal(run(`S.fleet[0].passengers`), 0, "its passengers should have been evacuated");
});

test("convoyAmbushRisk destroys an EMPTY passenger liner exactly like any other hull", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run);
  run(`S = freshState(); S.res.credits = 10000; S.pirate.formation = "reserve";
       S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 5, hullMax: 100, formation: "vanguard", passengers: 0 }];`);
  run(`Math.random = () => 0.5;`);
  run(`convoyAmbushRisk(5);`);
  assert.equal(run(`S.fleet.length`), 0, "an empty liner should be destroyed and purged like any other hull");
});

test("convoyPassengerShips filters convoy-status ships down to the passenger role", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run), fr = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "freighter")`);
  run(`S = freshState();
       S.fleet = [
         { id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 10, hullMax: 10 },
         { id: "f1", key: "${fr}", name: "Hauler", home: S.location, status: "convoy", hull: 10, hullMax: 10 },
         { id: "p2", key: "${pk}", name: "Idle Liner", home: S.location, status: "idle", hull: 10, hullMax: 10 }];`);
  const ids = JSON.parse(run(`JSON.stringify(convoyPassengerShips().map(s => s.id))`));
  assert.deepEqual(ids, ["p1"], "only the convoy-status passenger hull should be returned");
});

test("assignConvoy/recallConvoy work for a passenger hull exactly like any other role", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run);
  run(`S = freshState(); rollPrices();
       S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "idle", hull: 10, hullMax: 10 }];`);
  run(`assignConvoy("p1");`);
  assert.equal(run(`S.fleet[0].status`), "convoy", "a passenger hull should be able to join the personal convoy");
  run(`recallConvoy("p1");`);
  assert.equal(run(`S.fleet[0].status`), "idle", "recallConvoy should return it to idle");
});

test("raidSeizeHull on a liner prey yields a passenger fleet ship carrying a damaged fraction of its passengers", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();
       S.prey = { type: "liner", name: "Luxury Liner", ico: "🛳️", faction: "core", cargo: {}, credits: 100,
         strength: 20, def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic", bounty: 0, wantedGain: 5,
         isPirate: false, cls: "cruiser", engines: 0, enginesMax: 2, hp: 100, maxhp: 1000, _engaged: true,
         passengers: 4 };
       S.allies = null;`);
  assert.equal(run(`raidCanSeize()`), true, "sanity check: this prey should be seizable (pinned, 10% hp)");
  run(`raidSeizeHull();`);
  const prize = run(`S.fleet[S.fleet.length - 1]`);
  assert.equal(prize.key, "liner_luxury", "a cruiser-class liner should be seized as a Luxury Liner passenger hull");
  assert.ok(prize.passengers > 0 && prize.passengers <= 4, "some fraction of the original passengers should survive the boarding");
});

test("genPrey attaches a passengers field to liner prey, and only liner prey", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`Math.random = () => 0.01;`);   // bias pool selection toward the front of whatever pool law picks
  const sawLinerPassengers = run(`
    let found = false;
    for (let i = 0; i < 50; i++) {
      const f = genPrey();
      if (f.type === "liner") { found = found || (typeof f.passengers === "number" && f.passengers > 0); }
      else if (f.passengers != null) { throw new Error("non-liner prey should never carry a passengers field"); }
    }
    found;
  `);
  assert.equal(sawLinerPassengers, true, "at least one generated liner should carry a positive passengers count over 50 draws");
});

test("fulfilContract's resettle branch gates on convoy passenger capacity and delivers to colony pop", () => {
  const { run } = createSandbox();
  const pk = passengerKey(run);
  run(`S = freshState(); rollPrices();`);
  const pid = run(`S.location`);
  freshColony(run, pid, { pop: 5 });
  run(`S.contracts = [{ id: "c1", kind: "resettle", faction: "core", planetId: "${pid}", passengers: 3,
         reward: { credits: 500 }, deadline: S.turn + 10, posted: S.turn }];
       S.fleet = [{ id: "p1", key: "${pk}", name: "Liner", home: S.location, status: "convoy", hull: 10, hullMax: 10, passengers: 2 }];
       S.res.credits = 0;`);
  run(`fulfilContract("c1");`);
  assert.equal(run(`S.contracts.length`), 1, "fulfilContract should refuse the resettle contract when convoy capacity is short of what's required");
  assert.equal(run(`S.res.credits`), 0, "no reward should be paid for a refused delivery");

  run(`S.fleet[0].passengers = 3;`);
  run(`fulfilContract("c1");`);
  assert.equal(run(`S.contracts.length`), 0, "a fully-crewed resettle contract should be fulfilled and removed");
  assert.equal(run(`S.res.credits`), 500, "the contract's reward should be paid");
  assert.equal(run(`S.fleet[0].passengers`), 0, "the liner's passengers should be consumed by the delivery");
  assert.equal(run(`S.colonies["${pid}"].pop`), 8, "the destination colony's population should grow by the delivered passenger count");
});

test("buildEscortFleet includes a passenger role entry for a passenger-payload mission", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const fleet = run(`buildEscortFleet({ passengers: 3 })`);
  assert.ok(fleet.some(s => s.role === "passenger"), "a passenger-payload mission's fleet should include a passenger role entry");
  assert.ok(!fleet.some(s => s.role === "freighter"), "a passenger-payload mission shouldn't also carry freighters");
});

test("escortEnemyTurn cripples (never destroys) the passenger role entry, evacuating its passengers", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`e = ensureEscort();
       e.active = true;
       e.mission = { to: S.location, from: S.location, passengers: 3, legsLeft: 1, losses: 0 };
       e.fleet = buildEscortFleet({ passengers: 3 });
       const pass = e.fleet.find(s => s.role === "passenger");
       pass.hull = 1;
       e.wave = { round: 1, foes: [{ hp: 100, maxhp: 100, dmg: 999, dmgMul: 1, role: "raider", intent: e.fleet.indexOf(pass) }] };
       e.posture = "balanced";`);
  run(`escortEnemyTurn();`);
  const pass = run(`e.fleet.find(s => s.role === "passenger")`);
  assert.equal(pass.hull, 1, "the passenger entry should be pinned at 1 hull, not reduced below it");
  assert.equal(pass.alive, true, "the passenger entry should remain 'alive' (crippled, not destroyed)");
  assert.equal(pass.evacuated, true, "the passenger entry should be flagged as evacuated");
});
