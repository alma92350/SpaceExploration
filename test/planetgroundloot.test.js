"use strict";
/* Sacking a planet (raidWinPlanet) now hauls real cargo out of its warehouses too, not
   just credits: planetLootMix (combat.js) picks a mix weighted toward the world's own
   deposits (always eligible -- the most obviously "theirs") plus a general spread scaled
   by industry+tech, and planetRaidGoods actually loads it into S.res, respecting the same
   loot-share split and cargo-room cap every other plunder in the game already respects
   (plunder(), raiding.js). Independent of, and on top of, the existing credit haul
   (planetRaidHaul). */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("planetLootMix always includes the planet's own deposits, plus more general goods on a more developed world", () => {
  const { run } = createSandbox();
  run(`S = freshState(); Math.random = () => 0.5;`);
  const poor = JSON.parse(run(`JSON.stringify(planetLootMix({ deposits: { ore: 2 }, industry: 1, tech: 1 }))`));
  run(`Math.random = () => 0.5;`);
  const rich = JSON.parse(run(`JSON.stringify(planetLootMix({ deposits: { ore: 2 }, industry: 10, tech: 10 }))`));
  assert.ok(poor.includes("ore"), "the world's own deposit must always be eligible, even a poor world's");
  assert.ok(rich.includes("ore"));
  assert.ok(rich.length > poor.length, `a more developed world must offer a wider mix (poor=${poor.length}, rich=${rich.length})`);
  assert.equal(new Set(rich).size, rich.length, "no duplicate commodities in the mix");
});

test("planetLootMix still offers a mix on a world with no charted deposits at all", () => {
  const { run } = createSandbox();
  run(`S = freshState(); Math.random = () => 0.5;`);
  const mix = JSON.parse(run(`JSON.stringify(planetLootMix({ deposits: {}, industry: 5, tech: 5 }))`));
  assert.ok(mix.length > 0, "even with no deposits, general trade goods should still yield SOME mix");
});

test("planetRaidGoods actually loads cargo into S.res, includes the world's own deposit, and scales down with a smaller loot share", () => {
  const { run } = createSandbox();
  run(`S = freshState(); Math.random = () => 0.5;`);
  const full = JSON.parse(run(`JSON.stringify(planetRaidGoods({ deposits: { ore: 2 }, industry: 5, tech: 5 }, 1))`));
  assert.ok(Object.keys(full).length > 0, "a full-share sack must actually haul something");
  assert.ok(full.ore > 0, "the world's own deposit good must be among what's hauled");
  assert.equal(run(`S.res.ore`), full.ore, "the loot must actually land in S.res, not just be reported");

  run(`S = freshState(); Math.random = () => 0.5;`);
  const halfShare = JSON.parse(run(`JSON.stringify(planetRaidGoods({ deposits: { ore: 2 }, industry: 5, tech: 5 }, 0.5))`));
  assert.ok(halfShare.ore < full.ore, `a smaller loot share (allies cutting in) must haul proportionally less (full=${full.ore}, half=${halfShare.ore})`);
});

test("planetRaidGoods never exceeds available cargo room, and yields nothing once the hold is already full", () => {
  const { run } = createSandbox();
  run(`S = freshState(); Math.random = () => 0.5;`);
  const cap = run(`cargoCap()`);
  run(`S.res.ore = ${cap - 5};`);   // only 5 units of room left, whatever else is looted
  const goods = JSON.parse(run(`JSON.stringify(planetRaidGoods({ deposits: { ore: 2, metals: 1 }, industry: 8, tech: 8 }, 1))`));
  const totalLooted = Object.values(goods).reduce((s, q) => s + q, 0);
  assert.ok(totalLooted <= 5, `looted total (${totalLooted}) must never exceed the 5 units of room actually available`);

  run(`S = freshState(); Math.random = () => 0.5; S.res.ore = cargoCap();`);   // completely full
  const none = JSON.parse(run(`JSON.stringify(planetRaidGoods({ deposits: { ore: 2 }, industry: 8, tech: 8 }, 1))`));
  assert.equal(Object.keys(none).length, 0, "a completely full hold must yield nothing further");
});

test("raidWinPlanet hauls a mix of real cargo into your hold, on top of the existing credit haul, and logs it", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    globalThis.__target = PLANETS.find(p => p.faction && p.deposits && Object.keys(p.deposits).length > 0);
    globalThis.__depositGood = Object.keys(__target.deposits)[0];
    globalThis.__prey = {
      isPlanetRaid: true, planetId: __target.id, planetName: __target.name,
      name: __target.name + " Ground Garrison", ico: "🏰", faction: __target.faction,
      cargo: {}, credits: 0, strength: 40, wantedGain: 40,
    };
    globalThis.__before = S.res[__depositGood] || 0;
    globalThis.__creditsBefore = S.res.credits;
  `);
  run(`raidWinPlanet(__prey, false);`);
  assert.ok(run(`S.res[__depositGood]`) > run(`__before`), "sacking the surface must haul some of the world's own deposit good into the hold");
  assert.ok(run(`S.res.credits`) > run(`__creditsBefore`), "the credit haul must still be paid on top, unchanged in kind");
  assert.ok(run(`S.log.some(l => /hauled from its warehouses/.test(l.msg))`), "the log must mention the cargo haul");
});

test("raidWinPlanet gracefully omits the cargo clause (log and toast) when the hold is already completely full", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    globalThis.__target = PLANETS.find(p => p.faction);
    globalThis.__prey = {
      isPlanetRaid: true, planetId: __target.id, planetName: __target.name,
      name: __target.name + " Ground Garrison", ico: "🏰", faction: __target.faction,
      cargo: {}, credits: 0, strength: 40, wantedGain: 40,
    };
    S.res.ore = cargoCap();   // stuff the hold completely full first, regardless of what this world deposits
  `);
  run(`raidWinPlanet(__prey, false);`);
  assert.ok(run(`S.log.some(l => /sacked the surface/.test(l.msg))`), "the sack itself must still be logged");
  assert.ok(!run(`S.log.some(l => /hauled from its warehouses/.test(l.msg))`), "a full hold must not falsely claim cargo was hauled");
});
