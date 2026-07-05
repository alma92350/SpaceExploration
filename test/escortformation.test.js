"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* Escort convoy combat gets the same Vanguard/Line/Reserve tiering the Raid tab's Battle
   Group already has (FORMATION_SLOTS/FORMATION_TIERS/shipFormation, fleet.js, reused as-is):
   the player decides which hulls take the hits (front tier absorbs the brunt of fire),
   which do the bulk of the damage (Line, the highest fpMult), and which sit safely out of
   the way (Reserve — freighters default here). Existing per-foe role preference (raider
   wants a freighter, etc.) still applies, but only WITHIN whichever pool tiering exposes
   that round, replacing the old probabilistic Screen-posture body-block. */

function startEscort(run) { run(`refreshEscortOffers(); acceptEscort(0);`); }

test("buildEscortFleet defaults freighters to reserve and the flagship/escorts to line", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  startEscort(run);
  const roles = JSON.parse(run(`JSON.stringify(S.escort.fleet.map(s => ({ role: s.role, formation: s.formation })))`));
  roles.forEach(s => assert.equal(s.formation, s.role === "freighter" ? "reserve" : "line", `${s.role} should default to ${s.role === "freighter" ? "reserve" : "line"}`));
});

test("setEscortFormation reassigns a ship by fleet index, and ignores an invalid index or slot", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  startEscort(run);
  run(`setEscortFormation(0, "vanguard");`);
  assert.equal(run(`S.escort.fleet[0].formation`), "vanguard");
  run(`setEscortFormation(0, "nonsense");`);
  assert.equal(run(`S.escort.fleet[0].formation`), "vanguard", "an invalid slot should be a no-op");
  const before = run(`JSON.stringify(S.escort.fleet)`);
  run(`setEscortFormation(99, "line");`);
  assert.equal(run(`JSON.stringify(S.escort.fleet)`), before, "an out-of-range index should be a no-op");
});

test("escortFrontTier falls through vanguard -> line -> reserve as each tier empties, and is empty only when the whole fleet is dead", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  startEscort(run);
  // default: vanguard empty, line holds (flagship + escorts) -> front tier is line
  assert.equal(run(`escortFrontTier().every(s => shipFormation(s) === "line")`), true);
  assert.ok(run(`escortFrontTier().length`) > 0);
  // give it a vanguard -> that becomes front
  run(`setEscortFormation(0, "vanguard");`);
  assert.equal(run(`escortFrontTier().every(s => shipFormation(s) === "vanguard")`), true);
  // kill the vanguard occupant (flagship) -> falls back to line
  run(`S.pirate.hull = 0;`);
  assert.equal(run(`escortFrontTier().every(s => shipFormation(s) === "line")`), true);
  // kill everyone but a reserve freighter -> falls back to reserve
  run(`S.escort.fleet.forEach(s => { if (s.role !== "flagship") s.alive = false; }); S.escort.fleet[3].alive = true;`);
  assert.equal(run(`escortFrontTier().every(s => shipFormation(s) === "reserve")`), true);
  // kill absolutely everyone -> empty
  run(`S.escort.fleet.forEach(s => { s.alive = false; });`);
  assert.equal(run(`escortFrontTier().length`), 0);
});

test("chooseIntent only ever targets the front tier on the 85% branch, and the whole alive fleet on the 15% stray branch", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  startEscort(run);
  run(`setEscortFormation(1, "vanguard");`);   // one escort tanks; everyone else (line/reserve) should be unreachable on the 85% branch
  const frontIdx = JSON.parse(run(`JSON.stringify(S.escort.fleet.map((s,i)=>i).filter(i => shipFormation(S.escort.fleet[i]) === "vanguard"))`));
  run(`Math.random = () => 0.01;`);   // forces the front-tier branch (< 0.85)
  for (let i = 0; i < 15; i++) {
    const idx = run(`chooseIntent({ role: "raider" })`);
    assert.ok(frontIdx.includes(idx), `front-tier branch picked index ${idx}, expected one of ${frontIdx}`);
  }
  run(`Math.random = () => 0.99;`);   // forces the stray branch (>= 0.85) every time
  // a raider (prefers a freighter) can only reach the 2 freighters — both sit in Reserve,
  // outside the lone-escort Vanguard front tier — proving the stray branch truly ignores tiering
  // (pinning Math.random to a single value also pins the within-pool random pick, so this only
  // asserts reachability outside the front tier, not which specific freighter gets chosen)
  for (let i = 0; i < 5; i++) {
    const idx = run(`chooseIntent({ role: "raider" })`);
    assert.ok(!frontIdx.includes(idx), `a raider on the stray branch should reach a freighter, not the vanguard escort (got index ${idx})`);
  }
});

test("chooseIntent still applies role preference within whatever pool is exposed", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  startEscort(run);
  // put a freighter in the front-exposed tier alongside an escort, force the front-tier branch,
  // and confirm a raider (prefers freighters) always picks the freighter over the escort when both are exposed
  run(`setEscortFormation(1, "vanguard"); setEscortFormation(3, "vanguard");`);   // one escort (idx1) + one freighter (idx3)
  run(`Math.random = () => 0.01;`);
  for (let i = 0; i < 15; i++) {
    assert.equal(run(`S.escort.fleet[chooseIntent({ role: "raider" })].role`), "freighter");
  }
});

test("escShipFP scales by the ship's own formation tier: line > vanguard > reserve, all else equal", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  startEscort(run);
  const fpAt = (tier) => { run(`S.escort.fleet[0].formation = "${tier}";`); return run(`escShipFP(S.escort.fleet[0])`); };
  const line = fpAt("line"), vanguard = fpAt("vanguard"), reserve = fpAt("reserve");
  assert.ok(line > vanguard && vanguard > reserve, `expected line (${line}) > vanguard (${vanguard}) > reserve (${reserve})`);
  assert.equal(Math.round((line / reserve) * 1000), Math.round((run(`FORMATION_SLOTS.line.fpMult`) / run(`FORMATION_SLOTS.reserve.fpMult`)) * 1000));
});

test("renderEscort shows each ship's formation badge and move buttons, and clicking a move button updates the badge", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`const _c = {}; const _o = document.getElementById.bind(document);
       document.getElementById = id => _c[id] || (_c[id] = _o(id));`);
  startEscort(run);
  run(`renderEscort();`);
  let html = run(`document.getElementById("panel-escort").innerHTML`);
  assert.match(html, /🌌 Reserve/, "a freighter's Reserve badge should render");
  assert.match(html, /setEscortFormation\(0,'vanguard'\)/, "a move-to-Vanguard button should render for the flagship");
  run(`setEscortFormation(0, "vanguard");`);
  run(`renderEscort();`);
  html = run(`document.getElementById("panel-escort").innerHTML`);
  assert.match(html, /setEscortFormation\(0,'line'\)/, "the flagship should now offer a move back to Line instead");
});
