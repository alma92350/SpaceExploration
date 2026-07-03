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

test("scrapRefundPct is the base 40% away from any Tier 2 base Small Shipyard", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`scrapRefundPct()`), run(`SCRAP_REFUND_PCT`));
  withBaseShipyard(run, 1);
  assert.equal(run(`scrapRefundPct()`), run(`SCRAP_REFUND_PCT`), "a tier-1 Small Shipyard shouldn't grant the recycling bonus yet");
});

test("scrapRefundPct rises to the recycling bonus at a Tier 2 base Small Shipyard", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  withBaseShipyard(run, 2);
  assert.equal(run(`scrapRefundPct()`), run(`SCRAP_RECYCLE_BONUS_PCT`));
});

test("a colony Shipyard never grants the base's recycling bonus, even at high tier", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  withColonyShipyard(run, 4);
  assert.equal(run(`scrapRefundPct()`), run(`SCRAP_REFUND_PCT`), "the salvage bonus is a Small Shipyard perk, not a colony Shipyard one");
});

test("scrapShip refunds the bonus recycling rate at a Tier 2 base Small Shipyard", () => {
  const { run, state } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices();`);
  state.confirmResult = true;
  withBaseShipyard(run, 2);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Hulk", home: S.location, status: "idle", hull: 10, hullMax: 100 }];`);
  run(`scrapShip("s1");`);
  const expected = run(`Math.round(FLEET_SHIPS["${fr}"].cost.metals * SCRAP_RECYCLE_BONUS_PCT)`);
  assert.equal(run(`S.res.metals || 0`), expected, "should salvage at the 60% recycling rate, not the base 40%");
});

test("scrapShip refunds only the base rate away from a Tier 2 base Small Shipyard", () => {
  const { run, state } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices();`);
  state.confirmResult = true;
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Hulk", home: S.location, status: "idle", hull: 10, hullMax: 100 }];`);
  run(`scrapShip("s1");`);
  const expected = run(`Math.round(FLEET_SHIPS["${fr}"].cost.metals * SCRAP_REFUND_PCT)`);
  assert.equal(run(`S.res.metals || 0`), expected);
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

// ---- Slice 3: ship customization (Cargo/Combat loadouts, Small Shipyard only) ----

test("upgradeLoadout refuses when the ship isn't docked at a base Small Shipyard", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.metals = 1000; S.res.electronics = 1000;
       S.fleet = [{ id: "s1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  run(`upgradeLoadout("s1", "cargo");`);
  assert.equal(run(`S.fleet[0].loadout || null`), null, "no base Small Shipyard here — the refit should be refused");
});

test("upgradeLoadout refuses at a colony Shipyard — it's a Small Shipyard perk only", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.metals = 1000; S.res.electronics = 1000;
       S.fleet = [{ id: "s1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  withColonyShipyard(run, 4);
  run(`upgradeLoadout("s1", "cargo");`);
  assert.equal(run(`S.fleet[0].loadout || null`), null, "a colony Shipyard, however high its tier, should not grant customization");
});

test("upgradeLoadout refuses a ship that isn't idle or isn't home", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.metals = 1000; S.res.electronics = 1000;`);
  withBaseShipyard(run, 1);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Hauler", home: S.location, status: "mission", hull: 100, hullMax: 100 }];`);
  run(`upgradeLoadout("s1", "cargo");`);
  assert.equal(run(`S.fleet[0].loadout || null`), null, "a ship on duty can't be refitted");

  run(`const otherPid = Object.keys(currentPlanet().distances)[0];
       S.fleet[0].status = "idle"; S.fleet[0].home = otherPid;`);
  run(`upgradeLoadout("s1", "cargo");`);
  assert.equal(run(`S.fleet[0].loadout || null`), null, "a ship away from its home Small Shipyard can't be refitted here");
});

test("upgradeLoadout('cargo') deducts materials and adds cargo capacity to the instance", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.metals = 1000; S.res.electronics = 1000;`);
  withBaseShipyard(run, 1);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  const baseCap = run(`FLEET_SHIPS["${fr}"].cap`);
  run(`upgradeLoadout("s1", "cargo");`);
  assert.equal(run(`S.fleet[0].loadout`), "cargo");
  assert.equal(run(`S.fleet[0].loadoutLevel`), 1);
  assert.equal(run(`S.res.metals`), 1000 - 20);
  assert.equal(run(`S.res.electronics`), 1000 - 10);
  assert.equal(run(`shipCargoCap(S.fleet[0])`), baseCap + run(`LOADOUT_CARGO_PER_LEVEL`));
});

test("upgradeLoadout('combat') deducts materials and bumps hullMax/hull/strength on the instance", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices(); S.res.metals = 1000; S.res.electronics = 1000;`);
  withBaseShipyard(run, 1);
  run(`S.fleet = [{ id: "s1", key: "${wr}", name: "Corvette One", home: S.location, status: "idle", hull: 50, hullMax: 50 }];`);
  const baseStr = run(`fleetShipStr(FLEET_SHIPS["${wr}"])`);
  run(`upgradeLoadout("s1", "combat");`);
  assert.equal(run(`S.fleet[0].loadout`), "combat");
  assert.equal(run(`S.fleet[0].hullMax`), 50 + run(`LOADOUT_HULL_PER_LEVEL`));
  assert.equal(run(`S.fleet[0].hull`), 50 + run(`LOADOUT_HULL_PER_LEVEL`), "current hull should rise alongside max, not just the ceiling");
  assert.equal(run(`shipStrEff(S.fleet[0])`), baseStr + run(`LOADOUT_STR_PER_LEVEL`));
});

test("upgradeLoadout won't let a ship switch leans once committed", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.metals = 1000; S.res.electronics = 1000;`);
  withBaseShipyard(run, 1);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  run(`upgradeLoadout("s1", "cargo");`);
  run(`upgradeLoadout("s1", "combat");`);
  assert.equal(run(`S.fleet[0].loadout`), "cargo", "switching leans mid-commitment should be refused");
  assert.equal(run(`S.fleet[0].loadoutLevel`), 1, "the refused switch shouldn't consume a level");
});

test("upgradeLoadout caps at LOADOUT_MAX_LEVEL", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.metals = 100000; S.res.electronics = 100000;`);
  withBaseShipyard(run, 1);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  run(`for (let i = 0; i < 5; i++) upgradeLoadout("s1", "cargo");`);
  assert.equal(run(`S.fleet[0].loadoutLevel`), run(`LOADOUT_MAX_LEVEL`), "5 attempts should still cap out at the max level");
});

test("upgradeLoadout refuses without enough materials, leaving the ship unchanged", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.metals = 1; S.res.electronics = 1;`);
  withBaseShipyard(run, 1);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  run(`upgradeLoadout("s1", "cargo");`);
  assert.equal(run(`S.fleet[0].loadout || null`), null);
  assert.equal(run(`S.res.metals`), 1, "materials should be untouched on a refused refit");
});

test("shipCargoCap/shipStrEff are threaded through live fleet totals (colonyHaulCap, convoyCargoBonus, battleGroupFirepower)", () => {
  const { run } = createSandbox();
  const fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices(); S.res.metals = 1000; S.res.electronics = 1000;`);
  withBaseShipyard(run, 1);
  run(`S.fleet = [{ id: "s1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 100, hullMax: 100 }];`);
  run(`upgradeLoadout("s1", "cargo");`);
  const bonus = run(`LOADOUT_CARGO_PER_LEVEL`), baseCap = run(`FLEET_SHIPS["${fr}"].cap`);
  run(`S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
       S.fleet[0].status = "logistics"; S.fleet[0].station = S.location;`);
  assert.equal(run(`colonyHaulCap(S.location)`), baseCap + bonus, "colonyHaulCap should include the cargo loadout bonus, not just the catalog cap");
});

test("the Fleet tab unlocks from a base's Small Shipyard alone, with no colony at all", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  const fleetGate = () => `TAB_LADDER.find(g => g.id === "fleet").test(S)`;
  assert.equal(run(fleetGate()), false, "no colony, no base shipyard, no fleet yet — should stay locked");
  withBaseShipyard(run, 1);
  assert.equal(run(fleetGate()), true, "a base Small Shipyard alone should unlock the Fleet tab");
});

test("checkUnlocks actually flips S.unlocked.fleet on for a base-only Small Shipyard", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  withBaseShipyard(run, 1);
  run(`checkUnlocks(true);`);
  assert.equal(run(`!!S.unlocked.fleet`), true, "the real unlock pipeline should reveal the Fleet tab, not just the raw test() predicate");
});
