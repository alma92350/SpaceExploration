"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

// Simulates a faction beaten down to zero active worlds -- reassigning every planet it owns
// elsewhere is simpler and more direct than juggling S.active, and PLANETS is rebuilt fresh
// per sandbox so this can't leak between tests.
function strandFaction(run, faction, fallback) { run(`PLANETS.forEach(p => { if (p.faction === "${faction}") p.faction = "${fallback}"; });`); }
// chooseActivePlanets (galaxygen.js) draws a random 9 of 15 core worlds per game, unseeded --
// a 2-world faction has a real chance of already being dispossessed by pure luck of the draw.
// Tests that need a guaranteed-clean baseline hand any such faction one active world back.
function ensureNoFactionDispossessed(run) {
  run(`FACTION_KEYS.forEach(f => {
    if (activeFactionPlanetCount(f) <= 0) {
      const donor = PLANETS.find(p => p.faction && p.faction !== f && isActive(p) && activeFactionPlanetCount(p.faction) > 1);
      if (donor) donor.faction = f;
    }
  });`);
}

test("dispossessedFactions exactly matches factions with zero active planets, whatever a fresh game's random active-world draw produced", () => {
  // chooseActivePlanets (galaxygen.js) picks a random 9 of 15 core worlds per game, unseeded --
  // small factions (2 static worlds) have a real, non-negligible chance of drawing zero active
  // worlds right out of the gate. So this checks the invariant, not a fixed "always empty"
  // assumption that a real game can and does violate.
  const { run } = createSandbox();
  run(`S = freshState();`);
  const expected = run(`JSON.stringify(FACTION_KEYS.filter(f => activeFactionPlanetCount(f) <= 0))`);
  assert.equal(run(`JSON.stringify(dispossessedFactions())`), expected);
});

test("dispossessedFactions lists a faction once every one of its active worlds is gone", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  ensureNoFactionDispossessed(run);
  strandFaction(run, "agri", "core");
  assert.equal(run(`activeFactionPlanetCount("agri")`), 0);
  assert.equal(run(`JSON.stringify(dispossessedFactions())`), JSON.stringify(["agri"]));
});

test("acceptCommissionRemote refuses when the named faction still holds worlds", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.rep.agri = 50;`);
  ensureNoFactionDispossessed(run);   // guarantee agri actually still holds a world for this check to mean anything
  run(`acceptCommissionRemote("agri");`);
  assert.equal(run(`S.commission`), null, "agri still has planets — it should deal in person, not remotely");
});

test("acceptCommissionRemote refuses without enough reputation, leaving nothing changed", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  strandFaction(run, "agri", "core");
  run(`S.rep.agri = 0;`);
  run(`acceptCommissionRemote("agri");`);
  assert.equal(run(`S.commission`), null);
});

test("acceptCommissionRemote refuses when the player is already under a letter of marque", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  strandFaction(run, "agri", "core");
  run(`S.rep.agri = 50;`);
  run(`S.commission = { patron: "core", target: "frontier", expires: 999, quota: 5, done: 0, bounty: 800, reward: 4000 };`);
  run(`acceptCommissionRemote("agri");`);
  assert.equal(run(`S.commission.patron`), "core", "the existing commission shouldn't be replaced");
});

test("acceptCommissionRemote succeeds for a truly dispossessed faction, from anywhere, regardless of currentPlanet's own faction", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  strandFaction(run, "agri", "core");
  run(`S.rep.agri = 50;`);
  // stand somewhere with a totally unrelated owning faction, to prove location doesn't gate this
  run(`S.location = PLANETS.find(p => p.faction && p.faction !== "agri" && p.faction !== "miners").id;`);
  run(`acceptCommissionRemote("agri");`);
  assert.equal(run(`S.commission.patron`), "agri");
  assert.equal(run(`S.commission.target`), "miners", "agri's static rival is miners");
  assert.equal(run(`S.commission.quota`), run(`COMM_QUOTA`));
  assert.equal(run(`S.commission.bounty`), run(`COMM_BOUNTY`));
  assert.equal(run(`S.rep.agri`), 55, "accepting should still raise rep with the patron");
  assert.equal(run(`S.rep.miners || 0`), -8, "and lower rep with the target, same as an in-person commission");
});

test("acceptCommissionRemote refuses a faction with no rival on the table", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  run(`FACTION_RIVAL.agri = undefined;`);
  strandFaction(run, "agri", "core");
  run(`S.rep.agri = 50;`);
  run(`acceptCommissionRemote("agri");`);
  assert.equal(run(`S.commission`), null);
});

test("renderDispossessedFactions renders nothing when no faction is dispossessed", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  ensureNoFactionDispossessed(run);
  assert.equal(run(`renderDispossessedFactions()`), "");
});

test("renderDispossessedFactions offers the accept button once a dispossessed faction has earned enough rep", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  strandFaction(run, "agri", "core");
  run(`S.rep.agri = 50;`);
  const html = run(`renderDispossessedFactions()`);
  assert.match(html, /acceptCommissionRemote\('agri'\)/);
});

test("renderDispossessedFactions shows a rep-gate hint, not a button, when rep is too low", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  strandFaction(run, "agri", "core");
  run(`S.rep.agri = 0;`);
  const html = run(`renderDispossessedFactions()`);
  assert.doesNotMatch(html, /acceptCommissionRemote/);
  assert.match(html, /needs .*rep/);
});
