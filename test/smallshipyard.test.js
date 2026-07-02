"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function tier1WarshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`); }
function tier2WarshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 2 && FLEET_SHIPS[k].role === "warship")`); }
function tier3WarshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 3 && FLEET_SHIPS[k].role === "warship")`); }
function tier1FreighterKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "freighter")`); }

function withColonyShipyard(run, tier) {
  run(`S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: { shipyard: ${tier} }, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
}
function withBaseShipyard(run, tier) {
  run(`S.bases[S.location] = { modules: { shipyard_small: ${tier} }, storage: {}, trade: { on: false, exp: {}, imp: {}, cols: {} } };`);
}

test("shipyardTierAt reads a base's Small Shipyard module when there's no colony", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`shipyardTierAt(S.location)`), 0, "no colony, no base — no shipyard");
  withBaseShipyard(run, 1);
  assert.equal(run(`shipyardTierAt(S.location)`), 1);
  assert.equal(run(`shipyardVenueAt(S.location)`), "base");
});

test("a colony Shipyard takes precedence over a same-world base Small Shipyard", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  withBaseShipyard(run, 1);
  withColonyShipyard(run, 4);
  assert.equal(run(`shipyardTierAt(S.location)`), 4, "the colony's full-range shipyard tier should win, not a blend");
  assert.equal(run(`shipyardVenueAt(S.location)`), "colony");
});

test("orderShip succeeds for a tier-1 hull at a tier-1 base Small Shipyard", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  withBaseShipyard(run, 1);
  run(`Object.keys(FLEET_SHIPS["${fr}"].cost).forEach(k => { if (k !== "credits") S.res[k] = 1000; });`);
  run(`orderShip("${fr}");`);
  assert.equal(run(`S.fleet.length`), 1, "a tier-1 freighter should be buildable at a tier-1 Small Shipyard");
  assert.equal(run(`S.fleet[0].home`), run(`S.location`));
});

test("orderShip refuses a tier-2 hull at a tier-1 base Small Shipyard", () => {
  const { run } = createSandbox();
  const wr2 = tier2WarshipKey(run);
  run(`S = freshState(); S.res.credits = 100000;`);
  withBaseShipyard(run, 1);
  run(`Object.keys(FLEET_SHIPS["${wr2}"].cost).forEach(k => { if (k !== "credits") S.res[k] = 1000; });`);
  run(`orderShip("${wr2}");`);
  assert.equal(run(`S.fleet.length`), 0, "a tier-2 warship should not be buildable at a tier-1 Small Shipyard");
});

test("orderShip succeeds for a tier-2 hull once the base Small Shipyard is upgraded", () => {
  const { run } = createSandbox();
  const wr2 = tier2WarshipKey(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  withBaseShipyard(run, 2);
  run(`Object.keys(FLEET_SHIPS["${wr2}"].cost).forEach(k => { if (k !== "credits") S.res[k] = 1000; });`);
  run(`orderShip("${wr2}");`);
  assert.equal(run(`S.fleet.length`), 1, "a tier-2 warship should be buildable at a tier-2 Small Shipyard");
});

test("orderShip refuses a tier-3 hull even at the base Small Shipyard's max tier", () => {
  const { run } = createSandbox();
  const wr3 = tier3WarshipKey(run);
  run(`S = freshState(); S.res.credits = 1000000;`);
  withBaseShipyard(run, 2);   // shipyard_small caps at tiers:2 — this is its maximum
  run(`Object.keys(FLEET_SHIPS["${wr3}"].cost).forEach(k => { if (k !== "credits") S.res[k] = 1000; });`);
  run(`orderShip("${wr3}");`);
  assert.equal(run(`S.fleet.length`), 0, "a Small Shipyard should never lay down a tier-3+ hull, no matter its own tier");
});

test("orderShip refuses when neither a colony nor a base shipyard exists here", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); S.res.credits = 100000;
       Object.keys(FLEET_SHIPS["${fr}"].cost).forEach(k => { if (k !== "credits") S.res[k] = 1000; });`);
  run(`orderShip("${fr}");`);
  assert.equal(run(`S.fleet.length`), 0);
});

test("buildModule('shipyard_small') deducts cost/materials and is capped at tier 2", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 100000; S.res.metals = 1000; S.res.electronics = 1000;
       S.bases[S.location] = { modules: {}, storage: {}, trade: { on: false, exp: {}, imp: {}, cols: {} } };`);
  run(`buildModule("shipyard_small");`);
  assert.equal(run(`S.bases[S.location].modules.shipyard_small`), 1, "first build should land at tier 1");
  run(`buildModule("shipyard_small");`);
  assert.equal(run(`S.bases[S.location].modules.shipyard_small`), 2, "second build should land at tier 2");
  run(`buildModule("shipyard_small");`);
  assert.equal(run(`S.bases[S.location].modules.shipyard_small`), 2, "a third build attempt should be refused — tier 2 is the module's max");
});

test("repairFleetShip and reassignShipyard both work with a base as the home venue", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 100000; S.res.metals = 1000;`);
  withBaseShipyard(run, 1);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Outpost Hauler", home: S.location, status: "idle", hull: 10, hullMax: 100 }];`);
  run(`repairFleetShip("s1");`);
  assert.equal(run(`S.fleet[0].hull`), run(`S.fleet[0].hullMax`), "repair should work using a base's Small Shipyard as the home venue");

  run(`const otherPid = Object.keys(currentPlanet().distances)[0];
       S.fleet[0].home = otherPid;`);
  run(`reassignShipyard("s1");`);
  assert.equal(run(`S.fleet[0].home`), run(`S.location`), "reassignment should work landing on a base's Small Shipyard as the new home");
});
