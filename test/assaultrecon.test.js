"use strict";
/* Pre-assault recon & battlefield shaping (raiding.js: probePlanetDefenses /
   hireRaidDiversion / processRaidIntel, plus sector4x.js's factionAtWar feeding
   assaultReinforceCap): the strategic half of the tactical layer. Chart a world's
   defenses and its coalition's response map, buy a responder's lanes shut with a
   hired pirate crew, and time the strike for a crisis or someone else's war. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function cacheGetElementById(run) {
  run(`const _elCache = {}; const _origGetById = document.getElementById.bind(document);
       document.getElementById = id => _elCache[id] || (_elCache[id] = _origGetById(id));`);
}
function targetFactionWorld(run) {
  run(`
    S = freshState(); rollPrices();
    globalThis.__target = PLANETS.find(p => p.faction && isActive(p) && !p.hidden);
    S.location = __target.id;
  `);
}

test("probePlanetDefenses spends an action and fuel, charts the world for PROBE_CYCLES, and expires on schedule", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  run(`S.res.fuel = 100; globalThis.__actsBefore = S.actionsUsed;`);
  run(`probePlanetDefenses();`);
  assert.equal(run(`planetReconActive(__target.id)`), true);
  assert.equal(run(`S.res.fuel`), 100 - run(`PROBE_FUEL`));
  assert.equal(run(`S.actionsUsed`), run(`__actsBefore`) + 1);
  assert.ok(run(`S.log.some(l => /Recon pass over/.test(l.msg) && /garrison ~str/.test(l.msg))`), "the pass must report the charted defenses");
  run(`S.turn += PROBE_CYCLES; processRaidIntel();`);
  assert.equal(run(`planetReconActive(__target.id)`), false, "intel must expire");
  assert.equal(run(`Object.prototype.hasOwnProperty.call(S.planetRecon, __target.id)`), false, "and leave no clutter in the save");
});

test("hireRaidDiversion requires recon, coin, and a willing free band — then shuts a responder's lanes and busies the crew", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  const hasSource = run(`
    globalThis.__src = assaultCoalitionSources(__target)[0] || null; !!__src;
  `);
  if (!hasSource) return;   // no coalition sibling in this seed — nothing to divert
  run(`S.res.credits = 50000; S.res.fuel = 100;`);
  // no recon yet: refused
  run(`globalThis.__b = newBand(2); __b.rep = 50; __b.loc = __target.id;`);
  run(`hireRaidDiversion(__src.id);`);
  assert.equal(run(`worldDiverted(__src.id)`), false, "no recon, no diversion — chart the lanes first");
  // recon up, band willing: the buy works
  run(`probePlanetDefenses();`);
  run(`globalThis.__creditsBefore = S.res.credits; globalThis.__alertBefore = planetAlertLevel(__src.id);`);
  run(`hireRaidDiversion(__src.id);`);
  assert.equal(run(`worldDiverted(__src.id)`), true);
  assert.equal(run(`S.res.credits`), run(`__creditsBefore`) - run(`DIVERSION_COST`));
  assert.equal(run(`bandBusy(__b)`), true, "the hired crew is off doing the job");
  assert.ok(run(`planetAlertLevel(__src.id)`) > run(`__alertBefore`), "raiding by proxy still heats the harassed world");
  assert.equal(run(`assaultCoalitionSources(__target).some(w => w.id === __src.id)`), false, "the diverted world must drop out of the response map");
  run(`S.turn += DIVERSION_CYCLES; processRaidIntel();`);
  assert.equal(run(`worldDiverted(__src.id)`), false, "the bought silence runs out on schedule");
});

test("hireRaidDiversion refuses when no willing band is free", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  const hasSource = run(`globalThis.__src = assaultCoalitionSources(__target)[0] || null; !!__src;`);
  if (!hasSource) return;
  run(`S.res.credits = 50000; S.res.fuel = 100; probePlanetDefenses();`);
  run(`hireRaidDiversion(__src.id);`);   // fresh state: no bands exist at all
  assert.equal(run(`worldDiverted(__src.id)`), false, "with no crew to hire, the lanes stay open");
  assert.equal(run(`S.res.credits`), 50000, "and no coin is spent");
});

test("a defending faction at war sends one fewer response wing (assaultReinforceCap), and recon can see it", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  assert.equal(run(`assaultReinforceCap(__target)`), run(`ASSAULT_REINFORCE_CAP`), "at peace, the full coalition answers");
  run(`
    ensureFactionRel();
    const other = FACTION_KEYS.find(f => f !== __target.faction);
    S.factionRel[factionPairKey(other, __target.faction)] = -80;   // a shooting war
  `);
  assert.equal(run(`factionAtWar(__target.faction)`), true);
  assert.equal(run(`assaultReinforceCap(__target)`), run(`ASSAULT_REINFORCE_CAP`) - 1, "a committed fleet spares one fewer wing");
  // and the cap actually bites: a forced distress call at the reduced cap summons nothing
  const hasSource = run(`assaultCoalitionSources(__target).length > 0`);
  if (hasSource) {
    run(`
      S.prey = { name: "Defender", faction: __target.faction, cargo: {}, credits: 0, strength: 20,
        def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic", hp: 1000, maxhp: 1000, pack: [], _others: [] };
      S.planetAssault = { planetId: __target.id, phase: "patrols", called: ASSAULT_REINFORCE_CAP - 1 };
    `);
    assert.equal(run(`maybePlanetReinforce(true)`), false, "the war-reduced cap must refuse the call even when forced");
  }
});

test("a crisis thins the picket and the garrison the same way it already thins lane escorts", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  run(`Math.random = () => 0.5;`);
  const calmPatrol = run(`genPlanetPatrol(__target, false).strength`);
  const calmGarrison = run(`genPlanetDefense(__target).strength`);
  run(`S.crises[__target.id] = { type: "quake", cyclesLeft: 3 }; Math.random = () => 0.5;`);
  const crisisPatrol = run(`genPlanetPatrol(__target, false).strength`);
  const crisisGarrison = run(`genPlanetDefense(__target).strength`);
  assert.ok(crisisPatrol < calmPatrol, `a world in crisis flies a thinner picket (calm=${calmPatrol}, crisis=${crisisPatrol})`);
  assert.ok(crisisGarrison < calmGarrison, `and mans a weaker garrison (calm=${calmGarrison}, crisis=${crisisGarrison})`);
});

test("the Raid card renders the recon block once charted: strengths, responders with Divert buttons — or the probe button before that", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  run(`S.res.fuel = 100; S.res.credits = 50000;`);
  cacheGetElementById(run);
  run(`renderRaid();`);
  let html = run(`document.getElementById("panel-raid").innerHTML`);
  assert.match(html, /Probe defenses/, "an uncharted world must offer the probe");
  assert.doesNotMatch(html, /Recon<\/b>/, "and show no recon block yet");
  run(`probePlanetDefenses();`);
  run(`renderRaid();`);
  html = run(`document.getElementById("panel-raid").innerHTML`);
  assert.match(html, /🛰️ <b>Recon<\/b>/, "a charted world must show the recon block");
  assert.match(html, /garrison ~str/, "with the garrison's estimated strength");
  if (run(`assaultCoalitionSources(__target).length > 0`)) {
    assert.match(html, /Divert \(/, "and a Divert buy-out per responding world");
  }
});
