"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* The Deep-space chart — a fourth pirate-intel tier covering the frontier ring.
   Edge worlds keep `hidden: true` forever (visibility flows through S.discovered),
   so the ordinary charts' `!p.hidden` filter can never include them; this tier
   fills that gap, and only goes on sale once the first edge world is found. */

function setup(run) {
  run(`S = freshState(); generateFrontierRing(); rollPrices();`);   // same order as init(): the ring exists before prices roll
}
function firstFrontierId(run) { return run(`PLANETS.find(p => p.frontier).id`); }

test("edgeIntelUnlocked flips only once a frontier world is actually discovered", () => {
  const { run } = createSandbox();
  setup(run);
  assert.equal(run(`edgeIntelUnlocked()`), false, "nothing discovered yet");
  const fid = firstFrontierId(run);
  run(`S.discovered["${fid}"] = true;`);
  assert.equal(run(`edgeIntelUnlocked()`), true);
});

test("discovering a charted (non-frontier) hidden world does NOT unlock the tier", () => {
  const { run } = createSandbox();
  setup(run);
  run(`const hid = PLANETS.find(p => p.hidden && !p.frontier); if (hid) S.discovered[hid.id] = true;`);
  assert.equal(run(`edgeIntelUnlocked()`), false, "the gate is the frontier ring specifically, not any hidden world");
});

test("buyPirateMap refuses the Deep-space chart before any edge world is discovered", () => {
  const { run } = createSandbox();
  setup(run);
  run(`S.res.credits = 100000;`);
  run(`buyPirateMap("deepspace");`);
  assert.equal(run(`S.pirateIntel`), null, "no intel should be granted");
  assert.equal(run(`S.res.credits`), 100000, "no credits should be spent");
});

test("the Sector chart still excludes edge worlds even after discovery — the gap the new tier fills", () => {
  const { run } = createSandbox();
  setup(run);
  const fid = firstFrontierId(run);
  run(`S.discovered["${fid}"] = true; S.res.credits = 100000;`);
  run(`buyPirateMap("global");`);
  assert.equal(run(`S.pirateIntel.worlds.includes("${fid}")`), false, "ordinary charts stop at the charted sector");
});

test("the Deep-space chart covers the sector PLUS discovered edge worlds, minus undiscovered ones", () => {
  const { run } = createSandbox();
  setup(run);
  const fid = firstFrontierId(run);
  run(`S.discovered["${fid}"] = true; S.res.credits = 100000;`);
  run(`buyPirateMap("deepspace");`);
  const cost = run(`PIRATE_MAP.deepspace.cost`);
  assert.equal(run(`S.res.credits`), 100000 - cost);
  assert.equal(run(`S.pirateIntel.scope`), "deepspace");
  assert.equal(run(`S.pirateIntel.worlds.includes("${fid}")`), true, "the discovered edge world must be charted");
  assert.equal(run(`pirateIntelKnows("${fid}")`), true, "intel lookups must now know the edge world");
  assert.equal(
    run(`PLANETS.filter(p => isActive(p) && !p.hidden).every(id => S.pirateIntel.worlds.includes(id.id))`),
    true, "everything the Sector chart would cover is included too — a strict superset tier");
  assert.equal(
    run(`PLANETS.filter(p => p.frontier && !S.discovered[p.id]).some(p => S.pirateIntel.worlds.includes(p.id))`),
    false, "edge worlds you haven't found yet stay dark — no intel on uncharted space");
});

test("edge worlds carry real pirate activity for the chart to reveal", () => {
  const { run } = createSandbox();
  setup(run);
  const lvl = run(`Math.max(...PLANETS.filter(p => p.frontier).map(p => pirateLevel(p.id)))`);
  assert.ok(lvl >= 1, "the lawless rim should host actual pirate activity, or the intel would be pointless");
});
