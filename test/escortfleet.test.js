"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* The Escort tab's "your own warships" rally list used fleetRaidable() (fleet.js) — but that
   function was redefined by the "Follow Me" rework to mean "warships following the player"
   (status:"patrol"), not "idle warships available to assign". escortRallyFleet itself still
   requires status:"idle", so the list showed following ships as callable (they'd always refuse
   when clicked) and hid genuinely-available idle ships docked right here. fleetEscortable()
   is the correct, distinct pool: idle warships docked at the player's own current location. */

function tier1WarshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`); }
function tier1FreighterKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "freighter")`); }
function startEscort(run) { run(`refreshEscortOffers(); acceptEscort(0);`); }

test("fleetEscortable returns only idle warships docked at the player's current location", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run), fr = tier1FreighterKey(run);
  run(`S = freshState();`);
  const other = run(`Object.keys(currentPlanet().distances)[0]`);
  run(`S.fleet = [
    { id: "idleHere", key: "${wr}", name: "Idler", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "follower", key: "${wr}", name: "Follower", home: S.location, status: "patrol", hull: 50, hullMax: 50 },
    { id: "idleAway", key: "${wr}", name: "AwayIdler", home: "${other}", status: "idle", hull: 50, hullMax: 50 },
    { id: "freighterHere", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "busyHere", key: "${wr}", name: "Busy", home: S.location, status: "mission", hull: 50, hullMax: 50 },
  ];`);
  assert.equal(run(`fleetEscortable().map(s => s.id).join(",")`), "idleHere");
});

test("escortRallyFleet succeeds for an idle warship docked at the player's current location", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  run(`S.fleet = [{ id: "idleHere", key: "${wr}", name: "Idler", home: S.location, status: "idle", hull: 50, hullMax: 50 }];`);
  startEscort(run);
  run(`escortRallyFleet("idleHere");`);
  assert.ok(run(`ensureEscort().fleet.some(s => s.fleetId === "idleHere")`), "the idle local warship should join the convoy");
  assert.equal(run(`S.fleet[0].status`), "escort");
});

test("escortRallyFleet refuses a following (patrol) warship, even though it's shown by fleetRaidable elsewhere", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  run(`S.fleet = [{ id: "follower", key: "${wr}", name: "Follower", home: S.location, status: "patrol", hull: 50, hullMax: 50 }];`);
  startEscort(run);
  run(`escortRallyFleet("follower");`);
  assert.ok(!run(`ensureEscort().fleet.some(s => s.fleetId === "follower")`), "a following ship should be refused, not rallied");
  assert.equal(run(`S.fleet[0].status`), "patrol", "its duty should be untouched by the refused attempt");
});

test("escortRallyFleet refuses an idle warship docked at a different world", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  const other = run(`Object.keys(currentPlanet().distances)[0]`);
  run(`S.fleet = [{ id: "idleAway", key: "${wr}", name: "AwayIdler", home: "${other}", status: "idle", hull: 50, hullMax: 50 }];`);
  startEscort(run);
  run(`escortRallyFleet("idleAway");`);
  assert.ok(!run(`ensureEscort().fleet.some(s => s.fleetId === "idleAway")`), "a ship idling elsewhere shouldn't be rallied into a convoy departing from here");
  assert.equal(run(`S.fleet[0].status`), "idle", "it should remain idle at its own home, untouched");
});

test("renderEscort only offers an Assign button for the idle local warship, not the following one", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices();`);
  run(`const _c = {}; const _o = document.getElementById.bind(document);
       document.getElementById = id => _c[id] || (_c[id] = _o(id));`);
  run(`S.fleet = [
    { id: "idleHere", key: "${wr}", name: "Idler", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "follower", key: "${wr}", name: "Follower", home: S.location, status: "patrol", hull: 50, hullMax: 50 },
  ];`);
  startEscort(run);
  const html = run(`document.getElementById("panel-escort").innerHTML`);
  assert.match(html, /escortRallyFleet\('idleHere'\)/, "the idle local warship should be offered");
  assert.doesNotMatch(html, /escortRallyFleet\('follower'\)/, "the following warship should not be offered — it would just refuse when clicked");
});
