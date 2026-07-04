"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function tier1WarshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`); }
function makeFoe(run, overrides) {
  run(`S.prey = Object.assign({ type: "hauler", name: "Test Hauler", ico: "🚚", faction: "core", cargo: {}, credits: 100,
    strength: 20, def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic", bounty: 0, wantedGain: 5, isPirate: false,
    hp: 1000, maxhp: 1000, pack: [], _others: [] }, ${JSON.stringify(overrides || {})});`);
}

test("fleetRaidable returns only patrol-assigned ships at the current location", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  run(`S.fleet = [
    { id: "s1", key: "${wr}", name: "Idle", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "s2", key: "${wr}", name: "HerePatrol", home: S.location, status: "patrol", station: S.location, hull: 50, hullMax: 50 },
    { id: "s3", key: "${wr}", name: "ElsewherePatrol", home: S.location, status: "patrol", station: "some_other_world", hull: 50, hullMax: 50 },
  ];`);
  assert.equal(run(`fleetRaidable().map(s => s.id).join(",")`), "s2");
});

test("assignPatrol refuses a non-warship, and refuses a ship that isn't idle", () => {
  const { run } = createSandbox();
  const fr = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "freighter")`);
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  run(`S.fleet = [
    { id: "f1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "w1", key: "${wr}", name: "Busy", home: S.location, status: "mission", hull: 50, hullMax: 50 },
  ];`);
  run(`assignPatrol("f1", S.location);`);
  assert.equal(run(`S.fleet[0].status`), "idle", "a freighter can't patrol");
  run(`assignPatrol("w1", S.location);`);
  assert.equal(run(`S.fleet[1].status`), "mission", "a ship already on duty can't be reassigned to patrol");
});

test("assignPatrol/recallPatrol set and clear status + station", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  run(`S.fleet = [{ id: "w1", key: "${wr}", name: "Sentry", home: S.location, status: "idle", hull: 50, hullMax: 50 }];`);
  run(`assignPatrol("w1", S.location);`);
  assert.equal(run(`S.fleet[0].status`), "patrol");
  assert.equal(run(`S.fleet[0].station`), run(`S.location`));
  run(`recallPatrol("w1");`);
  assert.equal(run(`S.fleet[0].status`), "idle");
  assert.equal(run(`S.fleet[0].station`), null);
});

test("raidSummonFleet refuses an idle-but-unassigned warship and one patrolling elsewhere; succeeds for one patrolling here", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  makeFoe(run);
  run(`S.fleet = [
    { id: "idle1", key: "${wr}", name: "Idle", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "away1", key: "${wr}", name: "Away", home: S.location, status: "patrol", station: "some_other_world", hull: 50, hullMax: 50 },
    { id: "here1", key: "${wr}", name: "Here", home: S.location, status: "patrol", station: S.location, hull: 50, hullMax: 50 },
  ];`);
  run(`raidSummonFleet("idle1");`);
  assert.equal(run(`(S.allies||[]).length`), 0, "an idle, unassigned warship must not be summonable");
  run(`raidSummonFleet("away1");`);
  assert.equal(run(`(S.allies||[]).length`), 0, "a warship patrolling a different world must not be summonable");
  run(`raidSummonFleet("here1");`);
  assert.equal(run(`(S.allies||[]).length`), 1, "a warship patrolling HERE should join");
  assert.equal(run(`S.allies[0].fleetId`), "here1");
});

test("deployBattleGroup only pools patrol-assigned ships at the current location", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  makeFoe(run);
  run(`S.fleet = [
    { id: "idle1", key: "${wr}", name: "Idle", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "away1", key: "${wr}", name: "Away", home: S.location, status: "patrol", station: "some_other_world", hull: 50, hullMax: 50 },
    { id: "here1", key: "${wr}", name: "Here", home: S.location, status: "patrol", station: S.location, hull: 50, hullMax: 50 },
    { id: "here2", key: "${wr}", name: "Here2", home: S.location, status: "patrol", station: S.location, hull: 50, hullMax: 50 },
  ];`);
  run(`deployBattleGroup();`);
  assert.equal(run(`battleGroupShips().map(s => s.id).sort().join(",")`), "here1,here2");
  assert.equal(run(`S.fleet.find(s => s.id === "idle1").status`), "idle", "the idle, unassigned ship should be untouched");
  assert.equal(run(`S.fleet.find(s => s.id === "away1").status`), "patrol", "the ship patrolling elsewhere should be untouched");
});

test("recallBattleGroup and releaseBattleGroup return a patrol-assigned ship to patrol (not idle), preserving its station", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  makeFoe(run);
  run(`S.fleet = [{ id: "here1", key: "${wr}", name: "Here", home: S.location, status: "patrol", station: S.location, hull: 50, hullMax: 50 }];`);
  run(`deployBattleGroup();`);
  assert.equal(run(`S.fleet[0].status`), "battle");
  run(`recallBattleGroup();`);
  assert.equal(run(`S.fleet[0].status`), "patrol", "recalling a patrol-assigned ship should return it to patrol, not idle");
  assert.equal(run(`S.fleet[0].station`), run(`S.location`), "its station should be preserved");

  run(`deployBattleGroup(); releaseBattleGroup();`);
  assert.equal(run(`S.fleet[0].status`), "patrol", "releaseBattleGroup (engagement-end) should also restore patrol, not idle");
});

test("scrapShip refuses a patrolling ship until recalled", () => {
  const { run, state } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  state.confirmResult = true;
  run(`S.fleet = [{ id: "here1", key: "${wr}", name: "Here", home: S.location, status: "patrol", station: S.location, hull: 50, hullMax: 50 }];`);
  run(`scrapShip("here1");`);
  assert.equal(run(`S.fleet.length`), 1, "a patrolling ship shouldn't be scrappable without a recall first");
  run(`recallPatrol("here1"); scrapShip("here1");`);
  assert.equal(run(`S.fleet.length`), 0, "once recalled, it should scrap normally");
});
