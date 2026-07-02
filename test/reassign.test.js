"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function freighterKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "freighter")`); }
function battleshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 4 && FLEET_SHIPS[k].role === "warship")`); }

function withShipyard(run, tier) {
  run(`S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: { shipyard: ${tier} }, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
}

test("reassignShipyard refuses a ship that isn't idle", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState(); S.res.credits = 100000;`);
  withShipyard(run, 4);
  run(`const otherPid = Object.keys(currentPlanet().distances)[0];
       S.fleet = [{ id: "s1", key: "${fr}", name: "Busy", home: otherPid, status: "mission", hull: 10, hullMax: 10 }];`);
  run(`reassignShipyard("s1");`);
  assert.notEqual(run(`S.fleet[0].home`), run(`S.location`), "a ship on duty should not be reassignable");
});

test("reassignShipyard refuses when the current colony has no shipyard", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState(); S.res.credits = 100000;
       const otherPid = Object.keys(currentPlanet().distances)[0];
       S.fleet = [{ id: "s1", key: "${fr}", name: "Tramp", home: otherPid, status: "idle", hull: 10, hullMax: 10 }];`);
  run(`reassignShipyard("s1");`);
  assert.notEqual(run(`S.fleet[0].home`), run(`S.location`), "no shipyard here means no reassignment");
});

test("reassignShipyard refuses when the local shipyard tier is too low for the ship", () => {
  const { run } = createSandbox();
  const bs = battleshipKey(run);
  run(`S = freshState(); S.res.credits = 100000;`);
  withShipyard(run, 1);
  run(`const otherPid = Object.keys(currentPlanet().distances)[0];
       S.fleet = [{ id: "s1", key: "${bs}", name: "Big Ship", home: otherPid, status: "idle", hull: 10, hullMax: 10 }];`);
  run(`reassignShipyard("s1");`);
  assert.notEqual(run(`S.fleet[0].home`), run(`S.location`), "a Tier 1 shipyard can't service a Tier 4 battleship");
});

test("reassignShipyard refuses a ship already based here", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState(); S.res.credits = 100000;`);
  withShipyard(run, 4);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Local", home: S.location, status: "idle", hull: 10, hullMax: 10 }];`);
  const before = run(`S.res.credits`);
  run(`reassignShipyard("s1");`);
  assert.equal(run(`S.res.credits`), before, "reassigning to the same home port should be a no-op, no fee charged");
});

test("reassignShipyard refuses when the player can't afford the fee", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState(); S.res.credits = 0;`);
  withShipyard(run, 4);
  run(`const otherPid = Object.keys(currentPlanet().distances)[0];
       S.fleet = [{ id: "s1", key: "${fr}", name: "Tramp", home: otherPid, status: "idle", hull: 10, hullMax: 10 }];`);
  run(`reassignShipyard("s1");`);
  assert.notEqual(run(`S.fleet[0].home`), run(`S.location`), "insufficient credits should block the reassignment");
});

test("reassignShipyard succeeds: moves home, deducts the fee, ship stays idle", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  withShipyard(run, 4);
  run(`const otherPid = Object.keys(currentPlanet().distances)[0];
       S.fleet = [{ id: "s1", key: "${fr}", name: "Tramp", home: otherPid, status: "idle", hull: 10, hullMax: 10 }];`);
  const cost = run(`shipyardReassignCost(FLEET_SHIPS["${fr}"])`);
  const before = run(`S.res.credits`);
  run(`reassignShipyard("s1");`);
  assert.equal(run(`S.fleet[0].home`), run(`S.location`), "the ship's home should now be the current colony");
  assert.equal(run(`S.fleet[0].status`), "idle", "reassignment should not change the ship's status");
  assert.equal(run(`S.res.credits`), before - cost, "the reassignment fee should be deducted");
});

test("shipyardReassignCost is 8% of the ship's credit cost, floored at 200", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  const def = JSON.parse(run(`JSON.stringify(FLEET_SHIPS["${fr}"])`));
  const expected = Math.max(200, Math.round(def.cost.credits * 0.08));
  assert.equal(run(`shipyardReassignCost(FLEET_SHIPS["${fr}"])`), expected);
});
