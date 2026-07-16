"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* fleetShipUpkeep's base rate is the operation cost — full price for a ship on active duty
   (mission/escort/logistics/tanker_run/battle/convoy/patrol). An idle, docked hull now costs
   70% less to maintain, and a raid in progress (S.prey) tacks a 30% surcharge onto every
   operating hull, personal convoy and following-me ("patrol") duty included. */

function tier1WarshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`); }

test("fleetShipUpkeep charges an idle ship 70% less than the same hull on active duty", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  const base = run(`fleetShipUpkeep(FLEET_SHIPS["${wr}"])`);
  const idleShip = run(`({ id: "a", key: "${wr}", status: "idle" })`);
  const convoyShip = run(`({ id: "b", key: "${wr}", status: "convoy" })`);
  const patrolShip = run(`({ id: "c", key: "${wr}", status: "patrol" })`);
  run(`S.fleet = [${JSON.stringify(idleShip)}, ${JSON.stringify(convoyShip)}, ${JSON.stringify(patrolShip)}]; S.prey = null;`);
  const idleUp = run(`fleetShipUpkeep(FLEET_SHIPS["${wr}"], S.fleet[0])`);
  const convoyUp = run(`fleetShipUpkeep(FLEET_SHIPS["${wr}"], S.fleet[1])`);
  const patrolUp = run(`fleetShipUpkeep(FLEET_SHIPS["${wr}"], S.fleet[2])`);
  assert.equal(convoyUp, base, "personal convoy duty pays the full operation cost");
  assert.equal(patrolUp, base, "following-me (patrol) duty pays the full operation cost");
  assert.equal(idleUp, Math.round(base * 0.30), "an idle hull should cost 70% less than the operation rate");
});

test("fleetShipUpkeep adds a 30% raid surcharge to operating hulls, including personal convoy and following-me duty, but spares idle hulls", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  const base = run(`fleetShipUpkeep(FLEET_SHIPS["${wr}"])`);
  run(`S.fleet = [
    { id: "a", key: "${wr}", status: "idle" },
    { id: "b", key: "${wr}", status: "convoy" },
    { id: "c", key: "${wr}", status: "patrol" },
  ]; S.prey = { name: "Some Prey" };`);
  const idleUp = run(`fleetShipUpkeep(FLEET_SHIPS["${wr}"], S.fleet[0])`);
  const convoyUp = run(`fleetShipUpkeep(FLEET_SHIPS["${wr}"], S.fleet[1])`);
  const patrolUp = run(`fleetShipUpkeep(FLEET_SHIPS["${wr}"], S.fleet[2])`);
  assert.equal(convoyUp, Math.round(base * 1.30), "an active raid should surcharge personal convoy duty by 30%");
  assert.equal(patrolUp, Math.round(base * 1.30), "an active raid should surcharge following-me duty by 30%");
  assert.equal(idleUp, Math.round(base * 0.30), "an idle hull keeps its idle discount even during a raid");
});

test("fleetUpkeep sums the per-ship rate, reflecting idle discounts and raid surcharges fleet-wide", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  const base = run(`fleetShipUpkeep(FLEET_SHIPS["${wr}"])`);
  run(`S.fleet = [
    { id: "a", key: "${wr}", status: "idle" },
    { id: "b", key: "${wr}", status: "convoy" },
  ]; S.prey = null;`);
  assert.equal(run(`fleetUpkeep()`), Math.round(base * 0.30) + base, "no-raid total is idle-discount + full operation cost");
  run(`S.prey = { name: "Some Prey" };`);
  assert.equal(run(`fleetUpkeep()`), Math.round(base * 0.30) + Math.round(base * 1.30), "raid total keeps the idle discount but surcharges the convoy ship");
});
