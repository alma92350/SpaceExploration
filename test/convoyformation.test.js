"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* The Personal Convoy gets the same Vanguard/Line/Reserve tiering Battle Group, Escort and
   the raid-mode player station already use (FORMATION_SLOTS/FORMATION_TIERS/shipFormation,
   fleet.js): assignConvoy gives first-time joiners a role-shaped default (warships vanguard,
   freighters reserve), setConvoyFormation moves them, convoyFrontTier() folds the player's
   own S.pirate.formation station into the pool, and convoyAmbushRisk's opening volley lands
   on the frontmost tier (85%) instead of a uniformly random freighter. Ambush ODDS moved to
   pure route risk — maybeAmbush reads pirate activity at both ends, guards damp nothing. */

function freighterKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "freighter")`); }
function warshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].role === "warship")`); }

test("assignConvoy defaults a first-time warship to vanguard and a freighter to reserve", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run), wr = warshipKey(run);
  run(`S = freshState(); rollPrices();
       S.fleet = [
         { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 10, hullMax: 10 },
         { id: "f1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 10, hullMax: 10 }];`);
  run(`assignConvoy("w1"); assignConvoy("f1");`);
  assert.equal(run(`S.fleet[0].formation`), "vanguard", "a warship guards from the front by default");
  assert.equal(run(`S.fleet[1].formation`), "reserve", "a freighter is the payload — held back by default, same as Escort's convention");
});

test("assignConvoy keeps a prior manual formation pick (sticky, same as deployBattleGroup)", () => {
  const { run } = createSandbox();
  const wr = warshipKey(run);
  run(`S = freshState(); rollPrices();
       S.fleet = [{ id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "idle", hull: 10, hullMax: 10, formation: "line" }];`);
  run(`assignConvoy("w1");`);
  assert.equal(run(`S.fleet[0].formation`), "line", "a valid prior pick should survive re-assignment");
});

test("setConvoyFormation reassigns a convoy ship, and ignores an invalid slot or a non-convoy ship", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run);
  run(`S = freshState(); rollPrices();
       S.fleet = [
         { id: "f1", key: "${fr}", name: "Hauler", home: S.location, status: "convoy", hull: 10, hullMax: 10, formation: "reserve" },
         { id: "f2", key: "${fr}", name: "Docked", home: S.location, status: "idle", hull: 10, hullMax: 10, formation: "reserve" }];`);
  run(`setConvoyFormation("f1", "vanguard");`);
  assert.equal(run(`S.fleet[0].formation`), "vanguard");
  run(`setConvoyFormation("f1", "nonsense");`);
  assert.equal(run(`S.fleet[0].formation`), "vanguard", "an invalid slot should be a no-op");
  run(`setConvoyFormation("f2", "line");`);
  assert.equal(run(`S.fleet[1].formation`), "reserve", "a ship not on convoy duty should be untouched");
});

test("convoyFrontTier falls through vanguard -> line -> reserve across you + your convoy", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run), wr = warshipKey(run);
  run(`S = freshState();
       S.fleet = [
         { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "convoy", hull: 10, hullMax: 10, formation: "vanguard" },
         { id: "f1", key: "${fr}", name: "Hauler", home: S.location, status: "convoy", hull: 10, hullMax: 10, formation: "reserve" }];`);
  // vanguard warship holds the front; the player (default line) is behind it
  assert.equal(run(`convoyFrontTier().every(o => !o.isPlayer)`), true, "the vanguard warship alone should hold the front");
  // pull the warship back to reserve -> the player's line station becomes the front
  run(`S.fleet[0].formation = "reserve";`);
  assert.equal(run(`convoyFrontTier().length === 1 && convoyFrontTier()[0].isPlayer`), true, "the player in Line is now frontmost");
  // tuck the player into reserve too -> everyone shares the reserve front
  run(`S.pirate.formation = "reserve";`);
  assert.equal(run(`convoyFrontTier().length`), 3, "with everyone in Reserve, the whole convoy (player included) is the front tier");
});

test("the opening volley reaches a reserved target only via the 15% stray branch", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run), wr = warshipKey(run);
  run(`S = freshState(); S.res.credits = 10000; S.pirate.formation = "reserve";
       S.fleet = [
         { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "convoy", hull: 100000, hullMax: 100000, formation: "vanguard" },
         { id: "f1", key: "${fr}", name: "Hauler", home: S.location, status: "convoy", hull: 100000, hullMax: 100000, formation: "reserve" }];`);
  run(`Math.random = () => 0.01;`);   // always the front-tier branch (< 0.85)
  for (let i = 0; i < 10; i++) run(`convoyAmbushRisk(5);`);
  assert.equal(run(`S.fleet[1].hull`), 100000, "front-tier volleys should never reach the reserve freighter behind a holding vanguard");
  assert.equal(run(`S.pirate.hull`), 100, "nor the reserved player");
  assert.ok(run(`S.fleet[0].hull`) < 100000, "the vanguard guard soaked every volley");
  run(`Math.random = () => 0.99;`);   // stray branch (>= 0.85) — reaches anyone; with random pinned at 0.99, pick() lands on the last pool entry (the reserve freighter)
  run(`convoyAmbushRisk(5);`);
  assert.ok(run(`S.fleet[1].hull`) < 100000, "stray fire ignores tiering and can reach the reserve freighter");
});

test("guards still blunt the volley's damage, 1/(1+guards)", () => {
  const { run } = createSandbox();
  const wr = warshipKey(run);
  // one lone vanguard warship, player reserved: it takes the volley at full force
  run(`S = freshState(); S.pirate.formation = "reserve";
       S.fleet = [{ id: "w1", key: "${wr}", name: "Solo", home: S.location, status: "convoy", hull: 100000, hullMax: 100000, formation: "vanguard" }];`);
  run(`Math.random = () => 0.5;`);
  run(`convoyAmbushRisk(5);`);
  const soloDmg = 100000 - run(`S.fleet[0].hull`);
  // same volley with two guards aboard: damage divided by (1 + 2)
  run(`S.fleet = [
        { id: "w1", key: "${wr}", name: "Solo", home: S.location, status: "convoy", hull: 100000, hullMax: 100000, formation: "vanguard" },
        { id: "w2", key: "${wr}", name: "Second", home: S.location, status: "convoy", hull: 100000, hullMax: 100000, formation: "reserve" }];`);
  run(`Math.random = () => 0.5;`);
  run(`convoyAmbushRisk(5);`);
  const guardedDmg = 100000 - run(`S.fleet[0].hull`);
  assert.ok(guardedDmg < soloDmg, `a second guard should blunt the volley (got ${guardedDmg} vs solo ${soloDmg})`);
});

test("the Fleet tab convoy card renders formation move buttons for each ship and for the player", () => {
  const { run } = createSandbox();
  const fr = freighterKey(run), wr = warshipKey(run);
  run(`S = freshState(); rollPrices();
       S.fleet = [
         { id: "w1", key: "${wr}", name: "Guard", home: S.location, status: "convoy", hull: 10, hullMax: 10, formation: "vanguard" },
         { id: "f1", key: "${fr}", name: "Hauler", home: S.location, status: "convoy", hull: 10, hullMax: 10, formation: "reserve" }];`);
  run(`const _c = {}; const _o = document.getElementById.bind(document);
       document.getElementById = id => _c[id] || (_c[id] = _o(id));`);
  run(`setSubView("fleet", "assign");`);
  run(`renderFleet();`);
  const html = run(`document.getElementById("panel-fleet").innerHTML`);
  assert.match(html, /setConvoyFormation\('w1','line'\)/, "a move button should render for the vanguard warship");
  assert.match(html, /setConvoyFormation\('f1','vanguard'\)/, "a move button should render for the reserve freighter");
  assert.match(html, /setPlayerFormation\('vanguard'\)/, "the player's own station should be movable from the convoy card");
  assert.match(html, /Front line/, "the card should show which tier currently holds the front");
});
