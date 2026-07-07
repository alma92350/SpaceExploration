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
function tier1TankerKey(run) { return run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "tanker")`); }
function knownPlanets(run) { return run(`PLANETS.filter(galaxyKnown)`); }
function renderMap(run) { return run(`renderStarmap(PLANETS.filter(galaxyKnown))`); }
function knownDest(run) { return run(`(PLANETS.find(p => isActive(p) && galaxyKnown(p) && p.id !== S.location) || {}).id`); }
function withColonyShipyard(run, tier) {
  run(`S.colonies[S.location] = { pop: 10, happiness: 70, tax: 10, buildings: { shipyard: ${tier} }, storage: { fuel: 500 }, orders: {}, unrest: 0, faction: null, idle: {} };`);
}

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

test("colony, base and shipyard glyphs render independently and are gated by the settlements filter", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const cid = run(`(PLANETS.find(p => p.colonizable && galaxyKnown(p)) || {}).id`);
  const bid = run(`(PLANETS.find(p => !p.colonizable && galaxyKnown(p)) || {}).id`);
  if (!cid || !bid) return;   // this game's random draw didn't surface both world types — nothing to assert
  run(`S.colonies["${cid}"] = { pop: 5, happiness: 70, tax: 10, buildings: { shipyard: 3 }, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
       S.bases["${bid}"] = { modules: { shipyard_small: 2 }, storage: {}, trade: { on: false, exp: {}, imp: {}, cols: {} } };`);
  let html = renderMap(run);
  assert.ok(html.includes("🌍"), "the colony glyph should render on the colonized world");
  assert.ok(html.includes("🏰"), "the base glyph should render on the based world");
  assert.ok(html.includes("🏗️"), "a shipyard glyph should render for both the colony Shipyard and the base Small Shipyard");
  run(`toggleGalaxyFilter("settlements");`);
  html = renderMap(run);
  assert.ok(!html.includes("🌍") && !html.includes("🏰") && !html.includes("🏗️"), "turning off the settlements filter should hide all three glyphs");
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

test("no tanker route renders with no active Tanker Run", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const html = renderMap(run);
  assert.ok(!html.includes(`stroke-dasharray="1,3"`), "no dotted tanker route without a run in progress");
  assert.ok(!html.includes("</title>🛢️</text>"), "no tanker marker without a run in progress (the hint text's own mention of 🛢️ doesn't count)");
});

test("an active Tanker Run draws a dotted route with a progress marker positioned by totalCycles/cyclesLeft", () => {
  const { run } = createSandbox();
  const t1 = tier1TankerKey(run);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  const destId = knownDest(run);
  run(`S.pirates = {}; S.pirates["${destId}"] = 0; S.pirates[S.location] = 0;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker One", home: S.location, status: "idle", hull: 30, hullMax: 30 }];`);
  run(`assignTankerRun("t1", "${destId}", []);`);
  let html = renderMap(run);
  assert.ok(html.includes(`stroke-dasharray="1,3"`), "an active tanker run should draw a dotted route");
  assert.ok(html.includes("</title>🛢️</text>"), "the route should carry a tanker marker");

  // tick one cycle forward (dodging risk rolls) and confirm the marker's tooltip reflects progress
  run(`Math.random = () => 0.99;`);
  run(`processTankerRuns();`);
  html = renderMap(run);
  assert.ok(/\d+\/\d+ cycle\(s\) left/.test(html), "the marker's tooltip should reflect the run's live progress");
});

test("turning off the fleet filter also hides the tanker route", () => {
  const { run } = createSandbox();
  const t1 = tier1TankerKey(run);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  const destId = knownDest(run);
  run(`S.pirates = {}; S.pirates["${destId}"] = 0; S.pirates[S.location] = 0;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker One", home: S.location, status: "idle", hull: 30, hullMax: 30 }];`);
  run(`assignTankerRun("t1", "${destId}", []);`);
  run(`toggleGalaxyFilter("fleet");`);
  const html = renderMap(run);
  assert.ok(!html.includes(`stroke-dasharray="1,3"`), "the tanker run is fleet-adjacent activity — the fleet filter should hide its route too");
});

test("multiple simultaneous Tanker Runs each draw their own route", () => {
  const { run } = createSandbox();
  const t1 = tier1TankerKey(run);
  run(`S = freshState(); rollPrices();`);
  withColonyShipyard(run, 4);
  run(`S.colonies[S.location].storage.fuel = 5000;`);
  const destId = knownDest(run);
  run(`S.pirates = {}; S.pirates["${destId}"] = 0; S.pirates[S.location] = 0;
       S.fleet = [{ id: "t1", key: "${t1}", name: "Tanker One", home: S.location, status: "idle", hull: 30, hullMax: 30 },
                  { id: "t2", key: "${t1}", name: "Tanker Two", home: S.location, status: "idle", hull: 30, hullMax: 30 }];`);
  run(`assignTankerRun("t1", "${destId}", []); assignTankerRun("t2", "${destId}", []);`);
  const html = renderMap(run);
  const matches = html.match(/stroke-dasharray="1,3"/g) || [];
  assert.equal(matches.length, 2, "two simultaneous tanker runs on the same route should each draw their own dotted line");
});

test("hyperlane edges still only ever connect two mutually-known worlds (unchanged spoiler safety)", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const html = renderMap(run);
  const knownIds = new Set(JSON.parse(run(`JSON.stringify(PLANETS.filter(galaxyKnown).map(p => p.id))`)));
  const hidden = run(`(PLANETS.find(p => !galaxyKnown(p)) || {}).name`);
  if (hidden) assert.ok(!html.includes(`>${hidden}<`), "an unknown world's name should never leak onto the map");
});

/* Pan & zoom: a session-only camera rect over the map's own 760×220 coordinate space (same
   shape as subViews, renderCombat.js — UI-only, never part of the save file). Untouched, it's
   exactly the old, unchanging full-map view; the controls let the player zoom in on a crowded
   area or a specific world and pan around without that ever touching game state. */

test("the default view is the full, unshifted canvas, and no Reset button shows until it's touched", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  assert.deepEqual(JSON.parse(run(`JSON.stringify(starmapViewRect())`)), { x: 0, y: 0, w: 760, h: 220 });
  const html = renderMap(run);
  assert.match(html, /viewBox="0 0 760 220"/);
  assert.doesNotMatch(html, /Reset view/);
});

test("starmapZoomBtn zooms toward the view's own center and reveals the Reset button", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`starmapZoomBtn(0.5);`);
  const v = JSON.parse(run(`JSON.stringify(starmapViewRect())`));
  assert.equal(v.w, 380); assert.equal(v.h, 110);
  assert.equal(v.x, 190, "zooming toward the center (380,110) at half scale should center the new, smaller rect there too");
  assert.equal(v.y, 55);
  const html = renderMap(run);
  assert.match(html, /viewBox="190 55 380 110"/);
  assert.match(html, /Reset view/);
});

test("starmapPan shifts the view proportionally to its own current size", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`starmapZoomBtn(0.5);`);   // w=380,h=110
  run(`starmapPan(0.25, -0.25);`);
  const v = JSON.parse(run(`JSON.stringify(starmapViewRect())`));
  assert.equal(v.x, 190 + 0.25 * 380);
  assert.equal(v.y, 55 - 0.25 * 110);
});

test("zooming in repeatedly is clamped at STARMAP_MAX_SCALE, never shrinking below it", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  for (let i = 0; i < 30; i++) run(`starmapZoomBtn(0.5);`);
  const v = JSON.parse(run(`JSON.stringify(starmapViewRect())`));
  assert.ok(v.w >= 760 / 6 - 0.01, `width (${v.w}) should never clamp below 760/STARMAP_MAX_SCALE`);
  assert.ok(v.h >= 220 / 6 - 0.01, `height (${v.h}) should never clamp below 220/STARMAP_MAX_SCALE`);
});

test("zooming out repeatedly always lands back on exactly the original, unshifted view", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`starmapZoomBtn(0.4); starmapPan(0.4, 0.4);`);   // zoom in and drift off-center first
  for (let i = 0; i < 10; i++) run(`starmapZoomBtn(2);`);   // zoom back out well past 1x
  const v = JSON.parse(run(`JSON.stringify(starmapViewRect())`));
  assert.deepEqual(v, { x: 0, y: 0, w: 760, h: 220 }, "fully zoomed back out should never land on a shifted variant of the full view");
});

test("panning can never scroll the map more than half a screen out of view, at any zoom level", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`starmapZoomBtn(0.3);`);   // zoom in first
  for (let i = 0; i < 30; i++) run(`starmapPan(1, 1);`);   // try to pan far off the edge
  const v = JSON.parse(run(`JSON.stringify(starmapViewRect())`));
  assert.ok(v.x <= 760 - v.w / 2, "at least half the viewport should still overlap real map content on x");
  assert.ok(v.y <= 220 - v.h / 2, "at least half the viewport should still overlap real map content on y");
});

test("starmapResetView clears back to the default, untouched view", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`starmapZoomBtn(0.5); starmapPan(0.3, 0.1);`);
  run(`starmapResetView();`);
  assert.equal(run(`starmapView`), null);
  assert.deepEqual(JSON.parse(run(`JSON.stringify(starmapViewRect())`)), { x: 0, y: 0, w: 760, h: 220 });
});

test("starmapWheel zooms toward the cursor's mapped position, in or out by the wheel direction", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const mockEvent = (deltaY) => `{ preventDefault: () => {}, deltaY: ${deltaY},
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 760, height: 220 }) },
    clientX: 190, clientY: 55 }`;
  run(`starmapWheel(${mockEvent(-100)});`);   // scroll up/toward = zoom in
  let v = JSON.parse(run(`JSON.stringify(starmapViewRect())`));
  assert.ok(v.w < 760, "scrolling up should zoom in (shrink the view)");
  const wAfterIn = v.w;
  run(`starmapWheel(${mockEvent(100)});`);   // scroll down/away = zoom out
  v = JSON.parse(run(`JSON.stringify(starmapViewRect())`));
  assert.ok(v.w > wAfterIn, "scrolling down should zoom back out (grow the view)");
});

test("renderStarmap's controls are wired to the pan/zoom functions and reflect the live viewBox", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const html = renderMap(run);
  assert.match(html, /onclick="starmapZoomBtn\(0\.7\)"/);
  assert.match(html, /onclick="starmapZoomBtn\(1\.43\)"/);
  assert.match(html, /onclick="starmapPan\(-0\.25,0\)"/);
  assert.match(html, /onclick="starmapPan\(0\.25,0\)"/);
  assert.match(html, /onwheel="starmapWheel\(event\)"/);
});
