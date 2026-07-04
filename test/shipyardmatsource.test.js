"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function tier1FreighterKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "freighter")`); }

function withColonyShipyard(run, tier, storage) {
  run(`S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: { shipyard: ${tier} }, storage: ${JSON.stringify(storage || {})}, orders: {}, unrest: 0, faction: null, idle: {} };`);
}
function withBaseShipyard(run, tier, storage) {
  run(`S.bases[S.location] = { modules: { shipyard_small: ${tier} }, storage: ${JSON.stringify(storage || {})}, trade: { on: false, exp: {}, imp: {}, cols: {} } };`);
}

test("shipyardLocalStorage reads the colony's storage when a colony Shipyard is the build venue", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  withColonyShipyard(run, 1, { metals: 50 });
  assert.equal(run(`shipyardLocalStorage(S.location) === S.colonies[S.location].storage`), true);
});

test("shipyardLocalStorage reads the base's storage when a base Small Shipyard is the build venue", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  withBaseShipyard(run, 1, { metals: 50 });
  assert.equal(run(`shipyardLocalStorage(S.location) === S.bases[S.location].storage`), true);
});

test("shipyardLocalStorage is null with no shipyard here", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`shipyardLocalStorage(S.location)`), null);
});

test("orderShip at a colony Shipyard draws materials from the colony's stockpile first, then the hold for the shortfall", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  // Fully stock the colony with everything the hull needs, at double the amount required —
  // whatever's left over after the colony pays should mean the hold is untouched.
  run(`Object.keys(FLEET_SHIPS["${fr}"].cost).forEach(k => { if (k !== "credits") S.res[k] = 0; });`);
  const stock = run(`(() => { const m = {}; Object.keys(FLEET_SHIPS["${fr}"].cost).forEach(k => { if (k !== "credits") m[k] = FLEET_SHIPS["${fr}"].cost[k] * 2; }); return m; })()`);
  withColonyShipyard(run, 1, stock);
  run(`orderShip("${fr}");`);
  assert.equal(run(`S.fleet.length`), 1, "the colony's stockpile alone should cover the hull");
  Object.entries(stock).forEach(([k, v]) => {
    const cost = run(`FLEET_SHIPS["${fr}"].cost.${k}`);
    assert.equal(run(`S.colonies[S.location].storage.${k}`), v - cost, `${k} should be drawn from the colony's storage`);
    assert.equal(run(`S.res.${k} || 0`), 0, `${k} in the player's hold should be untouched — the colony covered it all`);
  });
});

test("orderShip at a colony Shipyard tops up from the hold once the colony's stockpile runs short", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  const cost = run(`FLEET_SHIPS["${fr}"].cost.metals`);
  const partial = Math.floor(cost / 3);
  withColonyShipyard(run, 1, { metals: partial });
  run(`Object.keys(FLEET_SHIPS["${fr}"].cost).forEach(k => { if (k !== "credits" && k !== "metals") S.res[k] = 1000; });`);
  run(`S.res.metals = 1000;`);
  run(`orderShip("${fr}");`);
  assert.equal(run(`S.fleet.length`), 1);
  assert.equal(run(`S.colonies[S.location].storage.metals`), 0, "the colony's partial metals stock should be fully drained first");
  assert.equal(run(`S.res.metals`), 1000 - (cost - partial), "the hold should only be charged for the shortfall the colony couldn't cover");
});

test("orderShip at a base Small Shipyard draws from the base's stockpile first, then the hold", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  const cost = run(`FLEET_SHIPS["${fr}"].cost.metals`);
  const partial = Math.floor(cost / 2);
  withBaseShipyard(run, 1, { metals: partial });
  run(`Object.keys(FLEET_SHIPS["${fr}"].cost).forEach(k => { if (k !== "credits" && k !== "metals") S.res[k] = 1000; });`);
  run(`S.res.metals = 1000;`);
  run(`orderShip("${fr}");`);
  assert.equal(run(`S.fleet.length`), 1);
  assert.equal(run(`S.bases[S.location].storage.metals`), 0, "the base's partial metals stock should be fully drained first");
  assert.equal(run(`S.res.metals`), 1000 - (cost - partial), "the hold should only cover the base's shortfall");
});

test("orderShip fails and touches nothing when the colony stockpile plus hold still can't cover the cost", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  withColonyShipyard(run, 1, { metals: 1 });
  run(`Object.keys(FLEET_SHIPS["${fr}"].cost).forEach(k => { if (k !== "credits") S.res[k] = 0; });`);
  run(`orderShip("${fr}");`);
  assert.equal(run(`S.fleet.length`), 0, "neither source has enough — the build should be refused");
  assert.equal(run(`S.colonies[S.location].storage.metals`), 1, "the refused build should leave the colony's stock untouched");
});

test("orderShip never draws credits from colony or base storage — only from the player's own credits", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices();`);
  const cost = run(`FLEET_SHIPS["${fr}"].cost.credits`);
  withColonyShipyard(run, 1, { credits: 999999 });
  run(`Object.keys(FLEET_SHIPS["${fr}"].cost).forEach(k => { if (k !== "credits") S.res[k] = 1000; });`);
  run(`S.res.credits = ${cost - 1};`);
  run(`orderShip("${fr}");`);
  assert.equal(run(`S.fleet.length`), 0, "the player's own credits are one short — a colony's stray 'credits' storage entry must not bail it out");
});

test("when a colony and a base Small Shipyard coexist, materials come from the colony's storage only — the base's stockpile is untouched", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  const stock = run(`(() => { const m = {}; Object.keys(FLEET_SHIPS["${fr}"].cost).forEach(k => { if (k !== "credits") m[k] = FLEET_SHIPS["${fr}"].cost[k] * 2; }); return m; })()`);
  withBaseShipyard(run, 2, stock);      // plenty of everything sitting at the base
  withColonyShipyard(run, 1, stock);    // and identically plenty at the colony
  run(`Object.keys(FLEET_SHIPS["${fr}"].cost).forEach(k => { if (k !== "credits") S.res[k] = 0; });`);
  assert.equal(run(`shipyardVenueAt(S.location)`), "colony", "the colony Shipyard should be the build venue");
  run(`orderShip("${fr}");`);
  assert.equal(run(`S.fleet.length`), 1);
  Object.keys(stock).forEach(k => {
    assert.equal(run(`S.bases[S.location].storage.${k}`), stock[k], `${k} at the base should be completely untouched — the colony is the active venue`);
  });
});
