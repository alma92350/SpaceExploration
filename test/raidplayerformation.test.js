"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* Raid mode gets the same player-reserve positioning Escort's flagship already has: fold
   the player into the Vanguard/Line/Reserve tiering (FORMATION_SLOTS/FORMATION_TIERS/
   shipFormation, fleet.js) alongside your deployed Battle Group (raiding.js's playerFormation/
   setPlayerFormation/raidFrontTier/raidPlayerExposed). Only meaningful once a Battle Group is
   deployed to hold a line in front of you — alone, you're the only target there is. */

function foe(overrides) {
  return Object.assign({
    type: "hauler", name: "Hauler", ico: "🚚", faction: "core", cargo: {}, credits: 100,
    strength: 20, def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic", bounty: 0, wantedGain: 5,
    isPirate: false, engines: 2, enginesMax: 2, hp: 1000, maxhp: 1000,
  }, overrides || {});
}
function setupEngagement(run, preyOverrides, packOverrides) {
  const prey = foe(Object.assign({ name: "Anchor" }, preyOverrides));
  const pack = (packOverrides || []).map(o => foe(Object.assign({ name: "Pack" }, o)));
  run(`S = freshState(); rollPrices();
    S.prey = ${JSON.stringify(prey)};
    S.prey.pack = ${JSON.stringify(pack)};
    S.prey._others = [];
    S.allies = null;`);
}
function deployWarship(run, formation) {
  const wr = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`);
  run(`S.fleet = [{ id: "bg1", key: "${wr}", name: "Guardian", home: S.location, status: "battle", hull: 10000, hullMax: 10000, formation: "${formation}" }];`);
}

test("S.pirate defaults to line formation", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`playerFormation()`), "line");
});

test("setPlayerFormation reassigns the player, and ignores an invalid slot", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`setPlayerFormation("reserve");`);
  assert.equal(run(`S.pirate.formation`), "reserve");
  run(`setPlayerFormation("nonsense");`);
  assert.equal(run(`S.pirate.formation`), "reserve", "an invalid slot should be a no-op");
});

test("raidPlayerExposed is always true with no Battle Group deployed, regardless of formation", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, []);
  run(`setPlayerFormation("reserve");`);
  run(`Math.random = () => 0.01;`);   // would otherwise force the front-tier branch
  for (let i = 0; i < 10; i++) assert.equal(run(`raidPlayerExposed()`), true, "no one to hide behind with no Battle Group");
});

test("raidFrontTier falls through vanguard -> line -> reserve across you + your Battle Group", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, []);
  deployWarship(run, "line");
  // default: you're in line alongside the warship -> front tier is line, includes you
  assert.equal(run(`raidPlayerFrontline()`), true);
  // move yourself to reserve behind the warship still holding line -> front tier is line (the warship), not you
  run(`setPlayerFormation("reserve");`);
  assert.equal(run(`raidPlayerFrontline()`), false);
  // move the warship to vanguard -> front tier is vanguard (the warship), you're still safely in reserve
  run(`S.fleet[0].formation = "vanguard";`);
  assert.equal(run(`raidPlayerFrontline()`), false);
  // put yourself forward in vanguard too -> you're back in the front tier
  run(`setPlayerFormation("vanguard");`);
  assert.equal(run(`raidPlayerFrontline()`), true);
});

test("raidPlayerExposed only reaches a reserved player on the 15% stray-fire branch", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, []);
  deployWarship(run, "vanguard");
  run(`setPlayerFormation("reserve");`);
  run(`Math.random = () => 0.01;`);   // forces the front-tier branch (< 0.85) -> vanguard warship only
  for (let i = 0; i < 10; i++) assert.equal(run(`raidPlayerExposed()`), false, "front-tier branch should never reach a reserved player behind a holding vanguard");
  run(`Math.random = () => 0.99;`);   // forces the stray branch (>= 0.85) -> reaches everyone, including you
  assert.equal(run(`raidPlayerExposed()`), true);
});

test("combatStrike deals no incoming hull damage to a reserved player screened by a holding Battle Group vanguard", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, [{ name: "Pack1" }]);
  deployWarship(run, "vanguard");
  run(`setPlayerFormation("reserve"); S.raidTargets = [];`);
  run(`Math.random = () => 0.01;`);   // front-tier branch every time -> the vanguard warship, never you
  const hullBefore = run(`S.pirate.hull`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.pirate.hull`), hullBefore, "reserve behind a holding vanguard should take no incoming fire this round");
  assert.ok(run(`S.fleet[0].hull`) < 10000, "the Battle Group vanguard should still be taking real damage");
});

test("combatStrike still damages the player once formation puts them back in the exposed front tier", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, [{ name: "Pack1" }]);
  deployWarship(run, "line");
  run(`S.raidTargets = [];`);   // player stays at the default "line" formation, same tier as the warship
  run(`Math.random = () => 0.01;`);
  const hullBefore = run(`S.pirate.hull`);
  run(`combatStrike(false, "kinetic");`);
  assert.ok(run(`S.pirate.hull`) < hullBefore, "the player shares the front tier with the warship, so incoming fire should still land");
});

test("preyCombatCard renders a move-to-Reserve button for the player once a Battle Group is deployed, and no formation controls without one", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, []);
  let html = run(`preyCombatCard(S.prey, actionsLeft())`);
  assert.doesNotMatch(html, /setPlayerFormation/, "no Battle Group deployed -> no player formation controls");
  deployWarship(run, "line");
  html = run(`preyCombatCard(S.prey, actionsLeft())`);
  assert.match(html, /setPlayerFormation\('reserve'\)/, "a move-to-Reserve button should render for the player");
  assert.match(html, /setPlayerFormation\('vanguard'\)/, "a move-to-Vanguard button should render for the player");
});
