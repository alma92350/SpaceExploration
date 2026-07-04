"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function withColony(run, storage) {
  run(`S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: { shipyard: 1 }, storage: ${JSON.stringify(storage || {})}, orders: {}, unrest: 0, faction: null, idle: {} };`);
}
function withBase(run, storage) {
  run(`S.bases[S.location] = { modules: { shipyard_small: 1 }, storage: ${JSON.stringify(storage || {})}, trade: { on: false, exp: {}, imp: {}, cols: {} } };`);
}
function tier1FreighterKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "freighter")`); }

test("localStockpileAt reads the colony's storage when a colony sits here", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  withColony(run, { metals: 20 });
  assert.equal(run(`localStockpileAt(S.location) === S.colonies[S.location].storage`), true);
});

test("localStockpileAt reads the base's storage when only a base sits here", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  withBase(run, { metals: 20 });
  assert.equal(run(`localStockpileAt(S.location) === S.bases[S.location].storage`), true);
});

test("localStockpileAt prefers a colony's storage over a coexisting base's", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  withBase(run, { metals: 999 });
  withColony(run, { metals: 20 });
  assert.equal(run(`localStockpileAt(S.location) === S.colonies[S.location].storage`), true);
  assert.equal(run(`localStockpileAt(S.location) === S.bases[S.location].storage`), false);
});

test("localStockpileAt is null with neither a colony nor a base here", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`localStockpileAt(S.location)`), null);
});

test("repairSubsys draws its material from the colony's stockpile first, then the hold for the shortfall", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  run(`S.pirate.subsys = { weapons: 0, shields: 100, engines: 100, sensors: 100 };`);   // weapons needs repair, mat: metals
  const matQ = run(`subsysRepairCost("weapons").matQ`);
  const partial = 1;
  withColony(run, { metals: partial });
  run(`S.res.metals = 1000;`);
  run(`repairSubsys("weapons");`);
  assert.equal(run(`S.pirate.subsys.weapons`), 100, "the subsystem should be fully repaired");
  assert.equal(run(`S.colonies[S.location].storage.metals`), 0, "the colony's stock should be fully drained first");
  assert.equal(run(`S.res.metals`), 1000 - (matQ - partial), "the hold should only cover the colony's shortfall");
});

test("repairSubsys fully covered by the local stockpile leaves the hold untouched", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  run(`S.pirate.subsys = { weapons: 100, shields: 0, engines: 100, sensors: 100 };`);   // shields needs repair, mat: electronics
  const matQ = run(`subsysRepairCost("shields").matQ`);
  withColony(run, { electronics: matQ * 2 });
  run(`S.res.electronics = 0;`);
  run(`repairSubsys("shields");`);
  assert.equal(run(`S.pirate.subsys.shields`), 100);
  assert.equal(run(`S.colonies[S.location].storage.electronics`), matQ, "the colony should be charged exactly the repair cost");
  assert.equal(run(`S.res.electronics || 0`), 0, "the hold was never needed and should stay untouched");
});

test("repairSubsys refuses and touches nothing when local stockpile plus hold still fall short", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  run(`S.pirate.subsys = { weapons: 0, shields: 100, engines: 100, sensors: 100 };`);
  withColony(run, { metals: 1 });
  run(`S.res.metals = 0;`);
  run(`repairSubsys("weapons");`);
  assert.equal(run(`S.pirate.subsys.weapons`), 0, "the repair should be refused");
  assert.equal(run(`S.colonies[S.location].storage.metals`), 1, "the refused repair shouldn't touch the colony's stock");
});

test("repairAll drains the local stockpile across the whole batch before touching the hold", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.res.credits = 1000000;`);
  run(`S.pirate.hull = HULL_MAX; S.pirate.subsys = { weapons: 0, shields: 0, engines: 100, sensors: 100 };`);
  const wQ = run(`subsysRepairCost("weapons").matQ`), sQ = run(`subsysRepairCost("shields").matQ`);
  // enough metals in the colony for weapons alone, nothing for shields' electronics
  withColony(run, { metals: wQ, electronics: 0 });
  run(`S.res.metals = 0; S.res.electronics = ${sQ};`);
  run(`repairAll();`);
  assert.equal(run(`S.pirate.subsys.weapons`), 100, "weapons should repair fully from the colony's metals");
  assert.equal(run(`S.pirate.subsys.shields`), 100, "shields should repair fully from the hold's electronics");
  assert.equal(run(`S.colonies[S.location].storage.metals`), 0, "the colony's metals should be spent on weapons");
  assert.equal(run(`S.res.metals || 0`), 0, "the hold's metals should be untouched — the colony covered weapons alone");
  assert.equal(run(`S.res.electronics`), 0, "the hold's electronics should be spent on shields, since the colony had none");
});

test("repairFleetShip at a base Small Shipyard draws metals from the base's stockpile first, then the hold", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 100000;`);
  withBase(run, {});
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 10, hullMax: 100 }];`);
  const metalsNeed = run(`fleetRepairCost(S.fleet[0]).metals`);
  const partial = 2;
  run(`S.bases[S.location].storage.metals = ${partial};`);
  run(`S.res.metals = 1000;`);
  run(`repairFleetShip("s1");`);
  assert.equal(run(`S.fleet[0].hull`), run(`S.fleet[0].hullMax`), "the ship should be fully repaired");
  assert.equal(run(`S.bases[S.location].storage.metals`), 0, "the base's stock should be fully drained first");
  assert.equal(run(`S.res.metals`), 1000 - (metalsNeed - partial), "the hold should only cover the base's shortfall");
});
