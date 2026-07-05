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

test("fleetRaidable returns every following warship, regardless of the player's current location", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  run(`S.fleet = [
    { id: "s1", key: "${wr}", name: "Idle", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "s2", key: "${wr}", name: "Follower", home: S.location, status: "patrol", hull: 50, hullMax: 50 },
  ];`);
  assert.equal(run(`fleetRaidable().map(s => s.id).join(",")`), "s2", "only the following ship is raidable, not the idle one");
  const other = run(`Object.keys(currentPlanet().distances)[0]`);
  run(`S.location = "${other}";`);
  assert.equal(run(`fleetRaidable().map(s => s.id).join(",")`), "s2", "a following ship stays raidable after the player travels elsewhere");
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
  run(`assignPatrol("f1");`);
  assert.equal(run(`S.fleet[0].status`), "idle", "a freighter can't follow");
  run(`assignPatrol("w1");`);
  assert.equal(run(`S.fleet[1].status`), "mission", "a ship already on duty can't be reassigned to follow");
});

test("assignPatrol/recallPatrol set and clear status, and never set a station", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  run(`S.fleet = [{ id: "w1", key: "${wr}", name: "Sentry", home: S.location, status: "idle", hull: 50, hullMax: 50 }];`);
  run(`assignPatrol("w1");`);
  assert.equal(run(`S.fleet[0].status`), "patrol");
  assert.equal(run(`S.fleet[0].station`), null, "a following ship isn't pinned to any world");
  run(`recallPatrol("w1");`);
  assert.equal(run(`S.fleet[0].status`), "idle");
  assert.equal(run(`S.fleet[0].station`), null);
});

test("raidSummonFleet refuses an idle-but-unassigned warship; succeeds for a following one no matter where the player is", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  const other = run(`Object.keys(currentPlanet().distances)[0]`);
  run(`S.location = "${other}";`);   // the player has already traveled away from wherever this ship was assigned
  makeFoe(run);
  run(`S.fleet = [
    { id: "idle1", key: "${wr}", name: "Idle", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "here1", key: "${wr}", name: "Follower", home: S.location, status: "patrol", hull: 50, hullMax: 50 },
  ];`);
  run(`raidSummonFleet("idle1");`);
  assert.equal(run(`(S.allies||[]).length`), 0, "an idle, unassigned warship must not be summonable");
  run(`raidSummonFleet("here1");`);
  assert.equal(run(`(S.allies||[]).length`), 1, "a following warship should join wherever the player is");
  assert.equal(run(`S.allies[0].fleetId`), "here1");
});

test("deployBattleGroup pools every following ship, leaving idle ones untouched", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  makeFoe(run);
  run(`S.fleet = [
    { id: "idle1", key: "${wr}", name: "Idle", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "here1", key: "${wr}", name: "Follower1", home: S.location, status: "patrol", hull: 50, hullMax: 50 },
    { id: "here2", key: "${wr}", name: "Follower2", home: S.location, status: "patrol", hull: 50, hullMax: 50 },
  ];`);
  run(`deployBattleGroup();`);
  assert.equal(run(`battleGroupShips().map(s => s.id).sort().join(",")`), "here1,here2");
  assert.equal(run(`S.fleet.find(s => s.id === "idle1").status`), "idle", "the idle, unassigned ship should be untouched");
});

test("recallBattleGroup and releaseBattleGroup return a following ship to following (not idle)", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  makeFoe(run);
  run(`S.fleet = [{ id: "here1", key: "${wr}", name: "Follower", home: S.location, status: "patrol", hull: 50, hullMax: 50 }];`);
  run(`deployBattleGroup();`);
  assert.equal(run(`S.fleet[0].status`), "battle");
  run(`recallBattleGroup();`);
  assert.equal(run(`S.fleet[0].status`), "patrol", "recalling a following ship should return it to following, not idle");

  run(`deployBattleGroup(); releaseBattleGroup();`);
  assert.equal(run(`S.fleet[0].status`), "patrol", "releaseBattleGroup (engagement-end) should also restore following, not idle");
});

test("scrapShip refuses a following ship until recalled", () => {
  const { run, state } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  state.confirmResult = true;
  run(`S.fleet = [{ id: "here1", key: "${wr}", name: "Follower", home: S.location, status: "patrol", hull: 50, hullMax: 50 }];`);
  run(`scrapShip("here1");`);
  assert.equal(run(`S.fleet.length`), 1, "a following ship shouldn't be scrappable without a recall first");
  run(`recallPatrol("here1"); scrapShip("here1");`);
  assert.equal(run(`S.fleet.length`), 0, "once recalled, it should scrap normally");
});
