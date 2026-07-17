"use strict";
/* Rival Captains (rivals.js) — opt-in AI captains who trade, lobby factions,
   race for colonizable worlds, and hunt a Wanted player. Off by default, so
   the first test locks down that every other existing save/test stays inert.
   The rest exercise each mechanic directly (mirrors the direct-function-call
   style test/rivalrep.test.js already uses) plus a seeded long-horizon
   regression run mirroring test/simulation.test.js's own invariants. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("rivals are fully inert when the opt-in toggle is off", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  assert.equal(run(`S.rivalsEnabled`), false);
  assert.equal(run(`S.rivalCountTarget`), 0);
  assert.equal(run(`S.rivals.length`), 0);
  run(`S.turn = 50; processRivals(); maybeSpawnRivals(); S.turn = 100; processRivals(); maybeSpawnRivals();`);
  assert.equal(run(`S.rivals.length`), 0, "no rival should ever spawn or act with the toggle off");
});

test("opt-in rivals spawn one per milestone, up to the rolled count", () => {
  const { run } = createSandbox();
  run(`S = freshState({ rivals: true }); rollPrices(); S.rivalCountTarget = 3;`);
  assert.equal(run(`S.rivalsEnabled`), true);
  run(`S.turn = 50; maybeSpawnRivals();`);
  assert.equal(run(`S.rivals.length`), 1, "first milestone spawns the first rival");
  run(`S.turn = 100; maybeSpawnRivals();`);
  assert.equal(run(`S.rivals.length`), 2);
  run(`S.turn = 150; maybeSpawnRivals();`);
  assert.equal(run(`S.rivals.length`), 3, "rolled target reached");
  run(`S.turn = 200; maybeSpawnRivals();`);
  assert.equal(run(`S.rivals.length`), 3, "no further spawns once the target is met, even at the last milestone");
});

test("a rival's trade moves the shared market price via applyMarketMove", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); Math.random = () => 0;`);
  const pid = run(`PLANETS.filter(p => isVisible(p) && S.prices[p.id])[0].id`);
  const cid = run(`COM_IDS.filter(c => !COM[c].isFuel && S.prices["${pid}"][c] != null)[0]`);
  run(`S.prices["${pid}"]["${cid}"] = Math.round(COM["${cid}"].base * 0.5);`);   // clearly cheap here -> a rival buys, price should rise
  const before = run(`S.prices["${pid}"]["${cid}"]`);
  // a large credit pile drives a large enough quantity/slippage that the move survives rounding
  // even on a cheap low-base commodity (a small % of a small integer can otherwise round away)
  run(`const r = { id: "t1", name: "Test Rival", credits: 500000 }; rivalTradeTurn(r);`);
  const after = run(`S.prices["${pid}"]["${cid}"]`);
  assert.ok(after > before, `expected the price to rise after a rival buy (before=${before}, after=${after})`);
});

test("a rival's lobbying sours the player's standing with a faction opposed to its patron", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.rep = { core: 0, miners: 0, agri: 0, syndicate: 0, frontier: 0 }; Math.random = () => 0;`);
  run(`const r = { id: "t1", name: "Test Rival", patron: "miners" }; rivalPoliticalTurn(r);`);
  // agri is miners' one and only static rival (FACTION_RIVAL, sector4x.js) -- Math.random()=0 forces the minimum -2 hit
  assert.equal(run(`S.rep.agri`), -2);
  assert.equal(run(`S.rep.core`), 0, "unrelated factions untouched");
  assert.equal(run(`S.rep.syndicate`), 0);
  assert.equal(run(`S.rep.frontier`), 0);
});

test("a rival stops claiming worlds at its colony cap, and a claimed world blocks the player too", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); Math.random = () => 0.01;`);   // always passes the 12% gate; pick() always lands on index 0
  run(`const r = { id: "t1", name: "Test Rival", colonies: [], colonyCap: 1 };
       for (let i = 0; i < 20; i++) rivalColonizeTurn(r);`);
  assert.equal(run(`r.colonies.length`), 1, "stops at colonyCap even after many more eligible cycles");
  const claimedPid = run(`r.colonies[0]`);
  assert.equal(run(`S.rivalClaims["${claimedPid}"].rivalId`), "t1");
  // the player can't found a colony on a world a rival already claimed
  run(`S.techs.colonial = true; S.location = "${claimedPid}"; colonize();`);
  assert.equal(run(`S.colonies["${claimedPid}"]`), undefined, "colonize() must refuse a rival-claimed world");
});

test("rival pursuit only triggers with high Wanted and a hostile rival, and refuses a bribe", () => {
  const { run } = createSandbox();
  run(`S = freshState({ rivals: true }); rollPrices();`);
  run(`S.pirate.wanted = 10; S.rivals = [{ id: "t1", name: "Test Rival", patron: "core", hostility: 80, strength: 20, status: "active" }];`);
  run(`maybeRivalPursuit(PLANETS.find(p => p.id === S.location));`);
  assert.equal(run(`S.encounter`), null, "low Wanted should never trigger a rival pursuit");

  run(`S.pirate.wanted = 90; S.rivals = [{ id: "t1", name: "Test Rival", patron: "core", hostility: 0, strength: 20, status: "active" }];`);
  run(`maybeRivalPursuit(PLANETS.find(p => p.id === S.location));`);
  assert.equal(run(`S.encounter`), null, "no sufficiently hostile rival should never trigger a pursuit");

  run(`S.pirate.wanted = 90; S.rivals = [{ id: "t1", name: "Test Rival", patron: "core", hostility: 100, strength: 20, status: "active" }]; Math.random = () => 0;`);
  run(`maybeRivalPursuit(PLANETS.find(p => p.id === S.location));`);
  assert.equal(run(`S.encounter.rivalId`), "t1");
  assert.equal(run(`S.encounter.noPay`), true);
  assert.ok(run(`Number.isFinite(S.encounter.level)`), "level must be set — pirateKillRewards reads prey.level directly");
  assert.equal(run(`S.interdiction`), null, "still respects the existing single-encounter lock");

  // a rival encounter refuses a bribe outright instead of corrupting credits toward e.toll (undefined)
  const creditsBefore = run(`S.res.credits`);
  run(`encounterPay();`);
  assert.equal(run(`S.res.credits`), creditsBefore, "encounterPay() must refuse a noPay encounter without touching credits");
  assert.ok(run(`S.encounter !== null`), "a refused bribe leaves the encounter active");
});

test("genPrey and spawnEscortWave occasionally tag a sighting as a rival's", () => {
  const { run } = createSandbox();
  run(`S = freshState({ rivals: true }); rollPrices();`);
  run(`S.rivals = [{ id: "t1", name: "Test Rival", status: "active" }]; Math.random = () => 0;`);
  const foeRivalId = run(`const foe = { name: "Ore Hauler" }; maybeAttributeRivalConvoy(foe); foe.rivalId;`);
  assert.equal(foeRivalId, "t1");
  const wave = run(`const w = { foes: [{ name: "Raider", role: "raider" }] }; maybeAttributeRivalAmbush(w); w.foes[0].rivalId;`);
  assert.equal(wave, "t1");
});

test("a seeded 210-cycle run with rivals enabled keeps every core invariant intact", () => {
  const { run } = createSandbox();
  const report = run(`
    Math.random = mulberry32(20260707);
    S = freshState({ rivals: true });
    S.rivalCountTarget = 4;
    generateFrontierRing();
    rollPrices();
    (() => {
      const pick = arr => arr[Math.floor(Math.random() * arr.length)];
      const problems = [];
      const check = () => {
        const bad = [];
        ["credits", "fuel", "tech", "influence"].forEach(k => { if (!Number.isFinite(S.res[k])) bad.push(k + "=" + S.res[k]); });
        if (S.res.fuel < 0) bad.push("fuel<0");
        CARGO_IDS.forEach(c => { const v = S.res[c]; if (!Number.isFinite(v) || v < 0) bad.push(c + "=" + v); });
        activePlanets().forEach(p => COM_IDS.forEach(c => {
          const v = S.prices[p.id] && S.prices[p.id][c];
          if (!Number.isFinite(v) || v <= 0) bad.push("price." + p.id + "." + c + "=" + v);
        }));
        if (!Number.isFinite(S.pirate.hull)) bad.push("hull=" + S.pirate.hull);
        (S.rivals || []).forEach(r => {
          if (!Number.isFinite(r.credits)) bad.push("rival." + r.id + ".credits=" + r.credits);
          if (!Number.isFinite(r.strength)) bad.push("rival." + r.id + ".strength=" + r.strength);
          if (!Number.isFinite(r.hostility)) bad.push("rival." + r.id + ".hostility=" + r.hostility);
          if ((r.colonies || []).length > (r.colonyCap || 1)) bad.push("rival." + r.id + " over colony cap");
        });
        if (bad.length) problems.push("cycle " + S.turn + ": " + bad.join(", "));
      };
      let guard = 0;
      while (S.turn < 210 && guard++ < 1500 && !problems.length) {
        if (S.encounter) { encounterFlee(); if (S.encounter) encounterPay(); if (S.encounter) S.encounter = null; }
        if (S.interdiction) { navySurrender(); if (S.interdiction) S.interdiction = null; }
        if (S.prey) raidDisengage();
        const acts = Math.floor(Math.random() * 3);
        for (let a = 0; a < acts && !inCombat(); a++) {
          const roll = Math.random();
          if (roll < 0.35) { const dep = Object.keys(currentPlanet().deposits || {}); if (dep.length) extract(pick(dep)); }
          else if (roll < 0.55) buy(pick(CARGO_IDS), 1 + Math.floor(Math.random() * 5));
          else if (roll < 0.75) { const held = CARGO_IDS.filter(c => S.res[c] > 0); if (held.length) sell(pick(held), 1); }
          else { const opts = activePlanets().filter(p => p.id !== S.location && isVisible(p)); if (opts.length) travel(pick(opts).id); }
        }
        const before = S.turn;
        endTurn();
        if (S.turn === before && !inCombat()) { problems.push("cycle stuck at " + S.turn); break; }
        check();
      }
      if (S.turn < 210 && !problems.length) problems.push("run stalled at cycle " + S.turn + " after " + guard + " iterations");
      if (!problems.length && S.rivals.length < 1) problems.push("no rival ever spawned across 210 cycles with rivalCountTarget=4");
      return problems.join(" | ");
    })();
  `);
  assert.equal(report, "", report);
});
