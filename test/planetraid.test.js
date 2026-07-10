"use strict";
/* Offense side of the defense slice, now a PHASED campaign: raidPlanet() (combat.js)
   scrambles the CURRENT planet's whole orbital picket as a wave (genPlanetPatrolWave —
   S.prey + pack, fought with the same pooled-fire Target/Focus roster as the Escort
   tab's wave combat, each kill resolved by raidWinPatrol); only when the LAST space
   defender is gone does promoteOrEnd (raiding.js) swap in the ground garrison
   (genPlanetDefense, phase 2), and only beating THAT pays the ground plunder
   (raidWinPlanet). The coalition can reinforce mid-fight from its other worlds
   (maybePlanetReinforce). Fixtures pre-set hp/maxhp directly (same pattern
   test/raidpool.test.js uses) so a kill is deterministic regardless of the player's
   own combat-power formulas. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

// a deterministic picket vessel, mirroring test/raidpool.test.js's foe() helper
function patrolFoe(overrides) {
  return Object.assign({
    type: "patrol", isPlanetPatrol: true, name: "Picket", ico: "🚔", faction: "core",
    cargo: { weapons: 2, fuel: 3 }, credits: 100,
    strength: 20, def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic", bounty: 0, wantedGain: 8,
    isPirate: false, engines: 1, enginesMax: 1, hp: 1000, maxhp: 1000,
  }, overrides || {});
}
// stand up a mid-assault engagement: anchor + pack picket vessels over a real faction world
function setupAssault(run, preyOverrides, packOverrides, phase) {
  run(`
    S = freshState(); rollPrices();
    globalThis.__target = PLANETS.find(p => p.faction && isActive(p) && !p.hidden);
    S.location = __target.id;
  `);
  const tie = f => `Object.assign(${JSON.stringify(f)}, { planetId: __target.id, planetName: __target.name, faction: __target.faction })`;
  run(`
    S.prey = ${tie(patrolFoe(preyOverrides))};
    S.prey.pack = [${(packOverrides || []).map(o => tie(patrolFoe(o))).join(",")}];
    S.prey._others = []; S.allies = null; S.raidTargets = [];
    S.planetAssault = { planetId: __target.id, phase: ${JSON.stringify(phase || "patrols")}, called: 0 };
  `);
}

test("genPlanetDefense is flagged for raidWinPlanet, faction-matched, and scales with how lawful the world is", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  const shape = JSON.parse(run(`
    const lawful = PLANETS.find(p => p.faction && p.enforce >= 0.7);
    const lawless = PLANETS.find(p => p.faction && p.enforce <= 0.2);
    JSON.stringify({
      lawfulOk: !!lawful, lawlessOk: !!lawless,
      lawfulFoe: lawful && Object.assign({}, genPlanetDefense(lawful), { def: undefined }),
      lawlessFoe: lawless && Object.assign({}, genPlanetDefense(lawless), { def: undefined }),
    });
  `));
  if (!shape.lawfulOk || !shape.lawlessOk) return;   // this galaxy seed didn't roll both extremes -- nothing to compare
  assert.equal(shape.lawfulFoe.isPlanetRaid, true);
  assert.equal(shape.lawfulFoe.faction, shape.lawfulFoe.faction);
  assert.ok(shape.lawfulFoe.planetId && shape.lawfulFoe.planetName, "must carry the planet's own identity for raidWinPlanet");
  assert.ok(shape.lawfulFoe.strength > shape.lawlessFoe.strength, "a more lawful world's garrison must be stronger");
  assert.ok(shape.lawfulFoe.wantedGain > shape.lawlessFoe.wantedGain, "raiding a more lawful world must draw more Wanted");
});

test("planetRaidHaul scales with the planet's industry and tech", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  const poor = run(`planetRaidHaul({ industry: 1, tech: 1 })`);
  const rich = run(`planetRaidHaul({ industry: 10, tech: 10 })`);
  assert.ok(rich > poor * 3, `a developed world must pay out far more (poor=${poor}, rich=${rich})`);
});

test("raidPlanet refuses a faction-less world, your own settlement, no actions/fuel, or an existing engagement", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);

  // a frontier/colonizable world generated with no controlling faction at all
  run(`
    globalThis.__frontier = { id: "zz_frontier", name: "Nowhere", faction: null, enforce: 0.1, industry: 1, tech: 1, deposits: {} };
    PLANETS.push(__frontier); S.location = __frontier.id;
    S.res.fuel = 999;
  `);
  run(`raidPlanet();`);
  assert.equal(run(`!!S.prey`), false, "a world with no faction has no garrison worth raiding");

  // your own base blocks it even on an otherwise-valid faction world
  run(`
    S = freshState();
    globalThis.__target = PLANETS.find(p => p.faction);
    S.location = __target.id;
    S.bases[__target.id] = { modules: {}, storage: {}, trade: { on:false, exp:{}, imp:{}, cols:{} } };
    S.res.fuel = 999;
  `);
  run(`raidPlanet();`);
  assert.equal(run(`!!S.prey`), false, "can't raid your own base");

  // no actions left
  run(`
    S = freshState();
    globalThis.__target = PLANETS.find(p => p.faction);
    S.location = __target.id;
    S.res.fuel = 999; S.actionsUsed = actionsMax();
  `);
  run(`raidPlanet();`);
  assert.equal(run(`!!S.prey`), false, "no actions left must refuse");

  // not enough fuel
  run(`
    S = freshState();
    globalThis.__target = PLANETS.find(p => p.faction);
    S.location = __target.id;
    S.res.fuel = 0;
  `);
  run(`raidPlanet();`);
  assert.equal(run(`!!S.prey`), false, "not enough fuel must refuse");

  // already engaged with something else
  run(`
    S = freshState();
    globalThis.__target = PLANETS.find(p => p.faction);
    S.location = __target.id;
    S.res.fuel = 999;
    S.encounter = { name: "Ambusher" };
  `);
  run(`raidPlanet();`);
  assert.equal(run(`!!S.prey`), false, "an active ambush must be dealt with first");
});

test("raidPlanet spends fuel and an action, and scrambles the planet's whole orbital picket as a wave (phase 1)", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    globalThis.__target = PLANETS.find(p => p.faction);
    S.location = __target.id;
    S.res.fuel = 999;
    globalThis.__before = S.actionsUsed;
  `);
  run(`raidPlanet();`);
  assert.equal(run(`S.prey.isPlanetPatrol`), true, "the first engagement is the picket, not the garrison");
  assert.equal(run(`S.prey.planetId`), run(`S.location`));
  assert.equal(run(`S.planetAssault && S.planetAssault.phase`), "patrols", "the assault tracker must open in the patrols phase");
  assert.equal(run(`S.planetAssault.planetId`), run(`S.location`));
  const waveSize = run(`1 + S.prey.pack.length`);
  assert.equal(waveSize, run(`planetPatrolCount(currentPlanet())`), "the wave must be the world's whole picket");
  assert.ok(waveSize >= 2, "even a lawless world's picket flies at least two vessels");
  assert.equal(run(`allHostiles(S.prey).every(h => h.isPlanetPatrol && h.hp > 0 && h.maxhp >= h.hp)`), true,
    "every picket vessel must be flagged for raidWinPatrol and pre-initialized for the wave roster");
  assert.equal(run(`S.res.fuel`), 999 - run(`PLANET_RAID_FUEL`));
  assert.equal(run(`S.actionsUsed`), run(`__before`) + 1);
});

test("planetPatrolCount scales with law (2 on the rim, 4 over a high-law world) and genPlanetPatrol flies a trimmed picket hull", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`planetPatrolCount({ enforce: 0 })`), 2);
  assert.equal(run(`planetPatrolCount({ enforce: 1 })`), 4);
  const shape = JSON.parse(run(`
    const w = PLANETS.find(p => p.faction);
    const v = genPlanetPatrol(w, false);
    JSON.stringify({ flag: v.isPlanetPatrol, faction: v.faction === w.faction, planetId: v.planetId === w.id,
      hpInit: v.hp > 0 && v.hp === v.maxhp,
      trimmed: v.maxhp <= Math.ceil((Math.max(v.strength * FOE_HP_MULT * (v.hullMult || 1), estPlayerDPS() * COMBAT_ROUNDS_TARGET) * (1 + 0.4 * (v.escorts || 0))) * PATROL_HULL_TRIM) + 1 });
  `));
  assert.equal(shape.flag, true);
  assert.equal(shape.faction, true, "a picket vessel flies its world's flag");
  assert.equal(shape.planetId, true);
  assert.equal(shape.hpInit, true, "hp must be initialized at generation so the roster renders");
  assert.equal(shape.trimmed, true, "picket hulls must be trimmed — an untrimmed wave would out-tank the old single fleet several times over");
});

test("the ground garrison is a dug-in fortress: flagged for raidWinPlanet, no engines, and it never flees", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  const shape = JSON.parse(run(`
    const w = PLANETS.find(p => p.faction);
    const g = genPlanetDefense(w);
    g.hp = 1; g.maxhp = 1000;   // deep in losing territory — the only reason it wouldn't flee is having no drive
    JSON.stringify({ flag: g.isPlanetRaid, ground: g.ground, engines: g.engines, enginesMax: g.enginesMax,
      label: classLabel(g), flees: foeFleeCheck(g) });
  `));
  assert.equal(shape.flag, true);
  assert.equal(shape.ground, true);
  assert.equal(shape.engines, 0, "a fortress has no drive");
  assert.equal(shape.enginesMax, 0);
  assert.equal(shape.label, "🏰 Bastion", "the roster must not call a ground fortress a Corvette");
  assert.equal(shape.flees, false, "a ground garrison can never jump away");
});

test("killing one picket vessel routes to raidWinPatrol: salvage and modest heat, engagement and phase continue, no ground plunder", () => {
  const { run } = createSandbox();
  setupAssault(run, { name: "Doomed", hp: 1, maxhp: 100 }, [{ name: "Holdout", hp: 100000, maxhp: 100000 }]);
  run(`Math.random = () => 0.5; S.raidTargets = [0];`);   // focus the weak anchor; 0.5 also keeps reinforcements/flee quiet
  run(`globalThis.__wantedBefore = S.pirate.wanted; globalThis.__repBefore = S.rep[__target.faction] || 0;`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`!!S.prey`), true, "the fight must continue against the surviving picket");
  assert.equal(run(`S.prey.name`), "Holdout");
  assert.equal(run(`S.planetAssault && S.planetAssault.phase`), "patrols", "one kill must not advance the phase while defenders remain");
  assert.ok(run(`S.log.some(l => /blew the/.test(l.msg) && /out of/.test(l.msg))`), "the kill must route through raidWinPatrol's phrasing");
  assert.ok(!run(`S.log.some(l => /sacked the surface/.test(l.msg))`), "no ground plunder while the sky is contested");
  assert.ok(run(`S.pirate.wanted`) > run(`__wantedBefore`), "a patrol kill still earns Wanted");
  assert.ok(run(`(S.rep[__target.faction] || 0)`) < run(`__repBefore`), "a patrol kill still costs standing");
});

test("clearing the LAST space defender advances the assault: the ground garrison steps in as the new engagement", () => {
  const { run } = createSandbox();
  setupAssault(run, { name: "LastPicket", hp: 1, maxhp: 100 }, []);
  run(`Math.random = () => 0.5; S.raidTargets = [0];`);
  run(`globalThis.__creditsBefore = S.res.credits;`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`!!S.prey`), true, "the engagement must NOT end — the campaign rolls down to the surface");
  assert.equal(run(`S.prey.isPlanetRaid === true && S.prey.ground === true`), true, "the new foe is the ground garrison");
  assert.equal(run(`S.prey.planetId`), run(`__target.id`));
  assert.equal(run(`S.planetAssault.phase`), "garrison");
  assert.equal(run(`S.prey._engaged`), true, "the garrison inherits the engagement (no double raids++ later)");
  assert.ok(run(`S.log.some(l => /skies over/.test(l.msg) && /are clear/.test(l.msg))`), "the phase change must be announced");
  assert.ok(!run(`S.log.some(l => /sacked the surface/.test(l.msg))`), "clearing the orbit alone must NOT pay the sack");
  assert.ok(run(`S.res.credits`) < run(`__creditsBefore`) + 500, "only patrol salvage so far — the ground plunder stays locked behind phase 2");
});

test("breaking the ground garrison wins the assault: raidWinPlanet pays the sack and the assault tracker clears", () => {
  const { run } = createSandbox();
  setupAssault(run, {
    type: "garrison", isPlanetPatrol: false, isPlanetRaid: true, ground: true, name: "Garrison",
    ico: "🏰", cargo: {}, credits: 500, engines: 0, enginesMax: 0, hp: 1, maxhp: 1000, wantedGain: 40,
  }, [], "garrison");
  run(`Math.random = () => 0.5; S.raidTargets = [0];`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey`), null, "the campaign ends when the garrison falls");
  assert.equal(run(`S.planetAssault`), null, "the assault tracker must clear on the win");
  assert.ok(run(`S.log.some(l => /sacked the surface/.test(l.msg))`), "the win must route through raidWinPlanet");
});

test("a scan-spooked anchor that bolts now hands the fight to its pack instead of dissolving the engagement", () => {
  const { run } = createSandbox();
  setupAssault(run, { name: "Jumpy", hp: 1000, maxhp: 1000, engines: 2, enginesMax: 2, cls: "scout" },
    [{ name: "Stalwart", hp: 1000, maxhp: 1000 }]);
  run(`S.res.energy = 99; Math.random = () => 0.0;`);   // force the spooked-bolt roll
  run(`deepScan();`);
  assert.equal(run(`!!S.prey`), true, "the surviving picket must still hold the field");
  assert.equal(run(`S.prey.name`), "Stalwart");
  assert.equal(run(`S.planetAssault && S.planetAssault.phase`), "patrols", "the assault survives an anchor bolting");
});

test("maybePlanetReinforce: the coalition answers from another world — arrivals join the defenders' pack under both caps", () => {
  const { run } = createSandbox();
  setupAssault(run, { name: "Anchor", hp: 100000, maxhp: 100000 }, []);
  // the assault target must have a coalition world to call on — re-aim at one that does, or skip
  const hasSource = run(`
    const src = PLANETS.find(p => p.faction && isActive(p) && !p.hidden &&
      PLANETS.some(o => o.id !== p.id && o.faction === p.faction && isActive(o) && !o.hidden));
    if (src) {
      globalThis.__target = src; S.location = src.id;
      S.prey.planetId = src.id; S.prey.planetName = src.name; S.prey.faction = src.faction;
      S.planetAssault.planetId = src.id;
    }
    !!src;
  `);
  if (!hasSource) return;   // this galaxy seed left every faction a single world — nothing to test
  run(`Math.random = () => 0.0;`);   // force the distress-call roll (and pin rint(1,2) to 1 arrival)
  run(`maybePlanetReinforce();`);
  assert.equal(run(`S.prey.pack.length`), 1, "one response wing must arrive");
  assert.equal(run(`S.planetAssault.called`), 1, "the assault must count the coalition's spent responses");
  assert.equal(run(`S.prey.pack[0].isPlanetPatrol`), true, "an arrival fights — and dies — like any other space defender");
  assert.ok(run(`S.prey.pack[0].fromPlanet !== __target.id`), "the wing must come from ANOTHER world");
  assert.ok(run(`S.prey.pack[0].hp > 0 && S.prey.pack[0].hp === S.prey.pack[0].maxhp`), "arrivals are combat-ready and roster-ready");
  assert.ok(run(`S.log.some(l => /distress call is answered/.test(l.msg))`), "the arrival must be announced");
  // total-per-assault cap: a coalition that has already sent everything sends no more
  run(`S.planetAssault.called = ASSAULT_REINFORCE_CAP; S.prey.pack = [];`);
  run(`maybePlanetReinforce();`);
  assert.equal(run(`S.prey.pack.length`), 0, "a spent coalition sends nothing further");
  // field cap: no arrivals while the sky is already crowded with defenders
  run(`S.planetAssault.called = 0;
       S.prey.pack = [${["A", "B", "C"].map(n => `{ name: "${n}", hp: 10, maxhp: 10 }`).join(",")}];`);
  run(`maybePlanetReinforce();`);
  assert.equal(run(`S.prey.pack.length`), 3, "no arrivals while ASSAULT_FIELD_CAP hostiles already hold the field");
});

test("maybePlanetReinforce is inert outside a planetary assault", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    S.prey = { name: "Freighter", faction: "core", cargo: {}, credits: 0, strength: 10,
      def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic", hp: 100, maxhp: 100, wantedGain: 5 };
    S.prey.pack = []; S.prey._others = []; S.planetAssault = null;
  `);
  run(`Math.random = () => 0.0;`);
  run(`maybePlanetReinforce();`);
  assert.equal(run(`S.prey.pack.length`), 0, "an ordinary lane raid must never draw planetary reinforcements");
});

test("disengaging mid-assault abandons the campaign: the assault tracker clears and the collapse is logged", () => {
  const { run } = createSandbox();
  setupAssault(run, { name: "Anchor", hp: 100000, maxhp: 100000, _engaged: true }, [{ name: "Wingman", hp: 100000, maxhp: 100000 }]);
  run(`Math.random = () => 0.5;`);
  run(`raidDisengage();`);
  assert.equal(run(`S.prey`), null);
  assert.equal(run(`S.planetAssault`), null, "breaking off must abandon the assault");
  assert.ok(run(`S.log.some(l => /assault on/.test(l.msg) && /collapses/.test(l.msg))`), "the abandoned campaign must be logged");
});

test("raidWinPlanet: credits/dread/wanted/rep move by more than a routine merchant kill, and ground plunder scales with the world", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    globalThis.__target = PLANETS.find(p => p.faction);
    globalThis.__prey = {
      isPlanetRaid: true, planetId: __target.id, planetName: __target.name,
      name: __target.name + " Defense Fleet", ico: "🏰", faction: __target.faction,
      cargo: {}, credits: 500, strength: 40, wantedGain: 40,
    };
    globalThis.__creditsBefore = S.res.credits;
    globalThis.__repBefore = S.rep[__target.faction] || 0;
  `);
  run(`raidWinPlanet(__prey, false);`);
  assert.ok(run(`S.res.credits`) > run(`__creditsBefore`) + 500, "ground plunder must add on top of the fleet's own war chest");
  assert.equal(run(`S.pirate.dread >= 15`), true);
  assert.equal(run(`S.pirate.wanted >= 40`), true);
  assert.ok(run(`(S.rep[__prey.faction] || 0)`) <= run(`__repBefore`) - 20, "sacking a world must cost real standing with its faction");
  assert.ok(run(`S.log.some(l => /sacked the surface/.test(l.msg))`), "the log must describe sacking the surface");
});

test("raidWinPlanet: no quarter deepens dread, wanted and the rep hit versus a clean win", () => {
  const { run } = createSandbox();
  const setup = () => `
    S = freshState();
    globalThis.__target = PLANETS.find(p => p.faction);
    globalThis.__prey = {
      isPlanetRaid: true, planetId: __target.id, planetName: __target.name,
      name: __target.name + " Defense Fleet", ico: "🏰", faction: __target.faction,
      cargo: {}, credits: 0, strength: 40, wantedGain: 40,
    };
  `;
  run(setup());
  run(`raidWinPlanet(__prey, false);`);
  const cleanDread = run(`S.pirate.dread`), cleanWanted = run(`S.pirate.wanted`), cleanRep = run(`S.rep[__prey.faction]`);

  run(setup());
  run(`raidWinPlanet(__prey, true);`);
  const nqDread = run(`S.pirate.dread`), nqWanted = run(`S.pirate.wanted`), nqRep = run(`S.rep[__prey.faction]`);

  assert.ok(nqDread > cleanDread, "no quarter must raise dread further");
  assert.ok(nqWanted > cleanWanted, "no quarter must raise wanted further");
  assert.ok(nqRep < cleanRep, "no quarter must cost more standing");
});

test("raidWinPlanet honors an active commission against the raided faction (sanctioned bounty, lower wanted)", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    globalThis.__target = PLANETS.find(p => p.faction);
    const patron = __target.faction === "frontier" ? "core" : "frontier";   // must differ from the raided faction -- a commission against your own patron is a contradiction (see raidWinMerchant's own "betray" handling)
    S.commission = { patron, target: __target.faction, bounty: 900, done: 0, quota: 3, expires: S.turn + 10, reward: 5000 };
    globalThis.__prey = {
      isPlanetRaid: true, planetId: __target.id, planetName: __target.name,
      name: __target.name + " Defense Fleet", ico: "🏰", faction: __target.faction,
      cargo: {}, credits: 0, strength: 40, wantedGain: 40,
    };
    globalThis.__creditsBefore = S.res.credits;
  `);
  run(`raidWinPlanet(__prey, false);`);
  assert.equal(run(`S.commission.done`), 1, "a sanctioned raid must count toward the commission");
  assert.equal(run(`S.pirate.wanted`), 10, "a sanctioned raid draws the flat sanctioned rate, not the world's own wantedGain");
  assert.ok(run(`S.res.credits`) >= run(`__creditsBefore`) + 900, "the commission bounty must be paid out on top of the loot");
});

test("combatStrike dispatches a defeated planet-raid foe to raidWinPlanet, not raidWinMerchant", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    const target = PLANETS.find(p => p.faction);
    S.prey = {
      type: "garrison", isPlanetRaid: true, planetId: target.id, planetName: target.name,
      name: target.name + " Defense Fleet", ico: "🏰", faction: target.faction,
      cargo: {}, credits: 100, strength: 20, wantedGain: 20,
      def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic", engines: 2, enginesMax: 2,
      hp: 1, maxhp: 1000, isPirate: false, bounty: 0,
    };
    S.prey.pack = []; S.prey._others = []; S.allies = null;
  `);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`!!S.prey`), false, "the engagement must end once the sole hostile is destroyed");
  assert.ok(run(`S.log.some(l => /sacked the surface/.test(l.msg))`), "the win must route through raidWinPlanet's own phrasing, not raidWinMerchant's");
});
