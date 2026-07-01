"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("scrapShip does nothing if the confirmation is declined", () => {
  const { run, state } = createSandbox();
  run(`S = freshState(); rollPrices();
       S.fleet = [{ id: "s1", key: Object.keys(FLEET_SHIPS)[0], name: "Test Hauler", status: "idle", hull: 10, hullMax: 10 }];`);
  state.confirmResult = false;
  run(`scrapShip("s1");`);
  assert.equal(run(`S.fleet.length`), 1, "declining the confirm should leave the ship in the fleet");
});

test("scrapShip removes the ship once the confirmation is accepted", () => {
  const { run, state } = createSandbox();
  run(`S = freshState(); rollPrices();
       S.fleet = [{ id: "s1", key: Object.keys(FLEET_SHIPS)[0], name: "Test Hauler", status: "idle", hull: 10, hullMax: 10 }];`);
  state.confirmResult = true;
  run(`scrapShip("s1");`);
  assert.equal(run(`S.fleet.length`), 0, "accepting the confirm should remove the ship");
});

test("scrapShip refuses a ship that's currently on duty, before it even reaches the confirm", () => {
  const { run, state } = createSandbox();
  run(`S = freshState();
       S.fleet = [{ id: "s1", key: Object.keys(FLEET_SHIPS)[0], name: "Busy Hauler", status: "mission", hull: 10, hullMax: 10 }];`);
  state.confirmResult = true;
  run(`scrapShip("s1");`);
  assert.equal(run(`S.fleet.length`), 1, "a ship on duty should never be scrapped, confirm or not");
  assert.equal(state.confirmCalls.length, 0, "the confirm dialog shouldn't even appear for a ship that can't be scrapped");
});

test("stageCoup spends nothing if the confirmation is declined", () => {
  const { run, state } = createSandbox();
  run(`S = freshState(); rollPrices();
       S.techs.diplomacy = true;
       S.orgs.pmc = { tier: 1 };
       S.res.influence = 100;
       S.pol.slush = 5000;`);
  state.confirmResult = false;
  run(`stageCoup();`);
  assert.equal(run(`S.res.influence`), 100, "declining the coup confirm should not spend influence");
  assert.equal(run(`S.pol.slush`), 5000, "declining the coup confirm should not spend slush");
  assert.equal(run(`S.office`), 0, "declining the coup confirm should not change office");
});

test("stageCoup spends influence and slush once confirmed, win or lose the roll", () => {
  const { run, state } = createSandbox();
  run(`S = freshState(); rollPrices();
       S.techs.diplomacy = true;
       S.orgs.pmc = { tier: 1 };
       S.res.influence = 100;
       S.pol.slush = 5000;`);
  state.confirmResult = true;
  run(`stageCoup();`);
  assert.equal(run(`S.res.influence`), 80, "a confirmed coup attempt at level 1 costs 20 influence");
  assert.equal(run(`S.pol.slush`), 4000, "a confirmed coup attempt at level 1 costs 1000 slush");
});
