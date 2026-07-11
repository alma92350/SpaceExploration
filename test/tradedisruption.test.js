"use strict";
/* "Same logic" as the planetary alert ratchet (test/planetalert.test.js), extended to
   ordinary lane traffic: genPrey()'s haulers/merchants/liners/smugglers AND its patrol
   entry all read the SAME shared S.planetAlert[pid] for strength (raiseLaneAlert,
   combat.js, bumped from raidWinMerchant on every non-pirate lane kill — a smaller
   push than a full planet assault's own, but the same meter, so hunting a world's
   shipping eventually shows up as the same 🚨 alert reading a direct assault would).
   On top of that shared meter, each kill also disrupts the SPECIFIC trade the ship
   carried: S.tradeDisruption[pid][commodityId] (0-100, its own slow decay), scoped
   price bumps rather than a blanket war-economy tax. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function cacheGetElementById(run) {
  run(`const _elCache = {}; const _origGetById = document.getElementById.bind(document);
       document.getElementById = id => _elCache[id] || (_elCache[id] = _origGetById(id));`);
}

test("genPrey's strength scales with the SAME planetAlertMul the planet-assault defenses use", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); globalThis.__pid = currentPlanet().id;`);
  run(`Math.random = () => 0.5;`);
  const calm = JSON.parse(run(`JSON.stringify(genPrey())`));
  run(`S.planetAlert[__pid] = PLANET_ALERT_MAX; Math.random = () => 0.5;`);
  const hot = JSON.parse(run(`JSON.stringify(genPrey())`));
  assert.equal(hot.type, calm.type, "pinned RNG must pick the identical prey archetype both times");
  assert.ok(hot.strength > calm.strength * 1.5, `a fully-alarmed world's lane traffic must hit far harder (calm=${calm.strength}, hot=${hot.strength})`);
});

test("raidWinMerchant raises the shared planetAlert by PREY_ALERT_GAIN -- a fraction of a full assault's own gain", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    globalThis.__pid = PLANETS.find(p => p.faction).id;
    S.location = __pid;
    globalThis.__prey = { faction: currentPlanet().faction, cargo: { ore: 10, metals: 4 }, credits: 100, wantedGain: 5 };
  `);
  assert.equal(run(`planetAlertLevel(__pid)`), 0);
  run(`raidWinMerchant(__prey, false);`);
  assert.equal(run(`planetAlertLevel(__pid)`), run(`PREY_ALERT_GAIN`));
  assert.ok(run(`PREY_ALERT_GAIN`) < run(`PLANET_ALERT_GAIN_ASSAULT`) / 2, "one lane kill must move the shared meter far less than a full assault");
});

test("raidWinMerchant disrupts exactly the commodities the defeated ship carried, and leaves everything else alone", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    globalThis.__pid = PLANETS.find(p => p.faction).id;
    S.location = __pid;
    globalThis.__prey = { faction: currentPlanet().faction, cargo: { ore: 15, metals: 6 }, credits: 100, wantedGain: 5 };
  `);
  run(`raidWinMerchant(__prey, false);`);
  assert.equal(run(`tradeDisruptionLevel(__pid, "ore")`), run(`TRADE_DISRUPT_GAIN`));
  assert.equal(run(`tradeDisruptionLevel(__pid, "metals")`), run(`TRADE_DISRUPT_GAIN`));
  assert.equal(run(`tradeDisruptionLevel(__pid, "luxury")`), 0, "a good this ship never carried must be untouched");
  assert.equal(run(`tradeDisruptionLevel(__pid, "spice")`), 0);
});

test("raiseTradeDisruption/tradeDisruptionLevel/tradeDisruptionMul: gain accumulates, clamps at TRADE_DISRUPT_MAX, and scales the price up to +60%", () => {
  const { run } = createSandbox();
  run(`S = freshState(); globalThis.__pid = PLANETS.find(p => p.faction).id;`);
  assert.equal(run(`tradeDisruptionLevel(__pid, "ore")`), 0);
  assert.equal(run(`tradeDisruptionMul(__pid, "ore")`), 1);
  run(`raiseTradeDisruption(__pid, "ore", TRADE_DISRUPT_GAIN);`);
  assert.equal(run(`tradeDisruptionLevel(__pid, "ore")`), run(`TRADE_DISRUPT_GAIN`));
  run(`raiseTradeDisruption(__pid, "ore", 100000);`);
  assert.equal(run(`tradeDisruptionLevel(__pid, "ore")`), run(`TRADE_DISRUPT_MAX`), "must clamp, never exceed the max");
  assert.equal(run(`tradeDisruptionMul(__pid, "ore")`), 1.6);
});

test("processTradeDisruption decays far slower than the gain and cleans up empty entries without disturbing other worlds/goods", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.ok(run(`TRADE_DISRUPT_DECAY`) < run(`TRADE_DISRUPT_GAIN`) / 10, "decay must be an order of magnitude gentler than the gain -- the same asymmetric ratchet as planet alert");
  run(`
    globalThis.__pidA = PLANETS.find(p => p.faction).id;
    globalThis.__pidB = PLANETS.find(p => p.faction && p.id !== __pidA).id;
    raiseTradeDisruption(__pidA, "ore", 3);        // just above one decay tick
    raiseTradeDisruption(__pidA, "metals", 50);    // comfortably above one tick
    raiseTradeDisruption(__pidB, "spice", 50);      // a different world entirely -- must be untouched by pidA's cleanup
  `);
  run(`processTradeDisruption();`);
  assert.equal(run(`Math.round(tradeDisruptionLevel(__pidA, "metals") * 100)`), Math.round((50 - run(`TRADE_DISRUPT_DECAY`)) * 100));
  assert.equal(run(`tradeDisruptionLevel(__pidB, "spice")`), 50 - run(`TRADE_DISRUPT_DECAY`));
  run(`S.tradeDisruption[__pidA]["ore"] = TRADE_DISRUPT_DECAY / 2;`);   // less than one tick left
  run(`processTradeDisruption();`);
  assert.equal(run(`tradeDisruptionLevel(__pidA, "ore")`), 0);
  assert.equal(run(`Object.prototype.hasOwnProperty.call(S.tradeDisruption[__pidA], "ore")`), false, "a fully-recovered good must not leave clutter");
  assert.ok(run(`tradeDisruptionLevel(__pidB, "spice")`) > 0, "an unrelated world's own disruption must be unaffected by pidA's processing");
});

test("rollPrices prices a specifically-disrupted good higher, while an unrelated good at the same world is untouched", () => {
  const { run } = createSandbox();
  run(`S = freshState(); globalThis.__pid = PLANETS.find(p => p.faction).id; Math.random = () => 0.5;`);
  run(`rollPrices();`);
  const calmOre = run(`S.prices[__pid].ore`), calmSpice = run(`S.prices[__pid].spice`);
  run(`S.prices = {}; raiseTradeDisruption(__pid, "ore", TRADE_DISRUPT_MAX); Math.random = () => 0.5;`);
  run(`rollPrices();`);
  const hotOre = run(`S.prices[__pid].ore`), hotSpice = run(`S.prices[__pid].spice`);
  assert.ok(hotOre > calmOre, `ore must price higher once its carriers have been raided (calm=${calmOre}, hot=${hotOre})`);
  assert.equal(hotSpice, calmSpice, "an unrelated good must not move just because ore's supply was hit");
});

test("Market tab flags a specifically-disrupted commodity with a 🚨 disrupted pill, and leaves an undisrupted one alone", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  cacheGetElementById(run);
  run(`renderMarket();`);
  let html = run(`document.getElementById("panel-market").innerHTML`);
  assert.doesNotMatch(html, /disrupted/, "a calm world's market must show no disruption pill at all");
  run(`raiseTradeDisruption(currentPlanet().id, "metals", TRADE_DISRUPT_GAIN);`);
  run(`renderMarket();`);
  html = run(`document.getElementById("panel-market").innerHTML`);
  const metalsRow = html.match(/<td>⛓️ Metals[^]*?<\/tr>/);
  assert.ok(metalsRow && /🚨 disrupted/.test(metalsRow[0]), "metals must be flagged once disrupted");
  const oreRow = html.match(/<td>🪨 Ore[^]*?<\/tr>/);
  assert.ok(oreRow && !/disrupted/.test(oreRow[0]), "ore must stay unflagged since only metals was hit");
});
