"use strict";
/* Defense slice: player Bases gain the same per-cycle raid exposure Colonies already
   had (colonization.js's colonyEventRoll), via a new baseRaidRoll — same odds/shape,
   scaled to a base's own numbers (no happiness/pop to hook into, so the credit loss
   scales off total module tiers built instead). Both raid paths now attribute the
   attack to a real pirateBands.js band (pickRaidBand) whenever one's a fit, instead of
   always the old faceless "Pirates" — tests pin Math.random so the raid roll, the
   repel roll and pickRaidBand's own weighted pick are all deterministic. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function freshBase(run, overrides) {
  run(`S.bases[S.location] = Object.assign({ modules: {}, storage: {}, trade: { on: false, exp: {}, imp: {}, cols: {} } }, ${JSON.stringify(overrides || {})});`);
}

test("baseDefense reflects the garrison module's tier, zero when unbuilt", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshBase(run, {});
  assert.equal(run(`baseDefense(S.bases[S.location])`), 0);
  run(`S.bases[S.location].modules.garrison = 4;`);
  assert.equal(run(`baseDefense(S.bases[S.location])`), 4);
});

test("pickRaidBand excludes friendly/sworn bands and busy ones, returning null when nothing is eligible", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.pirateBands = {};`);
  assert.equal(run(`pickRaidBand()`), null, "no bands at all -> null");

  run(`const f = newBand(2); f.rep = 60;`);   // friendly tier
  assert.equal(run(`pickRaidBand()`), null, "a friendly band must never be picked as a raider");

  run(`
    S.pirateBands = {};
    const h = newBand(2); h.rep = -50; h.busyUntil = S.turn + 3;
  `);   // hostile, but tied up
  assert.equal(run(`pickRaidBand()`), null, "a busy band must not be picked either");
});

test("pickRaidBand is deterministic given rand, and weights the pick toward the lower-rep band", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); S.pirateBands = {};
    const a = newBand(2); a.rep = -80;   // weight 60-(-80) = 140
    const b = newBand(2); b.rep = 0;     // weight 60-0 = 60
    globalThis.__a = a; globalThis.__b = b;
  `);
  // total weight 200; a occupies [0, 140/200=0.7), b occupies [0.7, 1]
  assert.equal(run(`pickRaidBand(0.69).id`), run(`__a.id`), "just below the boundary must land on the heavier-weighted band");
  assert.equal(run(`pickRaidBand(0.71).id`), run(`__b.id`), "just above the boundary must land on the other band");
});

test("baseRaidRoll: pirateCalm suppresses a raid entirely, no loss", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshBase(run, { storage: { metals: 100 } });
  run(`S.pirateCalm = S.turn + 5; S.res.credits = 3000; Math.random = () => 0;`);
  run(`baseRaidRoll(S.location, S.bases[S.location], currentPlanet());`);
  assert.equal(run(`S.bases[S.location].storage.metals`), 100, "pirateCalm must block the raid outright");
  assert.equal(run(`S.res.credits`), 3000);
  assert.match(run(`S.log[0].msg`), /kept clear/);
});

test("baseRaidRoll: a strong garrison repels the raid, no loss", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshBase(run, { modules: { garrison: 5 }, storage: { metals: 100 } });
  run(`Math.random = () => 0;`);   // satisfies both the 7% raid roll and (0 < 5*0.30) the repel roll
  run(`baseRaidRoll(S.location, S.bases[S.location], currentPlanet());`);
  assert.equal(run(`S.bases[S.location].storage.metals`), 100);
  assert.match(run(`S.log[0].msg`), /repelled/);
});

test("baseRaidRoll: an undefended base loses a quarter of every stored good and a module-scaled credit sum", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshBase(run, { modules: { warehouse: 3 }, storage: { metals: 100, energy: 40 } });
  run(`S.res.credits = 5000; Math.random = () => 0;`);
  run(`baseRaidRoll(S.location, S.bases[S.location], currentPlanet());`);
  assert.equal(run(`S.bases[S.location].storage.metals`), 75, "25% of 100 must be looted");
  assert.equal(run(`S.bases[S.location].storage.energy`), 30, "25% of 40 must be looted");
  assert.equal(run(`S.res.credits`), 5000 - (3 + 1) * 60, "credit loss scales off total module tiers (3) + 1, at 60/tier");
  assert.match(run(`S.log[0].msg`), /raided/);
});

test("baseRaidRoll: credit loss never exceeds what the player actually has", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshBase(run, { modules: { warehouse: 5, solar: 5 }, storage: { metals: 40 } });
  run(`S.res.credits = 10; Math.random = () => 0;`);
  run(`baseRaidRoll(S.location, S.bases[S.location], currentPlanet());`);
  assert.equal(run(`S.res.credits`), 0, "credit loss must clamp to what the player has, never go negative");
});

test('baseRaidRoll names a real band in the log when one is eligible, and falls back to "Pirates" when none exist', () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.pirateBands = {};`);
  freshBase(run, { storage: { metals: 40 } });
  run(`
    const h = newBand(2); h.rep = -60;
    globalThis.__h = h;
    Math.random = () => 0;
  `);
  run(`baseRaidRoll(S.location, S.bases[S.location], currentPlanet());`);
  assert.ok(run(`S.log[0].msg`).includes(run(`__h.name`)), "the raid log should name the actual attacking band");

  // fresh run, no bands at all this time -- must fall back to the old faceless phrasing
  const { run: run2 } = createSandbox();
  run2(`S = freshState();`);
  freshBase(run2, { storage: { metals: 40 } });
  run2(`Math.random = () => 0;`);
  run2(`baseRaidRoll(S.location, S.bases[S.location], currentPlanet());`);
  assert.match(run2(`S.log[0].msg`), /^🏴‍☠️ Pirates raided/);
});

test("processBases rolls baseRaidRoll for every base it processes", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshBase(run, { storage: { metals: 40 } });
  run(`Math.random = () => 0;`);
  run(`processBases();`);
  assert.equal(run(`S.bases[S.location].storage.metals`), 30, "a raid rolled from inside processBases must actually apply (25% of 40)");
});

test("colonyEventRoll's raid branch also names a real band when one is eligible", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.colonies[S.location] = { pop: 20, happiness: 70, tax: 0, buildings: {}, storage: { metals: 40 }, orders: {}, unrest: 0, faction: null, idle: {} };
    S.pirateBands = {};
    const h = newBand(2); h.rep = -60;
    globalThis.__h = h;
    Math.random = () => 0;
  `);
  run(`colonyEventRoll(S.location, S.colonies[S.location], currentPlanet());`);
  assert.ok(run(`S.log[0].msg`).includes(run(`__h.name`)), "colony raids should also name the actual attacking band now");
});

test("renderBases doesn't throw with a garrison module at various tiers, and shows the defense stat", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  freshBase(run, {});
  // this sandbox's document.getElementById hands back a fresh stub every call, so cache it
  // (same shim test/pirateChat.test.js's Escort render test uses) to read back what renderBases() wrote
  run(`const _c = {}; const _o = document.getElementById.bind(document);
       document.getElementById = id => _c[id] || (_c[id] = _o(id));`);
  assert.doesNotThrow(() => run(`renderBases()`));
  assert.match(run(`document.getElementById("panel-bases").innerHTML`), /undefended/);

  run(`S.bases[S.location].modules.garrison = 3;`);
  assert.doesNotThrow(() => run(`renderBases()`));
  assert.match(run(`document.getElementById("panel-bases").innerHTML`), /Level 3/);

  run(`S.bases[S.location].modules.garrison = 5;`);   // maxed tier
  assert.doesNotThrow(() => run(`renderBases()`));
});
