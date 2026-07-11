"use strict";
/* Planetary alert (militarization ratchet): S.planetAlert[pid], a 0-100 meter that
   climbs sharply on every assault (raidPlanet, combat.js) with a further jump on a
   full sack (raidWinPlanet, raiding.js), and only fades slowly at peace
   (processPlanetAlert, raiding.js) — deliberately far gentler than either gain, per
   the design brief ("not with the same rate as defense though"). Three consumers:
   space/ground defense strength & wave size (combat.js), local prices
   (alertPriceMul, pricing.js), and — while hot — the sector's faction relations
   (processPlanetAlert's factionRel nudge). */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("planetAlertLevel defaults to 0; raisePlanetAlert increments and clamps to PLANET_ALERT_MAX", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  run(`globalThis.__pid = PLANETS.find(p => p.faction).id;`);
  assert.equal(run(`planetAlertLevel(__pid)`), 0);
  run(`raisePlanetAlert(__pid, 16);`);
  assert.equal(run(`planetAlertLevel(__pid)`), 16);
  run(`raisePlanetAlert(__pid, 16);`);
  assert.equal(run(`planetAlertLevel(__pid)`), 32);
  run(`raisePlanetAlert(__pid, 1000);`);
  assert.equal(run(`planetAlertLevel(__pid)`), run(`PLANET_ALERT_MAX`), "must clamp, never exceed the max");
});

test("planetAlertMul is 1 at zero alert (no regression) and scales up to +70% fully alarmed", () => {
  const { run } = createSandbox();
  run(`S = freshState(); globalThis.__pid = PLANETS.find(p => p.faction).id;`);
  assert.equal(run(`planetAlertMul(__pid)`), 1);
  run(`raisePlanetAlert(__pid, PLANET_ALERT_MAX);`);
  assert.equal(run(`planetAlertMul(__pid)`), 1.7);
  run(`S.planetAlert[__pid] = 50;`);
  assert.equal(run(`planetAlertMul(__pid)`), 1.35);
});

test("genPlanetPatrol and genPlanetDefense hit measurably harder on an alarmed world than an identical world at peace", () => {
  const { run } = createSandbox();
  run(`S = freshState(); globalThis.__p = PLANETS.find(p => p.faction);`);
  run(`Math.random = () => 0.5;`);   // pin RNG so the only difference between the two calls is the alert level
  const calmPatrol = run(`genPlanetPatrol(__p, false).strength`);
  const calmGarrison = run(`genPlanetDefense(__p).strength`);
  run(`S.planetAlert[__p.id] = PLANET_ALERT_MAX;`);
  const hotPatrol = run(`genPlanetPatrol(__p, false).strength`);
  const hotGarrison = run(`genPlanetDefense(__p).strength`);
  assert.ok(hotPatrol > calmPatrol * 1.5, `a fully-alarmed picket vessel must hit far harder (calm=${calmPatrol}, hot=${hotPatrol})`);
  assert.ok(hotGarrison > calmGarrison * 1.5, `a fully-alarmed garrison must hit far harder (calm=${calmGarrison}, hot=${hotGarrison})`);
});

test("planetPatrolCount is unchanged at zero alert (2-4 by law) and grows up to +2 more hulls fully alarmed, capped at 6", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`planetPatrolCount({ id: "x", enforce: 0 })`), 2);
  assert.equal(run(`planetPatrolCount({ id: "x", enforce: 1 })`), 4);
  run(`S.planetAlert["x"] = PLANET_ALERT_MAX;`);
  assert.equal(run(`planetPatrolCount({ id: "x", enforce: 0 })`), 4, "a fully alarmed lawless world's picket should grow by 2");
  assert.equal(run(`planetPatrolCount({ id: "x", enforce: 1 })`), 6, "a fully alarmed lawful world's picket caps at 6");
});

test("raidPlanet's wave reflects the PRE-existing alert level, then raises it further for next time", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    globalThis.__target = PLANETS.find(p => p.faction);
    S.location = __target.id; S.res.fuel = 999;
  `);
  assert.equal(run(`planetAlertLevel(__target.id)`), 0, "a never-raided world starts calm");
  run(`raidPlanet();`);
  assert.equal(run(`planetAlertLevel(__target.id)`), run(`PLANET_ALERT_GAIN_ASSAULT`), "the assault itself must raise the alert for NEXT time");
  // clear the engagement and strike again -- the SECOND wave must read the raised level
  run(`clearEngagement();`);
  run(`Math.random = () => 0.5;`);
  const secondWaveVessel = JSON.parse(run(`JSON.stringify(genPlanetPatrol(__target, false))`));
  run(`Math.random = () => 0.5;`);
  const calmEquivalentStrength = run(`Math.round(PREY.patrol.base * (0.5 + __target.enforce * 0.45) * 1.0 * foeStrengthMult())`);
  assert.ok(secondWaveVessel.strength > calmEquivalentStrength, "a second strike on the same world must generate a tougher picket than a never-before-raided world would");
});

test("raidWinPlanet raises the alert further still, on top of the assault's own gain", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    globalThis.__target = PLANETS.find(p => p.faction);
    raisePlanetAlert(__target.id, PLANET_ALERT_GAIN_ASSAULT);   // as if raidPlanet() had already opened the assault
    globalThis.__prey = {
      isPlanetRaid: true, planetId: __target.id, planetName: __target.name,
      name: __target.name + " Defense Fleet", ico: "🏰", faction: __target.faction,
      cargo: {}, credits: 0, strength: 40, wantedGain: 40,
    };
  `);
  const before = run(`planetAlertLevel(__target.id)`);
  run(`raidWinPlanet(__prey, false);`);
  const after = run(`planetAlertLevel(__target.id)`);
  assert.equal(after, Math.min(100, before + run(`PLANET_ALERT_GAIN_SACK`)), "a full sack must stack its own gain on top of the assault's");
});

test("processPlanetAlert decays at peace far slower than either gain trigger, and clears the entry once it reaches 0", () => {
  const { run } = createSandbox();
  run(`S = freshState(); globalThis.__pid = PLANETS.find(p => p.faction).id;`);
  assert.ok(run(`PLANET_ALERT_DECAY`) < run(`PLANET_ALERT_GAIN_ASSAULT`) / 10, "decay must be an order of magnitude gentler than the assault gain -- the whole point of the ratchet");
  assert.ok(run(`PLANET_ALERT_DECAY`) < run(`PLANET_ALERT_GAIN_SACK`) / 10, "decay must be an order of magnitude gentler than the sack gain too");
  run(`raisePlanetAlert(__pid, 3);`);   // just above one decay tick, below the political threshold
  run(`processPlanetAlert();`);
  assert.equal(run(`Math.round(planetAlertLevel(__pid) * 100)`), Math.round((3 - run(`PLANET_ALERT_DECAY`)) * 100));
  run(`S.planetAlert[__pid] = PLANET_ALERT_DECAY / 2;`);   // less than one tick left
  run(`processPlanetAlert();`);
  assert.equal(run(`planetAlertLevel(__pid)`), 0);
  assert.equal(run(`Object.prototype.hasOwnProperty.call(S.planetAlert, __pid)`), false, "a fully-cooled world must not leave clutter in the save");
});

test("processPlanetAlert leaves faction relations alone below the political threshold, but sours them for every OTHER faction once a world runs hot", () => {
  const { run } = createSandbox();
  run(`S = freshState(); globalThis.__p = PLANETS.find(p => p.faction); ensureFactionRel();`);
  const others = () => run(`FACTION_KEYS.filter(f => f !== __p.faction)`);
  // below threshold: no political nudge
  run(`S.planetAlert[__p.id] = PLANET_ALERT_POLITICAL_THRESHOLD - 5;`);
  const beforeQuiet = JSON.parse(run(`JSON.stringify(S.factionRel)`));
  run(`processPlanetAlert();`);
  const afterQuiet = JSON.parse(run(`JSON.stringify(S.factionRel)`));
  others().forEach(f => {
    const key = run(`factionPairKey("${f}", __p.faction)`);
    assert.equal(afterQuiet[key], beforeQuiet[key], `relations with ${f} must not move below the political threshold`);
  });
  // above threshold: every OTHER faction's relation with the alarmed one sours
  run(`S = freshState(); globalThis.__p = PLANETS.find(p => p.faction); ensureFactionRel();`);
  run(`S.planetAlert[__p.id] = PLANET_ALERT_POLITICAL_THRESHOLD + 20;`);
  const beforeHot = JSON.parse(run(`JSON.stringify(S.factionRel)`));
  run(`processPlanetAlert();`);
  const afterHot = JSON.parse(run(`JSON.stringify(S.factionRel)`));
  others().forEach(f => {
    const key = run(`factionPairKey("${f}", __p.faction)`);
    assert.ok(afterHot[key] < beforeHot[key], `a hot world must sour relations with ${f}, not just its raider`);
  });
});

test("alertPriceMul is neutral at zero alert, scoped to war-relevant goods, and rises with alert", () => {
  const { run } = createSandbox();
  run(`S = freshState(); globalThis.__pid = PLANETS.find(p => p.faction).id;`);
  ["weapons", "fuel", "metals", "goods", "luxury", "ore", "spice"].forEach(c => {
    assert.equal(run(`alertPriceMul(__pid, "${c}")`), 1, `${c} must be unaffected at zero alert`);
  });
  run(`S.planetAlert[__pid] = PLANET_ALERT_MAX;`);
  ["weapons", "fuel", "metals"].forEach(c => {
    assert.equal(run(`alertPriceMul(__pid, "${c}")`), 1.5, `${c} is war matériel -- fully alarmed should be +50%`);
  });
  ["goods", "luxury"].forEach(c => {
    assert.equal(run(`alertPriceMul(__pid, "${c}")`), 1.3, `${c} is consumer economy squeeze -- fully alarmed should be +30%`);
  });
  ["ore", "spice"].forEach(c => {
    assert.equal(run(`alertPriceMul(__pid, "${c}")`), 1, `${c} is unrelated to the war footing and must stay neutral even fully alarmed`);
  });
});

test("rollPrices actually prices weapons higher at an alarmed world than an identical, unalarmed one", () => {
  const { run } = createSandbox();
  run(`S = freshState(); globalThis.__pid = PLANETS.find(p => p.faction).id; Math.random = () => 0.5;`);
  run(`rollPrices();`);
  const calmPrice = run(`S.prices[__pid].weapons`);
  run(`S.prices = {}; S.planetAlert[__pid] = PLANET_ALERT_MAX; Math.random = () => 0.5;`);
  run(`rollPrices();`);
  const hotPrice = run(`S.prices[__pid].weapons`);
  assert.ok(hotPrice > calmPrice, `an alarmed world's weapons must price higher (calm=${calmPrice}, hot=${hotPrice})`);
});
