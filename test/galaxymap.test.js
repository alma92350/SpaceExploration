"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function tier1WarshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`); }
// the sandbox's document.getElementById returns a FRESH element every call (test/helpers/sandbox.js),
// so a render function's `el.innerHTML = ...` write is otherwise invisible to a later read. Caching
// the element the first time it's requested (same trick as spying on a call count) makes the real
// rendered output observable, the same way a live browser's DOM already behaves.
function cacheGetElementById(run) {
  run(`const _elCache = {}; const _origGetById = document.getElementById.bind(document);
       document.getElementById = id => _elCache[id] || (_elCache[id] = _origGetById(id));`);
}

test("fleetPresentAt is true for a fleet ship on a mission at that world", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  const other = run(`Object.keys(currentPlanet().distances)[0]`);
  run(`S.fleet = [{ id: "s1", key: "${wr}", name: "Scout", home: S.location, status: "mission", mission: { planet: "${other}", task: "cull", cyclesLeft: 3 }, hull: 50, hullMax: 50 }];`);
  assert.equal(run(`fleetPresentAt("${other}")`), true);
  assert.equal(run(`fleetPresentAt(S.location)`), false, "the ship's home isn't where its mission is");
});

test("fleetPresentAt is true for a ship stationed on logistics duty", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  run(`S.fleet = [{ id: "s1", key: "${wr}", name: "Guard", home: S.location, status: "logistics", station: S.location, hull: 50, hullMax: 50 }];`);
  assert.equal(run(`fleetPresentAt(S.location)`), true);
});

test("fleetPresentAt is true for a following ship only wherever the player currently is", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  run(`S.fleet = [{ id: "s1", key: "${wr}", name: "Sentry", home: S.location, status: "patrol", hull: 50, hullMax: 50 }];`);
  assert.equal(run(`fleetPresentAt(S.location)`), true);
  const other = run(`Object.keys(currentPlanet().distances)[0]`);
  assert.equal(run(`fleetPresentAt("${other}")`), false, "a following ship travels with the player, not present anywhere else");
});

test("fleetPresentAt is true for an idle or building ship docked at its own home", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  run(`S.fleet = [
    { id: "idle1", key: "${wr}", name: "Idler", home: S.location, status: "idle", hull: 50, hullMax: 50 },
    { id: "build1", key: "${wr}", name: "Yard", home: S.location, status: "building", buildLeft: 2, hull: 50, hullMax: 50 },
  ];`);
  assert.equal(run(`fleetPresentAt(S.location)`), true);
});

test("fleetPresentAt is false when the fleet is empty or elsewhere entirely", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  assert.equal(run(`fleetPresentAt(S.location)`), false, "no fleet at all");
  const other = run(`Object.keys(currentPlanet().distances)[0]`);
  run(`S.fleet = [{ id: "s1", key: "${wr}", name: "Away", home: "${other}", status: "idle", hull: 50, hullMax: 50 }];`);
  assert.equal(run(`fleetPresentAt(S.location)`), false, "the ship is docked at a different world entirely");
});

test("pirateIntelKnows is true at a fleet-present world with no chart and not the current location", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState();`);
  const other = run(`Object.keys(currentPlanet().distances)[0]`);
  assert.equal(run(`pirateIntelKnows("${other}")`), false, "no chart, no fleet — should not know yet");
  // a following ship travels with the player now, so it can no longer grant intel about a world
  // other than the current one — logistics duty is still legitimately pinned to a fixed station,
  // so it's what proves fleetPresentAt's non-current-location clauses still grant remote intel.
  run(`S.fleet = [{ id: "s1", key: "${wr}", name: "Guard", home: S.location, status: "logistics", station: "${other}", hull: 50, hullMax: 50 }];`);
  assert.equal(run(`pirateIntelKnows("${other}")`), true, "a stationed ship there should grant intel independent of any chart");
});

test("pirateIntelKnows is still true at your own current location with no fleet or chart", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`pirateIntelKnows(S.location)`), true);
});

test("ensureGalaxyFilters defaults every category to true, and toggleGalaxyFilter flips exactly the named key", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  assert.equal(run(`JSON.stringify(ensureGalaxyFilters())`), JSON.stringify({ fleet: true, pirates: true, factions: true, environment: true, settlements: true }));
  run(`toggleGalaxyFilter("pirates");`);
  assert.equal(run(`S.galaxyFilters.pirates`), false);
  assert.equal(run(`S.galaxyFilters.fleet`), true, "other categories should be untouched");
  run(`toggleGalaxyFilter("pirates");`);
  assert.equal(run(`S.galaxyFilters.pirates`), true, "toggling again should flip it back");
});

test("toggleGalaxyFilter ignores an unknown key", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`toggleGalaxyFilter("nonsense");`);
  assert.equal(run(`JSON.stringify(S.galaxyFilters)`), JSON.stringify({ fleet: true, pirates: true, factions: true, environment: true, settlements: true }));
});

test("renderGalaxy shows a colored patrol pill and a colored docked pill for fleet ships", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices(); S.showAllTabs = true;`);
  run(`S.fleet = [
    { id: "p1", key: "${wr}", name: "Sentry", home: S.location, status: "patrol", hull: 50, hullMax: 50 },
    { id: "d1", key: "${wr}", name: "Docked", home: S.location, status: "idle", hull: 50, hullMax: 50 },
  ];`);
  cacheGetElementById(run);
  run(`renderGalaxy();`);
  const html = run(`document.getElementById("panel-galaxy").innerHTML`);
  assert.match(html, /border-color:var\(--accent-2\)[^"]*"[^>]*>🛡️ 1 following/);
  assert.match(html, /border-color:var\(--good\)[^"]*"[^>]*>⚓ 1 docked/);
});

test("turning off the fleet filter hides every fleet-related pill while leaving others intact", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run);
  run(`S = freshState(); rollPrices(); S.showAllTabs = true;`);
  run(`S.fleet = [{ id: "p1", key: "${wr}", name: "Sentry", home: S.location, status: "patrol", hull: 50, hullMax: 50 }];`);
  cacheGetElementById(run);
  run(`toggleGalaxyFilter("fleet");`);
  const html = run(`document.getElementById("panel-galaxy").innerHTML`);
  assert.doesNotMatch(html, /🛡️ \d+ following/);
  assert.match(html, /Galactic Map/, "the rest of the panel should still render");
});

test("renderGalaxy shows your colony, your base, and a Shipyard tier pill, gated by the settlements filter", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.showAllTabs = true;`);
  const cid = run(`(PLANETS.find(p => p.colonizable && galaxyKnown(p)) || {}).id`);
  const bid = run(`(PLANETS.find(p => !p.colonizable && galaxyKnown(p)) || {}).id`);
  if (!cid || !bid) return;   // this game's random draw didn't surface both world types — nothing to assert
  run(`S.colonies["${cid}"] = { pop: 5, happiness: 70, tax: 10, buildings: { shipyard: 3 }, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
       S.bases["${bid}"] = { modules: { shipyard_small: 2 }, storage: {}, trade: { on: false, exp: {}, imp: {}, cols: {} } };`);
  cacheGetElementById(run);
  run(`renderGalaxy();`);
  let html = run(`document.getElementById("panel-galaxy").innerHTML`);
  assert.match(html, />your colony 🌍</, "the colonized world's tag should read as owned");
  assert.match(html, />🏰 your base</, "the based world should show a base pill");
  assert.match(html, />🏗️ Shipyard T3</, "the colony's Shipyard tier should show");
  assert.match(html, />🏗️ Shipyard T2</, "the base's Small Shipyard tier should show too");
  run(`toggleGalaxyFilter("settlements");`);
  html = run(`document.getElementById("panel-galaxy").innerHTML`);
  assert.match(html, />colonizable</, "with the filter off, an owned colonizable world reverts to the plain colonizable tag");
  assert.doesNotMatch(html, /your base/, "the base pill should be hidden");
  assert.doesNotMatch(html, /Shipyard T\d/, "the shipyard pills should be hidden");
});

test("turning off the pirates filter hides the pirate pill even when pirateIntelKnows is true", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.showAllTabs = true;`);
  cacheGetElementById(run);
  run(`renderGalaxy();`);
  const before = run(`document.getElementById("panel-galaxy").innerHTML`);
  assert.match(before, /🏴 (pirates|clear)/, "your own current world's pirate status should show by default");
  run(`toggleGalaxyFilter("pirates");`);
  const after = run(`document.getElementById("panel-galaxy").innerHTML`);
  assert.doesNotMatch(after, /🏴 (pirates|clear)/);
});

test("an owned world's card shows the faction-colored left border; a colonizable world's does not", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.showAllTabs = true;`);
  const ownedId = run(`(PLANETS.find(p => !p.colonizable && p.faction && galaxyKnown(p)) || {}).id`);
  const colonizableName = run(`(PLANETS.find(p => p.colonizable && galaxyKnown(p)) || {}).name`);
  const ownedColor = run(`FACTIONS[PLANETS.find(p => p.id === "${ownedId}").faction].color`);
  cacheGetElementById(run);
  run(`renderGalaxy();`);
  const html = run(`document.getElementById("panel-galaxy").innerHTML`);
  assert.ok(html.includes(`border-left:4px solid ${ownedColor}`), "the owned world's card should carry its faction's color");
  const nameIdx = html.indexOf(`>${colonizableName} `);
  assert.ok(nameIdx > -1, "the colonizable world's card should be present");
  const cardStart = html.lastIndexOf('<div class="planet-card', nameIdx);
  const cardOpenTag = html.slice(cardStart, html.indexOf(">", cardStart) + 1);
  assert.ok(!cardOpenTag.includes("border-left"), "a colonizable/unowned world's card should carry no faction border");
});

test("toggling the factions filter off removes the faction border", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.showAllTabs = true;`);
  cacheGetElementById(run);
  run(`toggleGalaxyFilter("factions");`);
  const html = run(`document.getElementById("panel-galaxy").innerHTML`);
  assert.doesNotMatch(html, /border-left:4px solid/);
});
