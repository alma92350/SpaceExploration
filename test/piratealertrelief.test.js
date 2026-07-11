"use strict";
/* Mirror image of the alert ratchet: chasing down the pirates plaguing a world is a
   real service to its coalition, not just neglecting the lanes — pirateKillRewards
   (combat.js, the single hook both raidWinPirate and encounterFight funnel through)
   now calls lowerPlanetAlert to stand the SAME shared S.planetAlert[pid] meter down,
   scaled by the pirate's own rank. Coalition-raiding paths (raidWinMerchant,
   raidWinPlanet/Patrol) are untouched — they still only ever raise it. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("lowerPlanetAlert decrements, clamps at 0, cleans up the entry, and is a safe no-op with nothing to relieve", () => {
  const { run } = createSandbox();
  run(`S = freshState(); globalThis.__pid = PLANETS.find(p => p.faction).id;`);
  run(`lowerPlanetAlert(__pid, 5);`);   // nothing there yet -- must not create a spurious entry
  assert.equal(run(`planetAlertLevel(__pid)`), 0);
  assert.equal(run(`Object.prototype.hasOwnProperty.call(S.planetAlert, __pid)`), false);
  run(`raisePlanetAlert(__pid, 10);`);
  run(`lowerPlanetAlert(__pid, 4);`);
  assert.equal(run(`planetAlertLevel(__pid)`), 6);
  run(`lowerPlanetAlert(__pid, 100);`);
  assert.equal(run(`planetAlertLevel(__pid)`), 0);
  assert.equal(run(`Object.prototype.hasOwnProperty.call(S.planetAlert, __pid)`), false, "fully relieved must clean up, same convention as processPlanetAlert's own decay");
});

test("pirateKillRewards relieves the CURRENT planet's alert, scaled by the pirate's own rank, and doesn't touch other worlds", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    globalThis.__pid = PLANETS.find(p => p.faction).id;
    globalThis.__otherPid = PLANETS.find(p => p.faction && p.id !== __pid).id;
    S.location = __pid;
    raisePlanetAlert(__pid, 50); raisePlanetAlert(__otherPid, 50);
  `);
  run(`pirateKillRewards({ level: 1, bounty: 400 });`);
  assert.equal(run(`planetAlertLevel(__pid)`), 50 - run(`PIRATE_HUNT_ALERT_RELIEF_BASE`) - 1, "a rookie (level 1) pirate should relieve base+1");
  assert.equal(run(`planetAlertLevel(__otherPid)`), 50, "a different world's alert must be untouched by a kill elsewhere");
});

test("a higher-ranked pirate relieves more alert than a low-ranked one", () => {
  const { run } = createSandbox();
  run(`S = freshState(); globalThis.__pid = PLANETS.find(p => p.faction).id; S.location = __pid;`);
  run(`raisePlanetAlert(__pid, 90);`);
  run(`pirateKillRewards({ level: 1, bounty: 400 });`);
  const afterRookie = run(`planetAlertLevel(__pid)`);
  run(`S.planetAlert[__pid] = 90;`);
  run(`pirateKillRewards({ level: 5, bounty: 3000 });`);
  const afterWarlord = run(`planetAlertLevel(__pid)`);
  assert.ok(afterWarlord < afterRookie, `taking down a Pirate Warlord must relieve more than a Rookie Corsair (rookie left ${afterRookie}, warlord left ${afterWarlord})`);
});

test("the relief is a meaningful active lever, not just a faster tick of passive decay", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  const relief = run(`PIRATE_HUNT_ALERT_RELIEF_BASE + 1`);   // a rookie kill, the smallest case
  assert.ok(relief >= run(`PLANET_ALERT_DECAY`) * 3, "even the smallest pirate kill should outweigh several cycles' worth of passive decay");
});

test("raidWinPirate (the Raid tab's own multi-round pirate kill) relieves the local alert and notes it in the log only when there was something to relieve", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    globalThis.__pid = PLANETS.find(p => p.faction).id;
    S.location = __pid;
    raisePlanetAlert(__pid, 40);
    globalThis.__prey = { isPirate: true, level: 3, bounty: 900, credits: 200, cargo: {}, bandId: null };
  `);
  run(`raidWinPirate(__prey);`);
  assert.equal(run(`planetAlertLevel(__pid)`), 40 - run(`PIRATE_HUNT_ALERT_RELIEF_BASE`) - 3);
  assert.ok(run(`S.log.some(l => /alert eases/.test(l.msg))`), "the log should mention the eased alert when there was any to relieve");

  // a second kill at an already-calm world should say nothing about relief
  run(`
    S = freshState(); rollPrices();
    S.location = __pid;
    globalThis.__prey2 = { isPirate: true, level: 3, bounty: 900, credits: 200, cargo: {}, bandId: null };
  `);
  run(`raidWinPirate(__prey2);`);
  assert.ok(!run(`S.log.some(l => /alert eases/.test(l.msg))`), "a calm world has nothing to ease, so the log must stay quiet about it");
});

test("encounterFight (a travel-ambush pirate kill) also relieves the current planet's alert via the same pirateKillRewards hook", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    globalThis.__pid = PLANETS.find(p => p.faction).id;
    S.location = __pid;
    raisePlanetAlert(__pid, 30);
    S.encounter = {
      type: "pirate", isPirate: true, level: 2, name: "Marauder", ico: "🏴", faction: "frontier",
      cargo: { weapons: 2, fuel: 3 }, credits: 300, bounty: 900,
      strength: 20, def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic",
      engines: 1, enginesMax: 1, hp: 1, maxhp: 100, toll: 200,
    };
  `);
  run(`encounterFight("kinetic");`);
  assert.equal(run(`!!S.encounter`), false, "the ambusher must be destroyed");
  assert.equal(run(`planetAlertLevel(__pid)`), 30 - run(`PIRATE_HUNT_ALERT_RELIEF_BASE`) - 2);
  assert.ok(run(`S.log.some(l => /alert eases/.test(l.msg))`), "the travel-ambush kill must also surface the relief");
});

test("coalition-raiding win paths still only ever RAISE the alert -- pirate hunting is the only path that lowers it", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    globalThis.__pid = PLANETS.find(p => p.faction).id;
    S.location = __pid;
    globalThis.__merchantPrey = { faction: currentPlanet().faction, cargo: { goods: 5 }, credits: 100, wantedGain: 5 };
  `);
  assert.equal(run(`planetAlertLevel(__pid)`), 0);
  run(`raidWinMerchant(__merchantPrey, false);`);
  assert.ok(run(`planetAlertLevel(__pid)`) > 0, "raiding coalition shipping must still only raise the shared meter, never lower it");
});
