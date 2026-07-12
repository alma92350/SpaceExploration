"use strict";
/* Pre-assault recon & battlefield shaping (raiding.js: probePlanetDefenses /
   hireRaidDiversion / processRaidIntel, plus sector4x.js's factionAtWar feeding
   assaultReinforceCap): the strategic half of the tactical layer. Recon is a
   drone-swarm gamble, not a free look — planetDetectionBand (combat.js) sets a
   { min, max } band from the world's law/tech/alert; probePlanetDefenses reads
   however many drones the player commits against it: below min, nothing comes
   back and the drones are wasted quietly; within the band, a clean read whose
   DETAIL (coarse vs full) scales with how far into the band you are; above max,
   full detail but the swarm's own size trips the alarm (planetAlert jumps, the
   surprise is gone). Once charted (any outcome but silent failure) the map
   shows exactly which coalition worlds would answer a distress call, so you can
   buy a responder's lanes shut with a hired pirate crew, and time the strike
   for a crisis or someone else's war. */
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
    S.upgrades.dronebay = 1; S.res.drones = 500;
  `);
}
// a quantity guaranteed to land inside the band, at or past its midpoint — full detail,
// no alarm — regardless of which planet this seed's PLANETS.find happened to pick
function fullReconQty(run) { return run(`Math.ceil((planetDetectionBand(__target).min + planetDetectionBand(__target).max) / 2)`); }

test("probePlanetDefenses (landed mid-band): spends an action and exactly the committed drones, charts the world for PROBE_CYCLES with full detail, and expires on schedule", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  const qty = fullReconQty(run);
  run(`globalThis.__actsBefore = S.actionsUsed; globalThis.__dronesBefore = S.res.drones;`);
  run(`probePlanetDefenses(${qty});`);
  assert.equal(run(`planetReconActive(__target.id)`), true);
  assert.equal(run(`planetReconDetail(__target.id)`), "full");
  assert.equal(run(`S.res.drones`), run(`__dronesBefore`) - qty, "the committed drones must be spent");
  assert.equal(run(`S.actionsUsed`), run(`__actsBefore`) + 1);
  assert.equal(run(`planetAlertLevel(__target.id)`), 0, "landing cleanly inside the band must not trip the alarm");
  assert.ok(run(`S.log.some(l => /Recon swarm over/.test(l.msg) && /garrison ~str/.test(l.msg) && /undetected/.test(l.msg))`), "a full read must report exact numbers and note it went undetected");
  run(`S.turn += PROBE_CYCLES; processRaidIntel();`);
  assert.equal(run(`planetReconActive(__target.id)`), false, "intel must expire");
  assert.equal(run(`Object.prototype.hasOwnProperty.call(S.planetRecon, __target.id)`), false, "and leave no clutter in the save");
});

test("probePlanetDefenses (too few drones): no intel, no alarm, drones spent for nothing", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  const { min } = JSON.parse(run(`JSON.stringify(planetDetectionBand(__target))`));
  const qty = Math.max(1, min - 1);
  run(`globalThis.__dronesBefore = S.res.drones;`);
  run(`probePlanetDefenses(${qty});`);
  assert.equal(run(`planetReconActive(__target.id)`), false, "too small a swarm must yield no usable intel");
  assert.equal(run(`S.res.drones`), run(`__dronesBefore`) - qty, "the drones are still spent, even for nothing");
  assert.equal(run(`planetAlertLevel(__target.id)`), 0, "an undersized attempt must not be noticed either");
  assert.ok(run(`S.log.some(l => /returns nothing usable/.test(l.msg))`), "the failure must be logged plainly");
});

test("probePlanetDefenses (just inside the floor): a coarse, qualitative read — no exact numbers, no alarm", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  const { min, max } = JSON.parse(run(`JSON.stringify(planetDetectionBand(__target))`));
  const mid = Math.ceil((min + max) / 2);
  if (min >= mid) return;   // this world's band is too narrow to have a coarse zone at all
  run(`probePlanetDefenses(${min});`);
  assert.equal(run(`planetReconActive(__target.id)`), true);
  assert.equal(run(`planetReconDetail(__target.id)`), "coarse", "a bare-minimum swarm should read the picture only qualitatively");
  assert.equal(run(`planetAlertLevel(__target.id)`), 0);
  assert.ok(run(`S.log.some(l => /weak|moderate|strong|formidable/.test(l.msg))`), "a coarse read must use qualitative bands, not exact numbers");
});

test("probePlanetDefenses (over the ceiling): full detail, but the oversized swarm trips the alarm", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  const { max } = JSON.parse(run(`JSON.stringify(planetDetectionBand(__target))`));
  const qty = max + 5;
  run(`globalThis.__alertBefore = planetAlertLevel(__target.id);`);
  run(`probePlanetDefenses(${qty});`);
  assert.equal(run(`planetReconActive(__target.id)`), true, "an oversized swarm still gathers full intel");
  assert.equal(run(`planetReconDetail(__target.id)`), "full");
  assert.equal(run(`planetAlertLevel(__target.id)`), run(`__alertBefore`) + run(`PROBE_ALARM_GAIN`), "being spotted must raise the world's alert");
  assert.ok(run(`S.log.some(l => /doesn.t go unnoticed/.test(l.msg) && /surprise is gone/.test(l.msg))`), "the blown cover must be logged clearly");
});

test("probePlanetDefenses refuses without a Drone Bay, and refuses more drones than are actually aboard", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  run(`S.upgrades.dronebay = 0;`);
  run(`probePlanetDefenses(${fullReconQty(run)});`);
  assert.equal(run(`planetReconActive(__target.id)`), false, "no drone bay, no launch");
  run(`S.upgrades.dronebay = 1; S.res.drones = 2;`);
  run(`probePlanetDefenses(500);`);
  assert.equal(run(`planetReconActive(__target.id)`), false, "can't commit more drones than are actually in the hold");
  assert.equal(run(`S.res.drones`), 2, "a refused launch must not spend anything");
});

test("hireRaidDiversion requires recon, coin, and a willing free band — then shuts a responder's lanes and busies the crew", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  const hasSource = run(`
    globalThis.__src = assaultCoalitionSources(__target)[0] || null; !!__src;
  `);
  if (!hasSource) return;   // no coalition sibling in this seed — nothing to divert
  run(`S.res.credits = 50000;`);
  // no recon yet: refused
  run(`globalThis.__b = newBand(2); __b.rep = 50; __b.loc = __target.id;`);
  run(`hireRaidDiversion(__src.id);`);
  assert.equal(run(`worldDiverted(__src.id)`), false, "no recon, no diversion — chart the lanes first");
  // recon up, band willing: the buy works
  run(`probePlanetDefenses(${fullReconQty(run)});`);
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
  run(`S.res.credits = 50000; probePlanetDefenses(${fullReconQty(run)});`);
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

test("the Raid card renders a drone-launch input before charting, then the recon block with strengths and Divert buttons after", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  run(`S.res.credits = 50000;`);
  cacheGetElementById(run);
  run(`renderRaid();`);
  let html = run(`document.getElementById("panel-raid").innerHTML`);
  assert.match(html, /probe-drones/, "an uncharted world must offer the drone-quantity launch input");
  assert.match(html, /Launch recon drones/);
  assert.doesNotMatch(html, /Recon<\/b>/, "and show no recon block yet");
  run(`probePlanetDefenses(${fullReconQty(run)});`);
  run(`renderRaid();`);
  html = run(`document.getElementById("panel-raid").innerHTML`);
  assert.match(html, /🛸 <b>Recon<\/b>/, "a charted world must show the recon block");
  assert.match(html, /garrison ~str/, "a full-detail read shows the garrison's estimated strength");
  if (run(`assaultCoalitionSources(__target).length > 0`)) {
    assert.match(html, /Divert \(/, "and a Divert buy-out per responding world");
  }
});

test("the Raid card shows a Drone Bay prompt instead of the launch control when none is installed", () => {
  const { run } = createSandbox();
  targetFactionWorld(run);
  run(`S.upgrades.dronebay = 0;`);
  cacheGetElementById(run);
  run(`renderRaid();`);
  const html = run(`document.getElementById("panel-raid").innerHTML`);
  assert.match(html, /Drone Bay/);
  assert.doesNotMatch(html, /probe-drones/, "no launch control without a drone bay");
});
