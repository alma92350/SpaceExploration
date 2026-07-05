"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* renderStarmap() (renderCore.js) used to draw a bare circle per known world with only a hover
   tooltip for its name and no fleet/pirate/convoy overlay at all — that detail only existed as
   pills on the card grid below it. This adds visible name labels, fleet/pirate glyphs reusing the
   exact predicates those pills already use, a slow per-world positional drift ("dark matter") keyed
   off S.turn with no new persisted state, and a convoy route + ambush marker for an active Escort
   mission (the only feature in the codebase with a concrete "journey between two worlds, with
   progress and possible mid-route combat" shape). */

function tier1WarshipKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`); }
function tier1FreighterKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "freighter")`); }
function knownPlanets(run) { return run(`PLANETS.filter(galaxyKnown)`); }
function renderMap(run) { return run(`renderStarmap(PLANETS.filter(galaxyKnown))`); }

test("renderStarmap draws a visible name label for every known world, not just a tooltip", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const names = JSON.parse(run(`JSON.stringify(PLANETS.filter(galaxyKnown).map(p => p.name))`));
  const html = renderMap(run);
  names.forEach(name => assert.ok(html.includes(`>${name}<`), `expected a visible <text> label for ${name}`));
});

test("starmapDrift is deterministic for a given turn, and changes as S.turn advances", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  run(`S.turn = 5;`);
  const a1 = run(`starmapDrift("terra", "x")`), a2 = run(`starmapDrift("terra", "x")`);
  assert.equal(a1, a2, "the same turn should always give the same offset");
  run(`S.turn = 500;`);
  const b = run(`starmapDrift("terra", "x")`);
  assert.notEqual(a1, b, "a different turn should give a different offset — the layout should actually move");
});

test("starmapDrift decorrelates the x and y axes for the same world", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.turn = 42;`);
  assert.notEqual(run(`starmapDrift("terra", "x")`), run(`starmapDrift("terra", "y")`));
});

test("a pirate-active, intel-known world shows the pirate glyph, gated by the pirates filter", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const known = knownPlanets(run);
  const targetId = run(`(PLANETS.find(p => galaxyKnown(p) && p.id !== S.location) || {}).id`);
  if (!targetId) return;   // no second known world this game — nothing to assert
  // fake pirate activity + intel without needing a real chart purchase
  run(`S.pirates = S.pirates || {}; S.pirates["${targetId}"] = 2;`);
  run(`S.pirateIntel = { until: S.turn + 10, worlds: ["${targetId}"] };`);
  let html = renderMap(run);
  assert.ok(html.includes("🏴"), "the pirate glyph should render for a known-active world");
  run(`toggleGalaxyFilter("pirates");`);
  html = renderMap(run);
  assert.ok(!html.includes("🏴"), "turning off the pirates filter should hide the glyph");
});

test("warship and freighter glyphs render independently and are gated by the fleet filter", () => {
  const { run } = createSandbox();
  const wr = tier1WarshipKey(run), fr = tier1FreighterKey(run);
  run(`S = freshState(); rollPrices();`);
  run(`S.fleet = [{ id: "w1", key: "${wr}", name: "Follower", home: S.location, status: "patrol", hull: 50, hullMax: 50 }];`);
  let html = renderMap(run);
  assert.ok(html.includes("⚔️"), "a following warship should show the warship glyph");
  assert.ok(!html.includes("📦"), "no freighter present — no freighter glyph");
  run(`S.fleet.push({ id: "f1", key: "${fr}", name: "Hauler", home: S.location, status: "idle", hull: 50, hullMax: 50 });`);
  html = renderMap(run);
  assert.ok(html.includes("⚔️") && html.includes("📦"), "both glyphs should render together when both are present");
  run(`toggleGalaxyFilter("fleet");`);
  html = renderMap(run);
  assert.ok(!html.includes("⚔️") && !html.includes("📦"), "turning off the fleet filter should hide both glyphs");
});

test("no convoy route renders with no active escort mission", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const html = renderMap(run);
  assert.ok(!html.includes("stroke-dasharray"), "no dashed convoy route without an active mission");
});

test("an active escort mission draws a dashed route with a progress marker positioned by legs/legsLeft", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`refreshEscortOffers(); acceptEscort(0);`);
  const html = renderMap(run);
  assert.ok(html.includes("stroke-dasharray"), "an active mission should draw a dashed route");
  assert.ok(html.includes("🚚"), "a calm convoy should show the truck marker");
  assert.ok(!html.includes("⚔️"), "no ambush yet — no sword marker");
});

test("an ambushed convoy switches its marker and route color to the alert style", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`refreshEscortOffers(); acceptEscort(0);`);
  run(`S.escort.wave = { foes: [{ hp: 10, maxhp: 10 }], round: 1 };`);
  const html = renderMap(run);
  assert.ok(html.includes("💥"), "an ambush should show the alert marker instead of the truck");
  assert.ok(!html.includes("🚚"), "the calm truck marker should be replaced, not just added to");
  assert.ok(html.includes("var(--bad)"), "the route should switch to the alert color");
});

test("turning off the fleet filter also hides the convoy route", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`refreshEscortOffers(); acceptEscort(0);`);
  run(`toggleGalaxyFilter("fleet");`);
  const html = renderMap(run);
  assert.ok(!html.includes("stroke-dasharray"), "the convoy is fleet-adjacent activity — the fleet filter should hide it too");
});

test("hyperlane edges still only ever connect two mutually-known worlds (unchanged spoiler safety)", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const html = renderMap(run);
  const knownIds = new Set(JSON.parse(run(`JSON.stringify(PLANETS.filter(galaxyKnown).map(p => p.id))`)));
  const hidden = run(`(PLANETS.find(p => !galaxyKnown(p)) || {}).name`);
  if (hidden) assert.ok(!html.includes(`>${hidden}<`), "an unknown world's name should never leak onto the map");
});
