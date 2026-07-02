"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* Plasma torpedoes end-to-end: the hold-stock bug (an undefined/NaN S.res entry
   from a pre-plasmatorp save let the market pay out for torpedoes you didn't
   have, and swallowed the ones you produced), the new Plasma Torpedoes weapon,
   the new Torpedo Works colony line, and the base<->colony trade plumbing —
   which must treat torpedoes exactly like antimatter (both tier "Strategic"). */

test("sell refuses a commodity whose hold entry is undefined (pre-plasmatorp save)", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); delete S.res.plasmatorp;`);
  const credits = run(`S.res.credits`);
  run(`sell("plasmatorp", 5);`);
  assert.equal(run(`S.res.credits`), credits, "selling torpedoes you don't even have an entry for must not pay out");
  assert.notEqual(run(`typeof S.res.plasmatorp`), "number", "the refused sale must not touch the missing entry");
});

test("sell still refuses at zero stock and still works with real stock", () => {
  const { run } = createSandbox();
  // dock somewhere torpedoes are legal, or customs may (rightly) confiscate the test's wares
  run(`S = freshState(); S.location = PLANETS.find(p => !isIllegalAt("plasmatorp", p.id)).id; rollPrices();`);
  const credits = run(`S.res.credits`);
  run(`sell("plasmatorp", 1);`);
  assert.equal(run(`S.res.credits`), credits, "zero stock should refuse");
  run(`S.res.plasmatorp = 3; sell("plasmatorp", 2);`);
  assert.equal(run(`S.res.plasmatorp`), 1, "a real sale should deduct stock");
  assert.ok(run(`S.res.credits`) > credits, "a real sale should pay");
});

test("init()'s load migration backfills missing commodities and repairs NaN stocks", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.turn = 42; delete S.res.plasmatorp; S.res.antimatter = NaN; saveGame();`);
  run(`window._listeners["DOMContentLoaded"]();`);   // real init() path: loadGame + migrate
  assert.equal(run(`S.turn`), 42, "init should have loaded the save, not started fresh");
  assert.equal(run(`S.res.plasmatorp`), 0, "a commodity missing from the save should be backfilled to 0");
  assert.equal(run(`S.res.antimatter`), 0, "a NaN-corrupted stock should be repaired to 0");
});

test("produce() fills the hold even when the output entry is missing from the save", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.antimatter = true;
       delete S.res.plasmatorp;
       S.res.antimatter = 5; S.res.alloys = 10; S.res.radioactives = 10;`);
  run(`produce("plasmafab");`);
  assert.ok(run(`S.res.plasmatorp`) >= 1, "industry output must land in the hold, not vanish into NaN");
  assert.ok(Number.isFinite(run(`S.res.plasmatorp`)), "the stock must be a real number");
});

test("the Plasma Torpedoes weapon follows the antimatter schema: tech-gated, hold ammo", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`weaponAvailable("plasma")`), false, "locked until the Antimatter Containment tech");
  run(`S.techs.antimatter = true;`);
  assert.equal(run(`weaponAvailable("plasma")`), true);
  assert.equal(run(`weaponAffordable("plasma")`), false, "no torpedoes in the hold — can't fire");
  run(`S.res.plasmatorp = 2;`);
  assert.equal(run(`weaponAffordable("plasma")`), true);
  run(`payAmmo("plasma");`);
  assert.equal(run(`S.res.plasmatorp`), 1, "each shot consumes one torpedo from the hold");
});

test("Plasma Torpedoes out-hit the Antimatter Warhead raw, but point-defense counters them", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.techs.antimatter = true;`);
  assert.ok(run(`WEAPONS.plasma.mult`) > run(`WEAPONS.antimatter.mult`), "the pricier munition should hit harder");
  const vsNaked = run(`weaponEff("plasma", { def: { armor: 0, shield: 0, pd: 0 } })`);
  const vsFlak = run(`weaponEff("plasma", { def: { armor: 0, shield: 0, pd: 3 } })`);
  assert.ok(vsFlak < vsNaked, "point-defense should thin plasma torpedoes");
  const amVsFlak = run(`weaponEff("antimatter", { def: { armor: 3, shield: 3, pd: 3 } })`);
  assert.equal(amVsFlak, run(`WEAPONS.antimatter.mult`), "the warhead stays uncounterable — plasma doesn't obsolete it");
});

test("a Torpedo Works colony builds and manufactures plasma torpedoes from antimatter", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.techs.antimatter = true; S.res.credits = 100000;
       S.res.metals = 500; S.res.electronics = 500;
       S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: { habitat: 2 }, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`buildColonyBuilding("torpedo_works");`);
  assert.equal(run(`S.colonies[S.location].buildings.torpedo_works`), 1, "the building should stand once bought");
  run(`const col = S.colonies[S.location];
       col.storage.antimatter = 4; col.storage.alloys = 8; col.storage.radioactives = 8; col.storage.biomass = 50;`);
  run(`processColonies();`);
  assert.ok(run(`S.colonies[S.location].storage.plasmatorp || 0`) >= 1, "the works should turn antimatter + alloys + radioactives into torpedoes");
  assert.ok(run(`S.colonies[S.location].storage.antimatter`) < 4, "inputs should be consumed");
});

test("a colony with both a Forge and a Works cascades relics → antimatter → torpedoes in one cycle", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.techs.antimatter = true;
       S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10,
         buildings: { habitat: 2, antimatter_forge: 1, torpedo_works: 1 }, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
       const col = S.colonies[S.location];
       col.storage.relics = 4; col.storage.electronics = 4; col.storage.energy = 8;
       col.storage.alloys = 4; col.storage.radioactives = 4; col.storage.biomass = 50;`);
  run(`processColonies();`);
  assert.ok(run(`S.colonies[S.location].storage.plasmatorp || 0`) >= 1,
    "stage ordering (forge 5 → works 6) should let fresh antimatter feed the torpedo line the same cycle");
});

test("base<->colony trade treats plasma torpedoes exactly like antimatter", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`baseImportable("plasmatorp")`), run(`baseImportable("antimatter")`), "both Strategic goods should be base-importable");
  assert.equal(run(`baseImportable("plasmatorp")`), true);
  assert.equal(run(`STORE_IDS.includes("plasmatorp")`), true, "torpedoes must live in base/colony storage like any commodity");
});

test("a base trade route imports a colony's torpedo surplus into base storage", () => {
  const { run } = createSandbox();
  run(`S = freshState();
       const cid = Object.keys(currentPlanet().distances)[0];
       S.bases[S.location] = { modules: { warehouse: 2 }, storage: {}, trade: { on: true, exp: {}, imp: {}, cols: {} } };
       S.colonies[cid] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: { plasmatorp: 6 }, orders: {}, unrest: 0, faction: null, idle: {} };
       // torpedoes are contraband on many worlds — pin the RNG above the 18% seize
       // roll so this covers the freight plumbing, not customs luck
       const _r = Math.random; Math.random = () => 0.9;
       try { runBaseImport(S.colonies[cid], cid, PLANETS.find(p => p.id === cid)); } finally { Math.random = _r; }`);
  assert.equal(run(`S.bases[S.location].storage.plasmatorp || 0`), 6, "the whole unreserved surplus should ship to the base");
  assert.equal(run(`S.colonies[Object.keys(currentPlanet().distances)[0]].storage.plasmatorp`), 0);
});
