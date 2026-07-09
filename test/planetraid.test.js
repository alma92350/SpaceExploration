"use strict";
/* Offense side of the defense slice: raidPlanet() (combat.js) deliberately targets the
   CURRENT planet's own defenses, shaped as a normal prey object (genPlanetDefense) so the
   whole existing raid-combat engine (weapon targeting, allies, extort, no quarter) just
   works unchanged — only the win path (raidWinPlanet, raiding.js) is new, dispatched from
   combatStrike's kill handler alongside raidWinPirate/raidWinMerchant. Fixtures pre-set
   hp/maxhp directly (same pattern test/raidpool.test.js uses) so a kill is deterministic
   regardless of the player's own combat-power formulas. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

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

test("raidPlanet spends fuel and an action, and engages the planet's own defense fleet", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    globalThis.__target = PLANETS.find(p => p.faction);
    S.location = __target.id;
    S.res.fuel = 999;
    globalThis.__before = S.actionsUsed;
  `);
  run(`raidPlanet();`);
  assert.equal(run(`S.prey.isPlanetRaid`), true);
  assert.equal(run(`S.prey.planetId`), run(`S.location`));
  assert.equal(run(`S.res.fuel`), 999 - run(`PLANET_RAID_FUEL`));
  assert.equal(run(`S.actionsUsed`), run(`__before`) + 1);
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
